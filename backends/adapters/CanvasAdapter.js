/**
 * CanvasAdapter
 * Adaptador para Canvas 2D fallback.
 */

export class CanvasAdapter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.baseWidth = canvas ? canvas.width : 800;
    this.baseHeight = canvas ? canvas.height : 600;
    this.currentScale = 1.0;
  }

  applyScale(scale) {
    if (!this.canvas) return;
    this.currentScale = scale;
    const targetW = Math.max(32, Math.round(this.baseWidth * scale));
    const targetH = Math.max(32, Math.round(this.baseHeight * scale));

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
  }

  restore() {
    if (this.canvas) {
      this.canvas.width = this.baseWidth;
      this.canvas.height = this.baseHeight;
    }
  }

  destroy() {
    this.restore();
  }
}

export default CanvasAdapter;
