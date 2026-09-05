/**
 * RendererDetector
 * Detecta qué está usando el juego (WebGL1/WebGL2/WebGPU/Canvas2D) y sus
 * capacidades reales. Regla de oro del proyecto: NUNCA asumir una capacidad,
 * siempre comprobarla en runtime.
 */

export class RendererDetector {
  constructor(canvas) {
    this.canvas = canvas;
    this.result = null;
  }

  /**
   * Ejecuta la detección completa. Devuelve un objeto "EnvironmentReport".
   */
  async detect() {
    const report = {
      renderer: 'unknown',
      contextType: null,
      webgl1: false,
      webgl2: false,
      webgpu: false,
      canvas2d: false,
      extensions: [],
      capabilities: {},
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      canvasSize: {
        width: this.canvas ? this.canvas.width : 0,
        height: this.canvas ? this.canvas.height : 0,
      },
      gpu: await this._detectGPU(),
      engine: this._detectEngine(),
    };

    // Orden de comprobación: WebGPU -> WebGL2 -> WebGL1 -> Canvas2D
    if (await this._checkWebGPU()) {
      report.webgpu = true;
      report.renderer = 'webgpu';
      report.contextType = 'webgpu';
    } else if (this._checkWebGL2(report)) {
      report.webgl2 = true;
      report.renderer = 'webgl2';
      report.contextType = 'webgl2';
    } else if (this._checkWebGL1(report)) {
      report.webgl1 = true;
      report.renderer = 'webgl1';
      report.contextType = 'webgl';
    } else if (this._checkCanvas2D()) {
      report.canvas2d = true;
      report.renderer = 'canvas2d';
      report.contextType = '2d';
    }

    this.result = report;
    return report;
  }

  _detectEngine() {
    // Comprobación NO invasiva: solo mira globals conocidos, sin asumir nada.
    if (typeof window === 'undefined') return 'unknown';
    if (window.THREE) return 'threejs';
    if (window.BABYLON) return 'babylon';
    if (window.PIXI) return 'pixijs';
    return 'unknown';
  }

  async _detectGPU() {
    // Intenta usar WEBGL_debug_renderer_info como fallback informativo.
    // No es 100% fiable (puede estar bloqueado por el navegador), así que
    // el resultado se marca como "approximate".
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
      if (!gl) return { vendor: 'unknown', renderer: 'unknown', approximate: true };

      const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!dbgInfo) return { vendor: 'unknown', renderer: 'unknown', approximate: true };

      return {
        vendor: gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL) || 'unknown',
        renderer: gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || 'unknown',
        approximate: true,
      };
    } catch (e) {
      return { vendor: 'unknown', renderer: 'unknown', approximate: true, error: String(e) };
    }
  }

  async _checkWebGPU() {
    if (typeof navigator === 'undefined' || !navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch (e) {
      return false;
    }
  }

  _checkWebGL2(report) {
    if (!this.canvas) return false;
    const gl = this.canvas.getContext('webgl2');
    if (!gl) return false;
    report.extensions = gl.getSupportedExtensions() || [];
    report.capabilities = {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      maxSamples: this._safeGet(gl, 'MAX_SAMPLES'),
    };
    return true;
  }

  _checkWebGL1(report) {
    if (!this.canvas) return false;
    const gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
    if (!gl) return false;
    report.extensions = gl.getSupportedExtensions() || [];
    report.capabilities = {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    };
    return true;
  }

  _checkCanvas2D() {
    if (!this.canvas) return false;
    return !!this.canvas.getContext('2d');
  }

  _safeGet(gl, paramName) {
    try {
      return gl.getParameter(gl[paramName]);
    } catch (e) {
      return null;
    }
  }
}

export default RendererDetector;
