/**
 * OptimizationGraph (Sección 23 y 24 del plan maestro)
 *
 * No prueba todas las combinaciones posibles de módulos (DRS × FSR × RCAS ×
 * FXAA × SMAA...). En vez de eso, usa heurísticas basadas en:
 *   - GPU tier detectado (benchmark/gpu/GPUTiering)
 *   - Bottleneck detectado (BottleneckEngine)
 *   - Historial de resultados netos anteriores (qué funcionó/no funcionó)
 *
 * para proponer una configuración inicial razonable, y luego el
 * NET_PERFORMANCE (Sección 23) decide si cada módulo se queda o se apaga.
 */

const PROFILE_BY_TIER = {
  0: 'ultra-performance',
  1: 'ultra-performance',
  2: 'performance',
  3: 'balanced',
  4: 'quality',
  5: 'quality',
};

const AA_BY_PROFILE = {
  'ultra-performance': 'off',
  'performance': 'fxaa',
  'balanced': 'smaa',
  'quality': 'smaa',
};

const UPSCALE_BY_PROFILE = {
  'ultra-performance': 'none',
  'performance': 'fsr',
  'balanced': 'fsr',
  'quality': 'temporal', // requiere WebGPU; con fallback a fsr si no disponible
};

export class OptimizationGraph {
  constructor() {
    // Historial de resultados netos por combinación de módulos, para
    // aprender qué evitar la próxima vez (Sección 24: "resultados anteriores").
    this.moduleHistory = new Map(); // key: moduleName -> { positiveRuns, negativeRuns }
  }

  /**
   * Propone una configuración inicial razonable sin probar combinaciones
   * exhaustivas, a partir del tier de GPU y el bottleneck detectado.
   */
  proposeConfiguration({ gpuTier, bottleneck, webgpuAvailable = false }) {
    const profile = PROFILE_BY_TIER[gpuTier] ?? 'balanced';

    // Regla de la Sección 20: si el bottleneck es CPU-bound, no tiene
    // sentido insistir en bajar resolución/upscaling agresivo.
    let upscaler = UPSCALE_BY_PROFILE[profile];
    if (upscaler === 'temporal' && !webgpuAvailable) upscaler = 'fsr';

    if (bottleneck === 'cpu-bound') {
      upscaler = 'none';
    }

    const aa = AA_BY_PROFILE[profile];

    const config = {
      profile,
      upscaler: this._isModuleDisabled(upscaler) ? 'none' : upscaler,
      aa: this._isModuleDisabled(aa) ? 'off' : aa,
      dynamicResolution: bottleneck !== 'cpu-bound',
    };

    return config;
  }

  /**
   * Registra el resultado neto (Sección 23) de un módulo específico para
   * que futuras propuestas eviten repetir módulos que ya demostraron ser
   * negativos en esta sesión.
   */
  recordResult(moduleName, netGainFps) {
    const entry = this.moduleHistory.get(moduleName) || { positiveRuns: 0, negativeRuns: 0 };
    if (netGainFps > 0) entry.positiveRuns++;
    else entry.negativeRuns++;
    this.moduleHistory.set(moduleName, entry);
  }

  /**
   * Un módulo se considera "descartado" si acumuló al menos 2 resultados
   * negativos y ningún positivo — evita reintentarlo indefinidamente en
   * la misma sesión (regla de oro: sin ganancia neta medible, no se usa).
   */
  _isModuleDisabled(moduleName) {
    const entry = this.moduleHistory.get(moduleName);
    if (!entry) return false;
    return entry.negativeRuns >= 2 && entry.positiveRuns === 0;
  }

  isModuleDisabled(moduleName) {
    return this._isModuleDisabled(moduleName);
  }

  reset() {
    this.moduleHistory.clear();
  }
}

export default OptimizationGraph;
