/**
 * DynamicResolution (v2)
 * Adaptive render-scale controller with hysteresis, optional predictive
 * target, and bottleneck-aware decisions.
 *
 * Ownership:
 * - By default resizes canvas.width/height (raw WebGL / Canvas2D).
 * - When a framework adapter owns the buffer, only the numeric scale is
 *   updated; the adapter drives setSize / setPixelRatio.
 */

export class DynamicResolution {
  constructor({
    canvas,
    minScale = 0.5,
    maxScale = 1.0,
    step = 0.05,
    targetFps = 60,
    hysteresisFrames = 30,
    adapterOwnsResize = false,
  } = {}) {
    this.canvas = canvas;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.step = step;
    this.targetFps = targetFps;
    this.hysteresisFrames = hysteresisFrames;
    this.adapterOwnsResize = !!adapterOwnsResize;

    this.currentScale = 1.0;
    this._framesSinceLastChange = 0;
    this._baseWidth = canvas ? canvas.width : 0;
    this._baseHeight = canvas ? canvas.height : 0;
    this._suggestedScale = null; // from predictor
    this._lastBottleneck = 'unknown';
  }

  setBaseResolution(width, height) {
    this._baseWidth = width;
    this._baseHeight = height;
  }

  setAdapterOwnsResize(flag) {
    this.adapterOwnsResize = !!flag;
  }

  /**
   * Optional: feed a predicted scale from PerformancePredictor.
   * null = ignore and fall back to step logic.
   */
  setSuggestedScale(scale) {
    if (scale == null || !Number.isFinite(scale)) {
      this._suggestedScale = null;
      return;
    }
    this._suggestedScale = Math.min(this.maxScale, Math.max(this.minScale, scale));
  }

  setBottleneck(kind) {
    this._lastBottleneck = kind || 'unknown';
  }

  /**
   * @param {object} stats - from Profiler
   * @returns {boolean} true if scale changed
   */
  update(stats) {
    this._framesSinceLastChange++;

    if (this._framesSinceLastChange < this.hysteresisFrames) {
      return false;
    }

    if (!stats || stats.fps === 0) return false;

    const targetLower = this.targetFps * 0.92;
    const targetUpper = this.targetFps * 1.08;

    // CPU-bound: lowering resolution will not help (and can hurt quality
    // without FPS gain). Prefer holding or slowly recovering scale.
    if (this._lastBottleneck === 'cpu-bound') {
      if (stats.fps >= targetLower && this.currentScale < this.maxScale) {
        // gentle recovery only
        return this._applyScale(this.currentScale + this.step * 0.5);
      }
      return false;
    }

    let target = null;

    // Prefer predictor suggestion when available and we are clearly off target
    if (this._suggestedScale != null && Math.abs(this._suggestedScale - this.currentScale) > 0.02) {
      if (stats.fps < targetLower || stats.fps > targetUpper) {
        target = this._suggestedScale;
      }
    }

    if (target == null) {
      if (stats.fps < targetLower) {
        target = this.currentScale - this.step;
      } else if (stats.fps > targetUpper && this.currentScale < this.maxScale) {
        target = this.currentScale + this.step;
      } else {
        return false;
      }
    }

    // Adaptive step: move faster when far from target, smaller near it
    const distance = Math.abs(target - this.currentScale);
    let step = this.step;
    if (distance > 0.15) step = Math.min(0.12, this.step * 2);
    else if (distance < 0.04) step = Math.max(0.02, this.step * 0.5);

    const direction = target > this.currentScale ? 1 : -1;
    const next = this.currentScale + direction * Math.min(step, distance);

    return this._applyScale(next);
  }

  _applyScale(newScale) {
    const clamped = Math.min(this.maxScale, Math.max(this.minScale, newScale));
    if (Math.abs(clamped - this.currentScale) < 0.008) return false;

    this.currentScale = Number(clamped.toFixed(3));
    this._applyToCanvas();
    this._framesSinceLastChange = 0;
    return true;
  }

  _applyToCanvas() {
    if (!this.canvas) return;

    if (this.adapterOwnsResize) {
      if (this.currentScale < 1 && !this.canvas.style.filter) {
        this.canvas.style.filter = 'contrast(1.06) saturate(1.1)';
      }
      return;
    }

    if (!this._baseWidth || !this._baseHeight) return;
    const w = Math.round(this._baseWidth * this.currentScale);
    const h = Math.round(this._baseHeight * this.currentScale);
    if (w < 16 || h < 16) return;

    this.canvas.width = w;
    this.canvas.height = h;

    if (this.currentScale < 1) {
      this.canvas.style.filter = 'contrast(1.06) saturate(1.1)';
    } else {
      this.canvas.style.filter = '';
    }
  }

  getScale() {
    return this.currentScale;
  }

  setScale(scale) {
    this._applyScale(scale);
  }

  reset() {
    this.currentScale = 1.0;
    this._framesSinceLastChange = 0;
    this._suggestedScale = null;
    this._applyToCanvas();
  }
}

export default DynamicResolution;
