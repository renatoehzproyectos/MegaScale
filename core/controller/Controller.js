/**
 * Controller
 * Central orchestrator of MegaScale.
 *
 * Flow:
 * 1. Detect environment (WebGL1/2, WebGPU, Three, Babylon, Pixi, Canvas2D)
 * 2. Bind universal adapter (CompatibilityManager)
 * 3. Select profile (ProfileManager)
 * 4. Baseline + lightweight monitoring
 * 5. Frame-by-frame: FPS / frame-time / variance / 1% lows / CPU / memory
 * 6. Predictor + BottleneckEngine → decide scale
 * 7. Dynamic Resolution with hysteresis / oscillation protection
 * 8. Watchdog + Rollback
 */

import { RendererDetector } from '../../detection/renderer-detection/RendererDetector.js';
import { CompatibilityManager } from '../../detection/renderer-detection/CompatibilityManager.js';
import { Profiler } from '../profiler/Profiler.js';
import { Benchmark } from '../benchmark/Benchmark.js';
import { Watchdog } from '../safety/Watchdog.js';
import { RollbackManager } from '../safety/Rollback.js';
import { DynamicResolution } from '../../optimization/dynamic-resolution/DynamicResolution.js';
import { DPROptimizer } from '../../optimization/dpr/DPROptimizer.js';
import { PerformancePredictor } from '../predictor/PerformancePredictor.js';
import { GPUTiering } from '../../benchmark/gpu/GPUTiering.js';
import { BottleneckEngine } from '../../optimization/draw-call/BottleneckEngine.js';
import { OptimizationGraph } from '../../optimization/presentation/OptimizationGraph.js';
import { OscillationDetector } from '../scheduler/OscillationDetector.js';
import { MemoryManager } from '../../optimization/memory/MemoryManager.js';
import { CPUMonitor } from '../../benchmark/cpu/CPUMonitor.js';
import { MemoryProfiler } from '../../benchmark/memory/MemoryProfiler.js';
import { ProfileManager } from '../../profiles/ProfileManager.js';
import { BenchmarkSuite } from '../../benchmark/regression/BenchmarkSuite.js';

export class Controller {
  constructor({
    canvas,
    targetFps = 60,
    overlay = null,
    profile = 'auto',
    engine = null,
    aaMode = 'fxaa',
    enableUpscaling = true,
  } = {}) {
    if (!canvas && typeof document !== 'undefined') {
      canvas = document.querySelector('canvas');
    }
    if (!canvas) {
      throw new Error('[MegaScale] Se requiere un elemento canvas válido.');
    }

    this.canvas = canvas;
    this.targetFps = targetFps;
    this.overlay = overlay;
    this.aaMode = aaMode;
    this.enableUpscaling = enableUpscaling;

    this.profileManager = new ProfileManager(profile);
    this.compatibilityManager = new CompatibilityManager(canvas, engine);

    this.dprOptimizer = new DPROptimizer({ targetFps });
    this.predictor = new PerformancePredictor();
    this.bottleneckEngine = new BottleneckEngine();
    this.optimizationGraph = new OptimizationGraph();
    this.oscillationDetector = new OscillationDetector();
    this.memoryManager = new MemoryManager();
    this.cpuMonitor = new CPUMonitor();
    this.memoryProfiler = new MemoryProfiler();

    this.gpuTierInfo = null;
    this.activeConfig = null;
    this._lastAppliedScale = null;
    this._lastBottleneck = 'unknown';
    this._decisionCooldown = 0;

    this.detector = new RendererDetector(canvas);
    this.profiler = new Profiler();
    this.benchmark = new Benchmark();
    this.rollback = new RollbackManager();
    this.watchdog = new Watchdog({
      onRollback: (info) => this._handleWatchdogTrigger(info),
    });

    this.environment = null;
    this.dynamicResolution = null;

    this._running = false;
    this._rafHandle = null;
    this._enabled = true;
    this._watchdogRetryTimer = null;
    this._watchdogCooldownMs = 0;
  }

