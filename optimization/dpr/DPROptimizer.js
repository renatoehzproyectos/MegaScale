/**
 * DPROptimizer (Sección 15 del plan maestro)
 * Prueba valores decrecientes de devicePixelRatio y se queda con el más
 * bajo que siga cumpliendo el target de FPS, dentro de un mínimo de calidad.
 * No modifica el DPR real del navegador (eso no es posible), sino el DPR
 * "efectivo" que usa MegaScale para calcular el tamaño del canvas.
 */

const CANDIDATE_STEPS = [2.0, 1.75, 1.5, 1.25, 1.0];

export class DPROptimizer {
  constructor({ minDpr = 1.0, maxDpr = null, targetFps = 60 } = {}) {
    this.minDpr = minDpr;
    this.maxDpr = maxDpr || (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    this.targetFps = targetFps;

    this.candidates = CANDIDATE_STEPS.filter((v) => v <= this.maxDpr && v >= this.minDpr);
    if (this.candidates.length === 0 || this.candidates[0] < this.maxDpr) {
      this.candidates = [this.maxDpr, ...this.candidates];
    }

    this.effectiveDpr = this.maxDpr;
    this._testIndex = 0;
    this._done = false;
    this._resultsByDpr = {};
  }

  isDone() {
    return this._done;
  }

  getCurrentCandidate() {
    return this.candidates[this._testIndex];
  }

  getEffectiveDpr() {
    return this.effectiveDpr;
  }

  /**
   * Registra el resultado de benchmark del candidato actual y avanza.
   * Devuelve true si terminó la búsqueda.
   */
  recordResult(stats) {
    if (this._done) return true;

    const dpr = this.getCurrentCandidate();
    this._resultsByDpr[dpr] = stats;

    // Si este DPR ya cumple el target, lo tomamos y paramos (es el más alto
    // que cumple, porque probamos de mayor a menor).
    if (stats.fps >= this.targetFps * 0.95) {
      this.effectiveDpr = dpr;
      this._done = true;
      return true;
    }

    this._testIndex++;
    if (this._testIndex >= this.candidates.length) {
      // Ninguno cumplió perfectamente: usar el que dio mejor FPS.
      const best = Object.entries(this._resultsByDpr).sort(
        (a, b) => b[1].fps - a[1].fps
      )[0];
      this.effectiveDpr = best ? Number(best[0]) : this.minDpr;
      this._done = true;
      return true;
    }

    return false;
  }

  reset() {
    this._testIndex = 0;
    this._done = false;
    this._resultsByDpr = {};
    this.effectiveDpr = this.maxDpr;
  }
}

export default DPROptimizer;
