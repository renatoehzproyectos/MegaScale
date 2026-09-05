/**
 * WebGLBackend
 * Utilidades compartidas para compilar/enlazar shaders, dibujar un
 * fullscreen-quad y crear framebuffers intermedios para encadenar pasos de
 * post-proceso (EASU -> RCAS -> FXAA/SMAA). Todo dentro de WebGL2.
 */

export class WebGLBackend {
  constructor(gl) {
    this.gl = gl;
    this._quadVAO = null;
    this._programCache = new Map();
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`[MegaScale] Error compilando shader: ${info}`);
    }
    return shader;
  }

  /**
   * Crea (o reutiliza desde cache) un WebGLProgram a partir de fuente
   * vertex/fragment. Si no se pasa vertexSrc, usa el vertex por defecto
   * (fullscreen quad con UV).
   */
  createProgram(fragmentSrc, vertexSrc = DEFAULT_VERTEX_SHADER, cacheKey = null) {
    const key = cacheKey || fragmentSrc;
    if (this._programCache.has(key)) return this._programCache.get(key);

    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vertexSrc);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentSrc);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`[MegaScale] Error enlazando programa: ${info}`);
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this._programCache.set(key, program);
    return program;
  }

  getQuad() {
    if (this._quadVAO) return this._quadVAO;
    const gl = this.gl;

    const vertices = new Float32Array([
      // posición   uv
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0); // aPosition
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); // aUV
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
    this._quadVAO = vao;
    return vao;
  }

  drawQuad() {
    const gl = this.gl;
    gl.bindVertexArray(this.getQuad());
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Crea un framebuffer + textura de color para usar como render target
   * intermedio en la cadena de post-proceso.
   */
  createRenderTarget(width, height) {
    const gl = this.gl;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[MegaScale] Framebuffer incompleto: 0x${status.toString(16)}`);
    }

    return { fbo, texture, width, height };
  }

  /**
   * Libera un render target creado con createRenderTarget. Importante para
   * el Memory Manager (Sección 18) — nunca dejar recursos huérfanos.
   */
  destroyRenderTarget(rt) {
    const gl = this.gl;
    if (!rt) return;
    if (rt.fbo) gl.deleteFramebuffer(rt.fbo);
    if (rt.texture) gl.deleteTexture(rt.texture);
  }

  destroy() {
    const gl = this.gl;
    for (const program of this._programCache.values()) {
      gl.deleteProgram(program);
    }
    this._programCache.clear();
    if (this._quadVAO) gl.deleteVertexArray(this._quadVAO);
    this._quadVAO = null;
  }
}

export const DEFAULT_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export default WebGLBackend;