  async init() {
    this.environment = await this.detector.detect();
    this.compatibilityManager.resolveAdapter(this.environment);

    this.watchdog.attachToCanvas(this.canvas);

    const activeProf = this.profileManager.activeProfile;
    const adapterOwnsResize = this.compatibilityManager.adapterOwnsResize();
    this.dynamicResolution = new DynamicResolution({
      canvas: this.canvas,
      targetFps: this.targetFps,
      minScale: activeProf.minScale || 0.35,
      maxScale: activeProf.maxScale || 1.0,
      initialScale: activeProf.defaultScale || 1.0,
      adapterOwnsResize,
    });

    const baseW = adapterOwnsResize
      ? (this.canvas.clientWidth || this.canvas.width || 800)
      : this.canvas.width;
    const baseH = adapterOwnsResize
      ? (this.canvas.clientHeight || this.canvas.height || 600)
      : this.canvas.height;
    this.dynamicResolution.setBaseResolution(baseW, baseH);

    if (activeProf.defaultScale && activeProf.defaultScale !== 1) {
      this.dynamicResolution.setScale(activeProf.defaultScale);
      this.compatibilityManager.applyScale(activeProf.defaultScale);
    }

    this.rollback.snapshot({ scale: this.dynamicResolution.getScale() });
    this._lastAppliedScale = this.dynamicResolution.getScale();

    this.profiler.start();
    this._running = true;

    if (typeof requestAnimationFrame !== 'undefined') {
      this._loop(performance.now());
    }

    // Baseline in background — GPUTiering intentionally disabled:
    // its micro-benchmark draws on the live shared canvas and calls
    // gl.finish() in a blocking loop, freezing the main thread and
    // corrupting concurrent rendering.
    this.benchmark
      .runBaseline(this.profiler, {
        renderer: this.environment.renderer,
        dpr: this.environment.dpr,
      })
      .then(async (baseline) => {
        this.watchdog.setBaselineFps(baseline.fps);

        this.gpuTierInfo = {
          tier: 3,
          tierName: 'Mid',
          capabilityScore: 0,
          fillRateScore: 0,
          fillRateRaw: 0,
          benchmarkError: 'disabled-safe',
        };

        if (this.profileManager.activeProfileName === 'auto') {
          const autoProf = this.profileManager.resolveAutoProfile(this.gpuTierInfo.tier);
          this.dynamicResolution.minScale = autoProf.minScale;
          this.dynamicResolution.maxScale = autoProf.maxScale;
        }

        this.activeConfig = this.optimizationGraph.proposeConfiguration({
          gpuTier: this.gpuTierInfo.tier,
          bottleneck: 'unknown',
          webgpuAvailable: this.environment.webgpu,
        });
        this.aaMode = this.activeConfig.aa || this.aaMode;
      })
      .catch(() => {
        /* silent baseline failure */
      });

    return this.environment;
  }

