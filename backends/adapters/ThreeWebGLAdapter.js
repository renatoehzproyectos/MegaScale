/**
 * ThreeWebGLAdapter
 * Adaptador específico para Three.js WebGLRenderer.
 * Permite control de resolución dinámico y render-to-texture sin alterar
 * la relación de aspecto ni las matrices de cámara de Three.js.
 */

export class ThreeWebGLAdapter {
  constructor(renderer, canvas = null) {
    this.renderer = renderer;
    this.canvas = canvas || (renderer ? renderer.domElement : null);
    this.originalPixelRatio = renderer ? renderer.getPixelRatio() : 1;
    this.originalSize = { width: 0, height: 0 };
    this.currentScale = 1.0;

    if (this.renderer && typeof this.renderer.getSize === 'function') {
      const target = { width: 0, height: 0 };
      this.renderer.getSize(target);
      this.originalSize.width = target.width || (this.canvas ? this.canvas.width : 800);
      this.originalSize.height = target.height || (this.canvas ? this.canvas.height : 600);
    }
  }

  applyScale(scale) {
    if (!this.renderer) return;
    this.currentScale = scale;

    const scaledPixelRatio = this.originalPixelRatio * scale;
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(scaledPixelRatio);
    }

    if (typeof this.renderer.setSize === 'function' && this.originalSize.width > 0) {
      // updateStyle = false para mantener el tamaño CSS en pantalla
      this.renderer.setSize(this.originalSize.width, this.originalSize.height, false);
    }
  }

  restore() {
    if (!this.renderer) return;
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(this.originalPixelRatio);
    }
    if (typeof this.renderer.setSize === 'function' && this.originalSize.width > 0) {
      this.renderer.setSize(this.originalSize.width, this.originalSize.height, false);
    }
  }

  destroy() {
    this.restore();
  }
}

export default ThreeWebGLAdapter;
