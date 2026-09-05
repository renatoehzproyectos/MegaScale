/**
 * PerformancePredictor (Sección 7 y 8 del plan maestro)
 *
 * Aprende la relación aproximada `render scale -> FPS` a partir de muestras
 * reales tomadas durante el juego (no requiere entrenamiento offline).
 * Usa un ajuste por mínimos cuadrados sobre el modelo:
 *
 *   FPS ≈ a / scale^2 + b
 *
 * porque el coste de renderizado escala aproximadamente con el número de
 * píxeles (~scale^2) en cargas GPU-bound. No es un modelo perfecto (por eso
 * el plan pide protección contra predicciones incorrectas), pero es mucho
 * mejor que ir probando escalas al azar.
 *
 * Con menos de 2 muestras no hay suficiente información para ajustar el
 * modelo, así que se recurre a un paso conservador fijo.
 */

export class PerformancePredictor {
  constructor({ maxSamples = 12, minSamplesForFit = 3 } = {}) {
    this.maxSamples = maxSamples;
    this.minSamplesForFit = minSamplesForFit;
    this.samples = []; // { scale, fps }
    this.model = null; // { a, b }
    this._lastPredictionWasWrong = 0; // contador para "protección"
  }

  addSample(scale, fps) {
    if (scale <= 0 || fps <= 0) return; // ignorar datos inválidos, nunca asumir

    this.samples.push({ scale, fps });
    if (this.samples.length > this.maxSamples) this.samples.shift();

    if (this.samples.length >= this.minSamplesForFit) {
      this._fitModel();
    }
  }

  /**
   * Ajuste lineal de FPS vs 1/scale^2 (linealización del modelo a/scale^2 + b).
   */
  _fitModel() {
    const xs = this.samples.map((s) => 1 / (s.scale * s.scale));
    const ys = this.samples.map((s) => s.fps);
    const n = xs.length;

    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
    const sumXX = xs.reduce((acc, x) => acc + x * x, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-9) {
      this.model = null; // datos degenerados (todas las mismas escalas)
      return;
    }

    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;

    this.model = { a, b };
  }

  hasModel() {
    return this.model !== null;
  }

  /**
   * Predice el FPS esperado para una escala dada. Devuelve null si no hay
   * modelo suficiente todavía.
   */
  predictFps(scale) {
    if (!this.model || scale <= 0) return null;
    const { a, b } = this.model;
    return a / (scale * scale) + b;
  }

  /**
   * Dado un FPS objetivo, resuelve la escala aproximada necesaria:
   *   target = a/scale^2 + b  =>  scale = sqrt(a / (target - b))
   * Devuelve null si el modelo no puede alcanzar el target (ej. b > target,
   * lo que significa que ni a escala 0 se llegaría, señal de que el cuello
   * de botella no es de resolución -> ver BottleneckEngine).
   */
  predictScaleForTarget(targetFps, { minScale = 0.3, maxScale = 1.0 } = {}) {
    if (!this.model) return null;

    const { a, b } = this.model;
    const denom = targetFps - b;

    if (a <= 0 || denom <= 0) {
      // El modelo no explica una ganancia alcanzable solo con resolución.
      return null;
    }

    const rawScale = Math.sqrt(a / denom);
    return Number(Math.min(maxScale, Math.max(minScale, rawScale)).toFixed(3));
  }

  /**
   * Protección contra predicciones incorrectas (Sección 8): compara la
   * predicción previa contra el resultado real observado. Si el error es
   * grande varias veces seguidas, se recomienda descartar el modelo y volver
   * a un ajuste incremental más conservador.
   */
  validatePrediction(predictedFps, actualFps, { toleranceRatio = 0.15 } = {}) {
    if (predictedFps === null) return true;

    const error = Math.abs(actualFps - predictedFps) / Math.max(actualFps, 1);
    const isGoodPrediction = error <= toleranceRatio;

    if (!isGoodPrediction) {
      this._lastPredictionWasWrong++;
    } else {
      this._lastPredictionWasWrong = 0;
    }

    return isGoodPrediction;
  }

  shouldDistrustModel() {
    return this._lastPredictionWasWrong >= 2;
  }

  reset() {
    this.samples = [];
    this.model = null;
    this._lastPredictionWasWrong = 0;
  }
}

export default PerformancePredictor;