  _loop(timestamp) {
    if (!this._running) return;

    const cpuStart = this.cpuMonitor.startFrame();
    const stats = this.profiler.tick(timestamp);

    if (stats && this._enabled) {
      const check = this.watchdog.check(stats);

      if (!check.ok) {
        this._handleWatchdogTrigger({ reason: check.reason, detail: stats });
      } else {
        this._decideAndApply(stats);
      }

      this.memoryProfiler.setAllocatedVram(this.memoryManager.allocatedBytes);
      this.memoryProfiler.sample();

      if (this.overlay) {
        this.overlay.update({
          fps: stats.fps,
          frameTime: stats.frameTime,
          onePercentLow: stats.onePercentLow,
          renderer: this.environment ? this.environment.renderer : 'unknown',
          adapter: this.compatibilityManager.adapterType,
          scale: this.dynamicResolution.getScale(),
          aaMode: this.aaMode,
          dpr: this.dprOptimizer.getEffectiveDpr(),
          bottleneck: this._lastBottleneck,
        });
      }
    }

    this.cpuMonitor.endFrame(cpuStart);

    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafHandle = requestAnimationFrame((t) => this._loop(t));
    }
  }

  /**
   * Core decision: feed intelligence modules, respect bottleneck, use
   * predictor when confident, apply scale only when net value is positive.
   */
  _decideAndApply(stats) {
    const scaleBefore = this.dynamicResolution.getScale();

    // Guard: catastrophic frame → never resize while GPU is backlogged
    const CATASTROPHIC_FRAME_MS = 250;
    if (stats.frameTime > CATASTROPHIC_FRAME_MS) {
      this.predictor.addSample(scaleBefore, stats.fps);
      this.bottleneckEngine.record(scaleBefore, stats.fps);
      return;
    }

    // Feed samples every frame (cheap)
    this.predictor.addSample(scaleBefore, stats.fps);
    this.bottleneckEngine.record(scaleBefore, stats.fps);

    // Periodic bottleneck re-evaluation (not every frame)
    this._decisionCooldown++;
    if (this._decisionCooldown >= 15) {
      this._decisionCooldown = 0;
      const memStats = this.memoryProfiler.getStats ? this.memoryProfiler.getStats() : {};
      const bn = this.bottleneckEngine.detect({
        frameTimeVariance: stats.variance,
        memoryGrowthMBPerMin: memStats.growthMBPerMin || 0,
      });
      this._lastBottleneck = bn.bottleneck || 'unknown';
      this.dynamicResolution.setBottleneck(this._lastBottleneck);

      // Update active config recommendation
      if (this.activeConfig && this.gpuTierInfo) {
        this.activeConfig = this.optimizationGraph.proposeConfiguration({
          gpuTier: this.gpuTierInfo.tier,
          bottleneck: this._lastBottleneck,
          webgpuAvailable: this.environment && this.environment.webgpu,
        });
      }
    }

    // Predictor suggestion when model is ready and not distrusted
    let suggested = null;
    if (this.predictor.hasModel() && !this.predictor.shouldDistrustModel()) {
      suggested = this.predictor.predictScaleForTarget(this.targetFps, {
        minScale: this.dynamicResolution.minScale,
        maxScale: this.dynamicResolution.maxScale,
      });
    }
    this.dynamicResolution.setSuggestedScale(suggested);

    // Validate last prediction (feeds distrust counter)
    if (suggested != null) {
      const predictedFps = this.predictor.predictFps(scaleBefore);
      this.predictor.validatePrediction(predictedFps, stats.fps);
    }

    const changed = this.dynamicResolution.update(stats);

    if (changed) {
      const newScale = this.dynamicResolution.getScale();
      this.compatibilityManager.applyScale(newScale);
      this.oscillationDetector.recordChange(newScale > scaleBefore ? 'up' : 'down');

      if (this.oscillationDetector.isOscillating()) {
        const multiplier = this.oscillationDetector.getRecommendedHoldMultiplier();
        this.dynamicResolution.hysteresisFrames = Math.round(30 * multiplier);
      } else {
        // decay hysteresis back toward normal
        this.dynamicResolution.hysteresisFrames = Math.max(
          20,
          Math.round(this.dynamicResolution.hysteresisFrames * 0.95)
        );
      }

      this.rollback.snapshot({ scale: newScale });
      this._lastAppliedScale = newScale;
    }
  }

  _handleWatchdogTrigger({ reason, detail }) {
    const lastGood = this.rollback.rollback({ disableModule: 'dynamic-resolution' });

    if (lastGood && this.dynamicResolution) {
      this.dynamicResolution.currentScale = lastGood.scale;
      this.compatibilityManager.applyScale(lastGood.scale);
    }

    if (reason === 'context_loss' || reason === 'fps_collapse' || reason === 'fps_floor') {
      this._enabled = false;
      this.memoryManager.handleContextLost();
      // eslint-disable-next-line no-console
      console.warn(`[MegaScale] Rollback disparado (${reason}). Optimizaciones pausadas.`);

      if (this.overlay) {
        this.overlay.update({
          fps: detail && detail.fps,
          frameTime: detail && detail.frameTime,
          renderer: this.environment ? this.environment.renderer : 'unknown',
          adapter: this.compatibilityManager ? this.compatibilityManager.adapterType : undefined,
          scale: this.dynamicResolution ? this.dynamicResolution.getScale() : 1,
          aaMode: this.aaMode,
          dpr: this.dprOptimizer ? this.dprOptimizer.getEffectiveDpr() : undefined,
          paused: `PAUSED (${reason}) - retry in ${Math.round(this._watchdogCooldownMs / 1000)}s`,
        });
      }

      if (this._watchdogRetryTimer) clearTimeout(this._watchdogRetryTimer);
      this._watchdogCooldownMs = reason === 'context_loss' ? 6000 : 4000;
      this._watchdogRetryTimer = setTimeout(() => {
        this._enabled = true;
        if (this.watchdog.reset) this.watchdog.reset();
        // eslint-disable-next-line no-console
        console.warn('[MegaScale] Reanudando tras cooldown de watchdog.');
      }, this._watchdogCooldownMs);
    }
  }

  setProfile(name) {
    this.profileManager.setProfile(name);
    const prof = this.profileManager.activeProfile;
    if (this.dynamicResolution && prof.minScale) {
      this.dynamicResolution.minScale = prof.minScale;
      this.dynamicResolution.maxScale = prof.maxScale;
      this.dynamicResolution.setScale(prof.defaultScale);
      this.compatibilityManager.applyScale(prof.defaultScale);
    }
  }

  stop() {
    this._running = false;
    if (this._watchdogRetryTimer) {
      clearTimeout(this._watchdogRetryTimer);
      this._watchdogRetryTimer = null;
    }
    this.profiler.stop();
    this.cpuMonitor.destroy();
    this.memoryManager.disposeAll();
    this.compatibilityManager.restore();
    if (this._rafHandle && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._rafHandle);
    }
  }

  getIntelligenceReport() {
    return {
      environment: this.environment,
      gpuTier: this.gpuTierInfo,
      activeConfig: this.activeConfig,
      activeProfile: this.profileManager.activeProfileName,
      adapterType: this.compatibilityManager.adapterType,
      bottleneck: this.bottleneckEngine.detect(),
      cpuMetrics: this.cpuMonitor.getMetrics(),
      memoryStats: this.memoryManager.getStats(),
      predictedFpsAtCurrentScale: this.dynamicResolution
        ? this.predictor.predictFps(this.dynamicResolution.getScale())
        : null,
      isOscillating: this.oscillationDetector.isOscillating(),
      onePercentLow: this.profiler.getStats().onePercentLow,
    };
  }

  static runScientificBenchmarkSuite() {
    const suite = new BenchmarkSuite();
    return suite.runAll();
  }
}

export default Controller;
