/**
 * Profiler
 * Monitor de FPS / frame time. Mantiene un historial corto para permitir
 * detección de tendencias y estabilidad (usado por el Controller y el
 * Performance Predictor más adelante en FASE 3).
 */

export class Profiler {
  constructor({ historySize = 120 } = {}) {
    this.historySize = historySize;
    this.frameTimes = [];
    this.lastTimestamp = null;
    this.frameCount = 0;
    this._running = false;
  }

  start() {
    this._running = true;
    this.lastTimestamp = null;
  }

  stop() {
    this._running = false;
  }

  /**
   * Debe llamarse una vez por frame (idealmente dentro de requestAnimationFrame).
   * @param {number} timestamp - DOMHighResTimeStamp
   */
  tick(timestamp) {
    if (!this._running) return null;

    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      return null;
    }

    const delta = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.frameCount++;

    this.frameTimes.push(delta);
    if (this.frameTimes.length > this.historySize) {
      this.frameTimes.shift();
    }

    return this.getStats();
  }

  getStats() {
    if (this.frameTimes.length === 0) {
      return { fps: 0, frameTime: 0, variance: 0, samples: 0 };
    }

    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    const avgFrameTime = sum / this.frameTimes.length;
    const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;

    const variance =
      this.frameTimes.reduce((acc, t) => acc + Math.pow(t - avgFrameTime, 2), 0) /
      this.frameTimes.length;

    return {
      fps: Number(fps.toFixed(2)),
      frameTime: Number(avgFrameTime.toFixed(3)),
      variance: Number(variance.toFixed(3)),
      samples: this.frameTimes.length,
    };
  }

  /**
   * Devuelve 'up' | 'down' | 'stable' comparando la primera y segunda mitad
   * del historial. Base para la detección de tendencias (sección 7 del plan).
   */
  getTrend() {
    if (this.frameTimes.length < 10) return 'stable';

    const mid = Math.floor(this.frameTimes.length / 2);
    const firstHalf = this.frameTimes.slice(0, mid);
    const secondHalf = this.frameTimes.slice(mid);

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const diff = avg(secondHalf) - avg(firstHalf);

    // Frame time subiendo => rendimiento empeorando (fps bajando).
    const threshold = 0.5; // ms, para evitar ruido
    if (diff > threshold) return 'down';
    if (diff < -threshold) return 'up';
    return 'stable';
  }

  reset() {
    this.frameTimes = [];
    this.lastTimestamp = null;
    this.frameCount = 0;
  }
}

export default Profiler;
