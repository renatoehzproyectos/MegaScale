/**
 * ProfileManager
 * Gestión de perfiles de optimización preconfigurados (Plan Maestro Sección 32).
 */

export const PROFILES = {
  'ultra-performance': {
    name: 'ultra-performance',
    minScale: 0.35,
    maxScale: 0.55,
    defaultScale: 0.45,
    upscaler: 'easu',
    aa: 'off',
    sharpness: 0.8,
    drsAggressiveness: 'aggressive',
    description: 'Máximo FPS a costa de calidad visual. Ideal para GPUs muy débiles (Tier 0-1).',
  },
  'performance': {
    name: 'performance',
    minScale: 0.50,
    maxScale: 0.65,
    defaultScale: 0.60,
    upscaler: 'easu',
    aa: 'fxaa',
    sharpness: 0.6,
    drsAggressiveness: 'high',
    description: 'Excelente compromiso con ganancia notable de FPS y AA ligero (Tier 2).',
  },
  'balanced': {
    name: 'balanced',
    minScale: 0.60,
    maxScale: 0.80,
    defaultScale: 0.75,
    upscaler: 'easu',
    aa: 'smaa',
    sharpness: 0.4,
    drsAggressiveness: 'moderate',
    description: 'Equilibrio óptimo entre nitidez y rendimiento sostenido a 60 FPS (Tier 3).',
  },
  'quality': {
    name: 'quality',
    minScale: 0.75,
    maxScale: 0.95,
    defaultScale: 0.85,
    upscaler: 'temporal',
    aa: 'smaa',
    sharpness: 0.3,
    drsAggressiveness: 'smooth',
    description: 'Máxima fidelidad visual con reconstrucción temporal o SMAA (Tier 4-5).',
  },
  'auto': {
    name: 'auto',
    description: 'MegaScale selecciona y ajusta dinámicamente el perfil óptimo según GPU Tier y cuello de botella.',
  },
};

export class ProfileManager {
  constructor(initialProfile = 'auto') {
    this.activeProfileName = initialProfile;
    this.activeProfile = this.getProfile(initialProfile);
  }

  getProfile(name) {
    return PROFILES[name] || PROFILES['balanced'];
  }

  setProfile(name) {
    if (PROFILES[name]) {
      this.activeProfileName = name;
      this.activeProfile = PROFILES[name];
    }
  }

  /**
   * Resuelve el perfil automático adecuado a partir de la GPU y cuello de botella.
   */
  resolveAutoProfile(gpuTier, bottleneck = 'unknown') {
    if (bottleneck === 'cpu') {
      // En CPU-bound, no conviene bajar agresivamente la resolución
      return PROFILES['balanced'];
    }

    switch (gpuTier) {
      case 0:
      case 1:
        return PROFILES['ultra-performance'];
      case 2:
        return PROFILES['performance'];
      case 3:
        return PROFILES['balanced'];
      case 4:
      case 5:
      default:
        return PROFILES['quality'];
    }
  }
}

export default ProfileManager;
