/**
 * PixiAdapter
 * Adaptador para PixiJS Application / Renderer.
 */

export class PixiAdapter {
  constructor(appOrRenderer, canvas = null) {
    this.renderer = appOrRenderer && appOrRenderer.renderer ? appOrRenderer.renderer : appOrRenderer;
    this.canvas = canvas || (this.renderer ? this.renderer.view : null);
    this.originalResolution = this.renderer ? this.renderer.resolution : 1;
    this.currentScale = 1.0;
  }

  applyScale(scale) {
    if (!this.renderer) return;
    this.currentScale = scale;
    if (typeof this.renderer.resolution !== 'undefined') {
      this.renderer.resolution = this.originalResolution * scale;
      if (typeof this.renderer.resize === 'function' && this.canvas) {
        this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight);
      }
    }
  }

  restore() {
    if (!this.renderer) return;
    this.renderer.resolution = this.originalResolution;
    if (typeof this.renderer.resize === 'function' && this.canvas) {
      this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight);
    }
  }

  destroy() {
    this.restore();
  }
}

export default PixiAdapter;
