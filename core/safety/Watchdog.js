/**
 * MegaWatchdog
 * Supervisa FPS, frame time, contexto y errores. Si detecta un fallo
 * crítico, dispara un rollback y desactiva el módulo problemático
 * (Sección 28/29 del plan maestro). MegaScale nunca debe ser un punto
 * único de fallo.
 */

export class Watchdog {
  constructor({
    minAcceptableFps = 10,
    fpsCollapseThreshold = 0.5, // caída relativa vs baseline que se considera colapso
    onRollback = () => {},
  } = {}) {
    this.minAcceptableFps = minAcceptableFps;
    this.fpsCollapseThreshold = fpsCollapseThreshold;
    this.onRollback = onRollback;
    this.baselineFps = null;
    this.contextLost = false;
    this.errors = [];
  }

  setBaselineFps(fps) {
    this.baselineFps = fps;
  }

  attachToCanvas(canvas) {
    if (!canvas) return;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this._trigger('context_loss', { message: 'WebGL context lost' });
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
    });
  }

  reportError(source, error) {
    this.errors.push({ source, error: String(error), timestamp: Date.now() });
    this._trigger('error', { source, error: String(error) });
  }

  /**
   * Debe llamarse periódicamente (p.ej. cada frame o cada segundo) con las
   * stats actuales del Profiler.
   */
  check(stats) {
    if (!stats) return { ok: true };

    if (stats.fps > 0 && stats.fps < this.minAcceptableFps) {
      this._trigger('fps_floor', { fps: stats.fps });
      return { ok: false, reason: 'fps_floor', stats };
    }

    if (this.baselineFps && stats.fps > 0) {
      const ratio = stats.fps / this.baselineFps;
      if (ratio < this.fpsCollapseThreshold) {
        this._trigger('fps_collapse', { fps: stats.fps, baseline: this.baselineFps, ratio });
        return { ok: false, reason: 'fps_collapse', stats };
      }
    }

    if (this.contextLost) {
      return { ok: false, reason: 'context_loss', stats };
    }

    return { ok: true, stats };
  }

  _trigger(reason, detail) {
    this.onRollback({ reason, detail, timestamp: Date.now() });
  }
}

export default Watchdog;
