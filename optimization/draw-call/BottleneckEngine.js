/**
 * BottleneckEngine (Sección 20 del plan maestro)
 *
 * Regla central:
 *   GPU-bound     -> Resolution / Upscaling
 *   CPU-bound      -> No seguir bajando resolución
 *   Memory-bound   -> Memory strategies
 *
 * Método de detección (heurístico, sin acceso a contadores GPU nativos que
 * el navegador no expone de forma fiable): correlaciona cambios de render
 * scale con cambios de FPS.
 *
 *   - Si bajar la escala mejora el FPS de forma proporcional  -> GPU-bound.
 *   - Si bajar la escala NO mejora el FPS (o casi nada)        -> CPU-bound
 *     (el juego está limitado por lógica/draw calls, no por píxeles).
 *   - Si el frame time es inestable con varianza alta y hay señales de
 *     crecimiento de memoria -> memory-bound.
 */

export class BottleneckEngine {
  constructor({ correlationWindow = 6 } = {}) {
    this.correlationWindow = correlationWindow;
    this.history = []; // { scale, fps, timestamp }
  }

  record(scale, fps) {
    this.history.push({ scale, fps, timestamp: Date.now() });
    if (this.history.length > this.correlationWindow) this.history.shift();
  }

  /**
   * Calcula una correlación simple entre 1/scale^2 (proxy de "cantidad de
   * píxeles a renderizar") y el FPS observado. Correlación alta y positiva
   * en esa relación inversa => GPU-bound. Correlación cercana a 0 => CPU-bound.
   */
  _correlationPixelsVsFps() {
    if (this.history.length < 3) return null;

    const xs = this.history.map((h) => 1 / (h.scale * h.scale));
    const ys = this.history.map((h) => h.fps);
    const n = xs.length;

    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;

    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    if (varX === 0 || varY === 0) return 0;
    return cov / Math.sqrt(varX * varY); // Pearson, rango [-1, 1]
  }

  /**
   * @param {Object} extra - señales adicionales opcionales
   * @param {number} [extra.frameTimeVariance]
   * @param {number} [extra.memoryGrowthMBPerMin]
   */
  detect(extra = {}) {
    const correlation = this._correlationPixelsVsFps();

    // Memory-bound tiene prioridad si hay señal clara de crecimiento de
    // memoria sostenido, porque puede terminar en context loss si se ignora.
    if (extra.memoryGrowthMBPerMin && extra.memoryGrowthMBPerMin > 5) {
      return {
        bottleneck: 'memory-bound',
        confidence: 'medium',
        recommendation: 'memory strategies (liberar recursos, reducir historia de buffers)',
        correlation,
      };
    }

    if (correlation === null) {
      return {
        bottleneck: 'unknown',
        confidence: 'low',
        recommendation: 'recolectar más muestras antes de decidir',
        correlation,
      };
    }

    // Correlación fuerte y NEGATIVA entre "más píxeles" y FPS (a más
    // píxeles, menos FPS) indica que el render scale sí importa -> GPU-bound.
    if (correlation < -0.6) {
      return {
        bottleneck: 'gpu-bound',
        confidence: 'high',
        recommendation: 'resolution / upscaling',
        correlation,
      };
    }

    // Correlación débil: cambiar la resolución casi no afecta el FPS ->
    // el cuello de botella está en otro lado (CPU/draw-calls/lógica).
    if (Math.abs(correlation) < 0.3) {
      return {
        bottleneck: 'cpu-bound',
        confidence: 'medium',
        recommendation: 'no seguir bajando resolución; foco en draw-call awareness',
        correlation,
      };
    }

    return {
      bottleneck: 'mixed',
      confidence: 'low',
      recommendation: 'señal ambigua, mantener configuración actual y seguir midiendo',
      correlation,
    };
  }

  reset() {
    this.history = [];
  }
}

export default BottleneckEngine;
