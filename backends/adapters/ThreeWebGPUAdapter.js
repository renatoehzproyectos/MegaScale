/**
 * ThreeWebGPUAdapter
 * Adaptador específico para Three.js WebGPURenderer.
 */

export class ThreeWebGPUAdapter {
  constructor(renderer, canvas = null) {
    this.renderer = renderer;
    this.canvas = canvas || (renderer ? renderer.domElement : null);
    this.originalPixelRatio = renderer ? renderer.getPixelRatio() : 1;
    this.currentScale = 1.0;
  }

  applyScale(scale) {
    if (!this.renderer) return;
    this.currentScale = scale;
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(this.originalPixelRatio * scale);
    }
  }

  restore() {
    if (!this.renderer) return;
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(this.originalPixelRatio);
    }
  }

  destroy() {
    this.restore();
  }
}

export default ThreeWebGPUAdapter;
