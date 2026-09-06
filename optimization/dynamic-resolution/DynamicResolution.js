/**
 * DynamicResolution (v1)
 * Versión inicial, NO predictiva todavía (eso llega en FASE 3 con el
 * Performance Predictor). Ajusta el render scale del canvas dentro de
 * límites seguros, con hysteresis simple para evitar oscilaciones
 * (Sección 9 del plan maestro).
 *
 * Ownership:
 * - By default this class resizes canvas.width/height (raw WebGL / Canvas2D).
 * - When a framework adapter (e.g. ThreeWebGLAdapter) reports that it owns
 *   the buffer size, this class only updates the numeric scale + CSS
 *   sharpen filter and lets the adapter drive setSize/setPixelRatio.
 */

export class DynamicResolution {
  constructor({
    canvas,
    minScale = 0.5,
    maxScale = 1.0,
    step = 0.05,
    targetFps = 60,
    hysteresisFrames = 30, // nº de mediciones estables antes de permitir otro cambio
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
  }

  setBaseResolution(width, height) {
    this._baseWidth = width;
    this._baseHeight = height;
  }

  setAdapterOwnsResize(flag) {
    this.adapterOwnsResize = !!flag;
  }

  /**
   * Debe llamarse con las stats más recientes del Profiler. Devuelve
   * true si se aplicó un cambio de escala.
   */
  update(stats) {
    this._framesSinceLastChange++;

    if (this._framesSinceLastChange < this.hysteresisFrames) {
      return false; // cooldown activo, evitar oscilación
    }

    if (!stats || stats.fps === 0) return false;

    const targetLower = this.targetFps * 0.95;
    const targetUpper = this.targetFps * 1.1;

    let changed = false;

    if (stats.fps < targetLower) {
      changed = this._applyScale(this.currentScale - this.step);
    } else if (stats.fps > targetUpper && this.currentScale < this.maxScale) {
      changed = this._applyScale(this.currentScale + this.step);
    }

    if (changed) {
      this._framesSinceLastChange = 0;
    }

    return changed;
  }

  _applyScale(newScale) {
    const clamped = Math.min(this.maxScale, Math.max(this.minScale, newScale));
    if (Math.abs(clamped - this.currentScale) < 0.001) return false;

    this.currentScale = Number(clamped.toFixed(3));
    this._applyToCanvas();
    return true;
  }

  _applyToCanvas() {
    if (!this.canvas) return;

    // When a framework adapter owns the drawing buffer (Three, etc.),
    // we must NOT touch canvas.width/height — the adapter will call
    // renderer.setSize / setPixelRatio. We only keep the CSS sharpen
    // filter in sync for the rare path where the adapter doesn't set it.
    if (this.adapterOwnsResize) {
      // Filter is applied by ThreeWebGLAdapter itself; leave a light
      // safety net in case an older adapter is used.
      if (this.currentScale < 1 && !this.canvas.style.filter) {
        this.canvas.style.filter = 'contrast(1.06) saturate(1.1)';
      } else if (this.currentScale >= 1) {
        // Don't clear if adapter already manages it; only clear when we
        // are the sole owner of the filter (adapterOwnsResize but no filter set).
      }
      return;
    }

    if (!this._baseWidth || !this._baseHeight) return;
    const w = Math.round(this._baseWidth * this.currentScale);
    const h = Math.round(this._baseHeight * this.currentScale);
    this.canvas.width = w;
    this.canvas.height = h;
    // El estilo CSS se mantiene al tamaño de presentación original para que
    // el navegador haga el upscale final (pipeline de presentación).

    // Cheap perceptual sharpening: when rendering below native resolution,
    // the browser's own upscale-to-display-size pass softens the image.
    // A light contrast/saturation boost recovers perceived detail at
    // essentially zero cost (it's a compositor-level CSS filter, not a
    // render pass) - this is the same trick OpenScale uses, so MegaScale's
    // output isn't needlessly softer at an equivalent resolution saving.
    if (this.currentScale < 1) {
      this.canvas.style.filter = 'contrast(1.06) saturate(1.1)';
    } else {
      this.canvas.style.filter = '';
    }
  }

  getScale() {
    return this.currentScale;
  }

  reset() {
    this.currentScale = 1.0;
    this._framesSinceLastChange = 0;
    this._applyToCanvas();
  }
}

export default DynamicResolution;
