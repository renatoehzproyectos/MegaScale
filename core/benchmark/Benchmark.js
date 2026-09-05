/**
 * Benchmark
 * Mide un baseline inicial y permite ejecutar pruebas cortas (Sección 5 y 6
 * del plan maestro) para comparar configuraciones de forma objetiva.
 */

import { Profiler } from '../profiler/Profiler.js';

export class Benchmark {
  constructor({ sampleDurationMs = 1000 } = {}) {
    this.sampleDurationMs = sampleDurationMs;
    this.baseline = null;
    this.results = [];
  }

  /**
   * Ejecuta una medición usando un Profiler ya corriendo (o crea uno propio
   * si se le pasa una función `tickSource` que produzca timestamps).
   */
  async measure(profiler, durationMs = this.sampleDurationMs) {
    return new Promise((resolve) => {
      const start = performance.now();
      const check = () => {
        const now = performance.now();
        if (now - start >= durationMs) {
          resolve(profiler.getStats());
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  }

  async runBaseline(profiler, meta = {}) {
    const stats = await this.measure(profiler);
    this.baseline = { ...stats, ...meta, label: 'BASELINE', timestamp: Date.now() };
    return this.baseline;
  }

  /**
   * Registra el resultado de una prueba (TEST A, TEST B, ...) comparado
   * contra el baseline.
   */
  async runTest(label, profiler, config = {}) {
    const stats = await this.measure(profiler);
    const netGain = this.baseline ? stats.fps - this.baseline.fps : null;

    const result = {
      label,
      config,
      ...stats,
      netGainFps: netGain !== null ? Number(netGain.toFixed(2)) : null,
      timestamp: Date.now(),
    };

    this.results.push(result);
    return result;
  }

  /**
   * Regla central del plan: toda optimización debe demostrar ganancia neta.
   * costFps es el coste estimado de aplicar la optimización (overhead propio).
   */
  static isNetPositive(gainFps, costFps = 0) {
    return gainFps - costFps > 0;
  }

  getBestResult() {
    if (this.results.length === 0) return null;
    return this.results.reduce((best, r) => {
      if (best === null) return r;
      if ((r.netGainFps ?? -Infinity) > (best.netGainFps ?? -Infinity)) return r;
      return best;
    }, null);
  }

  reset() {
    this.baseline = null;
    this.results = [];
  }
}

export default Benchmark;
