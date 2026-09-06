/**
 * Watchdog
 * Supervises FPS, frame time, context loss and errors.
 * On critical failure it triggers rollback via the supplied callback.
 * MegaScale must never be a single point of failure.
 */

export class Watchdog {
  constructor({
    minAcceptableFps = 10,
    fpsCollapseThreshold = 0.5,
    onRollback = () => {},
  } = {}) {
    this.minAcceptableFps = minAcceptableFps;
    this.fpsCollapseThreshold = fpsCollapseThreshold;
    this.onRollback = onRollback;
    this.baselineFps = null;
    this.contextLost = false;
    this.errors = [];
    this._lastTriggerTs = 0;
    this._triggerCooldownMs = 1500; // prevent spam triggers
  }

  setBaselineFps(fps) {
    this.baselineFps = fps;
  }

  attachToCanvas(canvas) {
    if (!canvas) return;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this._trigger('context_loss', { event: 'webglcontextlost' });
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
    }, false);
  }

  reportError(source, error) {
    this.errors.push({ source, error: String(error), timestamp: Date.now() });
    if (this.errors.length > 20) this.errors.shift();
    this._trigger('error', { source, error: String(error) });
  }

  /**
   * Called each frame (or periodically) with Profiler stats.
   */
  check(stats) {
    if (!stats) return { ok: true };

    if (this.contextLost) {
      return { ok: false, reason: 'context_loss', stats };
    }

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

    return { ok: true, stats };
  }

  _trigger(reason, detail) {
    const now = Date.now();
    if (now - this._lastTriggerTs < this._triggerCooldownMs) return;
    this._lastTriggerTs = now;
    this.onRollback({ reason, detail, timestamp: now });
  }

  /** Clear transient failure state so optimization can resume. */
  reset() {
    this.contextLost = false;
    this._lastTriggerTs = 0;
  }
}

export default Watchdog;
