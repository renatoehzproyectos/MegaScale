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
    // NOTE: canvas.width/height resizing is now owned exclusively by
    // DynamicResolution._applyToCanvas(). This adapter used to ALSO
    // resize the canvas here, using its own independently-captured
    // baseWidth/baseHeight - meaning on every single scale change the
    // live WebGL backbuffer got reallocated twice in the same frame from
    // two different tracked "base" sizes. Resizing an active WebGL
    // canvas is expensive (full backbuffer reallocation); doing it twice
    // per change, every change, under real GPU load, was the crash.
    // This now just re-syncs the viewport to whatever size the canvas
    // currently is - no independent resize authority.
    this.currentScale = scale;
    if (this.gl && this.canvas) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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
