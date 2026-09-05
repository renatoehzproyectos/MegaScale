/**
 * Controller
 * Orquestador central de MegaScale (Fases 1 a 6).
 *
 * Flujo de ejecución:
 * 1. Detección automática del entorno (WebGL1/2, WebGPU, Three.js, Babylon, Pixi, Canvas2D).
 * 2. Enlace del adaptador de compatibilidad universal (CompatibilityManager).
 * 3. Selección y configuración del perfil (ProfileManager).
 * 4. Micro-benchmark inicial de baseline y GPU tiering (GPUTiering).
 * 5. Monitoreo frame a frame de FPS, Frame-Time, Varianza, CPU (CPUMonitor) y Memoria.
 * 6. Predicción de rendimiento (PerformancePredictor) y detección de cuello de botella (BottleneckEngine).
 * 7. Control adaptativo de Dynamic Resolution con protección anti-oscilación (OscillationDetector).
 * 8. Vigilancia continua de salud del render (Watchdog) con rollback automático (RollbackManager).
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

    // Gestores de compatibilidad y perfiles
    this.profileManager = new ProfileManager(profile);
    this.compatibilityManager = new CompatibilityManager(canvas, engine);

    // Módulos de optimización e inteligencia
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

    // Diagnóstico y seguridad
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
  }

  /**
   * Inicializa MegaScale: detecta entorno, selecciona adaptador, mide baseline y arranca el loop.
   */
  async init() {
    this.environment = await this.detector.detect();
    this.compatibilityManager.resolveAdapter(this.environment);

    this.watchdog.attachToCanvas(this.canvas);

    const activeProf = this.profileManager.activeProfile;
    this.dynamicResolution = new DynamicResolution({
      canvas: this.canvas,
      targetFps: this.targetFps,
      minScale: activeProf.minScale || 0.35,
      maxScale: activeProf.maxScale || 1.0,
      initialScale: activeProf.defaultScale || 1.0,
    });
    this.dynamicResolution.setBaseResolution(this.canvas.width, this.canvas.height);

    this.rollback.snapshot({ scale: this.dynamicResolution.getScale() });
    this._lastAppliedScale = this.dynamicResolution.getScale();

    this.profiler.start();
    this._running = true;

    if (typeof requestAnimationFrame !== 'undefined') {
      this._loop(performance.now());
    }

    // Baseline en segundo plano
    this.benchmark.runBaseline(this.profiler, {
      renderer: this.environment.renderer,
      dpr: this.environment.dpr,
    }).then(async (baseline) => {
      this.watchdog.setBaselineFps(baseline.fps);

      // GPUTiering disabled: its micro-benchmark draws onto the live shared
      // canvas context and calls gl.finish() in a blocking loop, freezing
      // the main thread and corrupting whatever else renders to that canvas.
      this.gpuTierInfo = { tier: 3, tierName: 'Mid', capabilityScore: 0, fillRateScore: 0, fillRateRaw: 0, benchmarkError: 'disabled' };

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
      this.aaMode = this.activeConfig.aa;
    }).catch(() => {
      // Baseline silencioso
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
        const scaleBefore = this.dynamicResolution.getScale();
        const changed = this.dynamicResolution.update(stats);

        // Alimentar inteligencia
        this.predictor.addSample(scaleBefore, stats.fps);
        this.bottleneckEngine.record(scaleBefore, stats.fps);

        if (changed) {
          const newScale = this.dynamicResolution.getScale();
          this.compatibilityManager.applyScale(newScale);
          this.oscillationDetector.recordChange(newScale > scaleBefore ? 'up' : 'down');

          if (this.oscillationDetector.isOscillating()) {
            const multiplier = this.oscillationDetector.getRecommendedHoldMultiplier();
            this.dynamicResolution.hysteresisFrames = Math.round(30 * multiplier);
          }

          this.rollback.snapshot({ scale: newScale });
          this._lastAppliedScale = newScale;
        }
      }

      this.memoryProfiler.setAllocatedVram(this.memoryManager.allocatedBytes);
      this.memoryProfiler.sample();

      if (this.overlay) {
        this.overlay.update({
          fps: stats.fps,
          frameTime: stats.frameTime,
          renderer: this.environment.renderer,
          scale: this.dynamicResolution.getScale(),
          aaMode: this.aaMode,
          dpr: this.dprOptimizer.getEffectiveDpr(),
        });
      }
    }

    this.cpuMonitor.endFrame(cpuStart);

    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafHandle = requestAnimationFrame((t) => this._loop(t));
    }
  }

  _handleWatchdogTrigger({ reason, detail }) {
    const lastGood = this.rollback.rollback({ disableModule: 'dynamic-resolution' });

    if (lastGood && this.dynamicResolution) {
      this.dynamicResolution.currentScale = lastGood.scale;
      this.compatibilityManager.applyScale(lastGood.scale);
    }

    if (reason === 'context_loss' || reason === 'fps_collapse') {
      this._enabled = false;
      this.memoryManager.handleContextLost();
      // eslint-disable-next-line no-console
      console.warn(`[MegaScale] Rollback disparado (${reason}). Optimizaciones pausadas.`);
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
    };
  }

  static runScientificBenchmarkSuite() {
    const suite = new BenchmarkSuite();
    return suite.runAll();
  }
}

export default Controller;
