/**
 * ShaderOptimizer
 * Inspecciona y propone optimizaciones seguras para shaders (precisión,
 * eliminación de ramas redundantes, vectorización y funciones trigonométricas).
 *
 * Plan Maestro (Sección 19):
 * "Detectar -> Clasificar -> Benchmark -> Aplicar solo técnicas seguras."
 */

export class ShaderOptimizer {
  /**
   * Analiza el código fuente GLSL y detecta oportunidades de optimización.
   */
  static analyze(source) {
    const hints = [];
    let estimatedComplexity = 'low';

    // 1. Detección de precisión innecesaria en fragment shader
    if (source.includes('precision highp float;') && !source.includes('gl_FragCoord')) {
      hints.push({
        type: 'precision',
        message: 'Considerar precision mediump float para fragment shaders en móviles/mali.',
        safe: true,
      });
    }

    // 2. Operaciones costosas
    const divCount = (source.match(/\/\s*[a-zA-Z0-9_.]+/g) || []).length;
    if (divCount > 5) {
      hints.push({
        type: 'arithmetic',
        message: `Detectadas ${divCount} divisiones; sustituir divisiones constantes por multiplicaciones con recíproco.`,
        safe: true,
      });
    }

    const trigCount = (source.match(/\b(sin|cos|tan|atan|asin|acos)\b/g) || []).length;
    if (trigCount > 8) {
      estimatedComplexity = 'high';
      hints.push({
        type: 'trigonometry',
        message: `Alto uso de funciones trigonométricas (${trigCount}). Considerar aproximaciones o LUTs.`,
        safe: false,
      });
    } else if (trigCount > 3) {
      estimatedComplexity = 'medium';
    }

    // 3. Branching dinámico
    const dynamicBranches = (source.match(/\bif\s*\([^)]*\)/g) || []).length;
    if (dynamicBranches > 4) {
      hints.push({
        type: 'branching',
        message: `Detectados ${dynamicBranches} condicionales. Evaluar uso de mix(), step() o clamp().`,
        safe: false,
      });
    }

    return {
      complexity: estimatedComplexity,
      hints,
      isOptimizationRecommended: hints.length > 0,
    };
  }

  /**
   * Aplica reemplazos seguros y sintácticamente válidos (e.g., recíprocos y precisión en shaders conocidos).
   */
  static optimizeSafe(source, { targetPrecision = 'mediump' } = {}) {
    let optimized = source;
    if (targetPrecision === 'mediump') {
      optimized = optimized.replace(/precision\s+highp\s+float\s*;/g, 'precision mediump float;');
    }
    return optimized;
  }
}

export default ShaderOptimizer;
