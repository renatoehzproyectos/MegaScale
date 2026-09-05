/**
 * DynamicResolution (v1)
 * Versión inicial, NO predictiva todavía (eso llega en FASE 3 con el
 * Performance Predictor). Ajusta el render scale del canvas dentro de
 * límites seguros, con hysteresis simple para evitar oscilaciones
 * (Sección 9 del plan maestro).
 */

export class DynamicResolution {
  constructor({
    canvas,
    minScale = 0.5,
    maxScale = 1.0,
    step = 0.05,
    targetFps = 60,
    hysteresisFrames = 30, // nº de mediciones estables antes de permitir otro cambio
  } = {}) {
    this.canvas = canvas;
    this.minScale = minScale;
    this.maxScale = maxScale;
    this.step = step;
    this.targetFps = targetFps;
    this.hysteresisFrames = hysteresisFrames;

    this.currentScale = 1.0;
    this._framesSinceLastChange = 0;
    this._baseWidth = canvas ? canvas.width : 0;
    this._baseHeight = canvas ? canvas.height : 0;
  }

  setBaseResolution(width, height) {
    this._baseWidth = width;
    this._baseHeight = height;
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
    if (!this.canvas || !this._baseWidth || !this._baseHeight) return;
    const w = Math.round(this._baseWidth * this.currentScale);
    const h = Math.round(this._baseHeight * this.currentScale);
    this.canvas.width = w;
    this.canvas.height = h;
    // El estilo CSS se mantiene al tamaño de presentación original para que
    // el navegador haga el upscale final (pipeline de presentación).
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
