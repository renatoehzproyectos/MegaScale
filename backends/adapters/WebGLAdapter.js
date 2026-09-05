/**
 * WebGLAdapter
 * Adaptador estándar para juegos WebGL1 / WebGL2 sin framework.
 */

export class WebGLAdapter {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    this.gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;
    this.baseWidth = canvas ? canvas.width : 800;
    this.baseHeight = canvas ? canvas.height : 600;
    this.currentScale = 1.0;
  }

  setBaseSize(width, height) {
    this.baseWidth = width;
    this.baseHeight = height;
  }

  applyScale(scale) {
    if (!this.canvas) return;
    this.currentScale = scale;
    const targetW = Math.max(64, Math.round(this.baseWidth * scale));
    const targetH = Math.max(64, Math.round(this.baseHeight * scale));

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      if (this.gl) {
        this.gl.viewport(0, 0, targetW, targetH);
      }
    }
  }

  getRenderTexture() {
    // Para raw WebGL el render va al backbuffer del canvas por defecto
    return null;
  }

  destroy() {
    if (this.canvas) {
      this.canvas.width = this.baseWidth;
      this.canvas.height = this.baseHeight;
    }
  }
}

export default WebGLAdapter;
