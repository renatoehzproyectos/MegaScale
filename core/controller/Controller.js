/**
 * Controller
 * Orquesta el ciclo FASE 1: detectar -> medir baseline -> monitorear cada
 * frame -> ajustar dynamic resolution -> vigilar con el watchdog -> revertir
 * si hace falta. Esta es la columna vertebral sobre la que se irán
 * enganchando las fases siguientes (upscaling, WebGPU, IA, etc).
 */

import { RendererDetector } from '../../detection/renderer-detection/RendererDetector.js';
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

export class Controller {
  constructor({ canvas, targetFps = 60, overlay = null, aaMode = 'fxaa', enableUpscaling = false } = {}) {
    if (!canvas) {
      throw new Error('MegaScale.Controller requiere un canvas.');
    }

    this.canvas = canvas;
    this.targetFps = targetFps;
    this.overlay = overlay;
    this.aaMode = aaMode; // 'off' | 'fxaa' | 'smaa'
    this.enableUpscaling = enableUpscaling;
    this.dprOptimizer = new DPROptimizer({ targetFps });
    this.predictor = new PerformancePredictor();
    this.bottleneckEngine = new BottleneckEngine();
    this.optimizationGraph = new OptimizationGraph();
    this.oscillationDetector = new OscillationDetector();
    this.gpuTierInfo = null;
    this.activeConfig = null;
    this._lastAppliedScale = null;

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
    this._enabled = true; // se pone en false si hay rollback total
  }

  /**
   * Inicializa MegaScale: detecta entorno, mide baseline, arranca el loop.
   */
  async init() {
    this.environment = await this.detector.detect();

    this.watchdog.attachToCanvas(this.canvas);

    this.dynamicResolution = new DynamicResolution({
      canvas: this.canvas,
      targetFps: this.targetFps,
    });
    this.dynamicResolution.setBaseResolution(this.canvas.width, this.canvas.height);

    this.rollback.snapshot({ scale: this.dynamicResolution.getScale() });
    this._lastAppliedScale = this.dynamicResolution.getScale();

    this.profiler.start();
    this._running = true;
    this._loop(performance.now());

    // Baseline en segundo plano (no bloquea el arranque del loop).
    this.benchmark.runBaseline(this.profiler, {
      renderer: this.environment.renderer,
      dpr: this.environment.dpr,
    }).then(async (baseline) => {
      this.watchdog.setBaselineFps(baseline.fps);

      // FASE 3: clasificar GPU y proponer configuración inicial en vez de
      // dejar todo en valores por defecto. No bloquea el loop de render,
      // que ya está corriendo desde antes.
      const gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
      if (gl) {
        this.gpuTierInfo = await new GPUTiering(gl).classify(this.environment);
        this.activeConfig = this.optimizationGraph.proposeConfiguration({
          gpuTier: this.gpuTierInfo.tier,
          bottleneck: 'unknown', // aún no hay suficientes muestras
          webgpuAvailable: this.environment.webgpu,
        });
        this.aaMode = this.activeConfig.aa;
      }
    });

    return this.environment;
  }

  _loop(timestamp) {
    if (!this._running) return;

    const stats = this.profiler.tick(timestamp);

    if (stats && this._enabled) {
      const check = this.watchdog.check(stats);

      if (!check.ok) {
        this._handleWatchdogTrigger({ reason: check.reason, detail: stats });
      } else {
        const scaleBefore = this.dynamicResolution.getScale();
        const changed = this.dynamicResolution.update(stats);

        // FASE 3: alimentar predictor y bottleneck engine con cada muestra.
        this.predictor.addSample(scaleBefore, stats.fps);
        this.bottleneckEngine.record(scaleBefore, stats.fps);

        if (changed) {
          const newScale = this.dynamicResolution.getScale();
          this.oscillationDetector.recordChange(newScale > scaleBefore ? 'up' : 'down');

          if (this.oscillationDetector.isOscillating()) {
            // Oscilación detectada: extender el cooldown de DynamicResolution
            // multiplicando su hysteresisFrames (Sección 9).
            const multiplier = this.oscillationDetector.getRecommendedHoldMultiplier();
            this.dynamicResolution.hysteresisFrames = Math.round(30 * multiplier);
          }

          this.rollback.snapshot({ scale: newScale });
          this._lastAppliedScale = newScale;
        }
      }

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

    this._rafHandle = requestAnimationFrame((t) => this._loop(t));
  }

  _handleWatchdogTrigger({ reason, detail }) {
    const lastGood = this.rollback.rollback({ disableModule: 'dynamic-resolution' });

    if (lastGood && this.dynamicResolution) {
      this.dynamicResolution.currentScale = lastGood.scale;
      this.dynamicResolution._applyToCanvas();
    }

    if (reason === 'context_loss' || reason === 'fps_collapse') {
      // Ante un fallo severo, desactivamos temporalmente las optimizaciones
      // activas pero dejamos el juego correr sin MegaScale interviniendo.
      this._enabled = false;
      // eslint-disable-next-line no-console
      console.warn(`[MegaScale] Rollback disparado (${reason}). Optimizaciones pausadas.`);
    }
  }

  stop() {
    this._running = false;
    this.profiler.stop();
    if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
  }

  /**
   * Snapshot de "inteligencia" acumulada, útil para overlays de debug o
   * para que el desarrollador entienda por qué MegaScale decidió algo.
   */
  getIntelligenceReport() {
    return {
      gpuTier: this.gpuTierInfo,
      activeConfig: this.activeConfig,
      bottleneck: this.bottleneckEngine.detect(),
      predictorHasModel: this.predictor.hasModel(),
      predictedFpsAtCurrentScale: this.dynamicResolution
        ? this.predictor.predictFps(this.dynamicResolution.getScale())
        : null,
      isOscillating: this.oscillationDetector.isOscillating(),
    };
  }
}

export default Controller;
