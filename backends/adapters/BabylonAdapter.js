/**
 * BabylonAdapter
 * Adaptador para Babylon.js Engine (`BABYLON.Engine`).
 * Controla hardware scaling level (`engine.setHardwareScalingLevel(1 / scale)`).
 */

export class BabylonAdapter {
  constructor(engine, canvas = null) {
    this.engine = engine;
    this.canvas = canvas || (engine ? engine.getRenderingCanvas() : null);
    this.originalHardwareScaling = engine ? engine.getHardwareScalingLevel() : 1;
    this.currentScale = 1.0;
  }

  applyScale(scale) {
    if (!this.engine) return;
    this.currentScale = scale;
    // Babylon usa hardwareScalingLevel: 1.0 = normal, 2.0 = media resolución (scale 0.5)
    const level = 1.0 / Math.max(0.1, scale);
    if (typeof this.engine.setHardwareScalingLevel === 'function') {
      this.engine.setHardwareScalingLevel(level);
    }
  }

  restore() {
    if (!this.engine) return;
    if (typeof this.engine.setHardwareScalingLevel === 'function') {
      this.engine.setHardwareScalingLevel(this.originalHardwareScaling);
    }
  }

  destroy() {
    this.restore();
  }
}

export default BabylonAdapter;
