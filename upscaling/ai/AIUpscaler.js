/**
 * AIUpscaler
 * Módulo experimental de upscaling guiado por reconstrucción de alta frecuencia
 * (edge-directed super-resolution / neural residual filter).
 *
 * Principio del Plan Maestro (Sección 27):
 * "El AI upscaling debe ser experimental al principio. Sólo activar si el coste
 * es aceptable y la ganancia neta es positiva. No asumir que AI = más FPS."
 */

export class AIUpscaler {
  constructor(gl = null) {
    this.gl = gl;
    this.program = null;
    this.enabled = false;
    this.lastInferenceMs = 0;
  }

  /**
   * Inicializa el shader de upscaling en WebGL2.
   */
  init(gl = this.gl) {
    this.gl = gl;
    if (!this.gl) return false;

    try {
      this._buildProgram();
      this.enabled = true;
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MegaScale AIUpscaler] Fallo al compilar shader:', e);
      this.enabled = false;
      return false;
    }
  }

  _buildProgram() {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(
      vs,
      `#version 300 es
      layout(location = 0) in vec2 aPosition;
      layout(location = 1) in vec2 aUV;
      out vec2 vUV;
      void main() {
        vUV = aUV;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`
    );
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, AI_UPSCALER_FRAGMENT_SHADER);
    gl.compileShader(fs);

    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error(`AIUpscaler fragment shader error: ${log}`);
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = prog;
    this.uInputTexture = gl.getUniformLocation(prog, 'uInputTexture');
    this.uInputResolution = gl.getUniformLocation(prog, 'uInputResolution');
    this.uOutputResolution = gl.getUniformLocation(prog, 'uOutputResolution');
    this.uEdgeSharpness = gl.getUniformLocation(prog, 'uEdgeSharpness');
  }

  /**
   * Ejecuta el upscaler.
   */
  render(sourceTexture, inputWidth, inputHeight, outputWidth, outputHeight, sharpness = 0.7) {
    if (!this.enabled || !this.program || !this.gl) return;

    const gl = this.gl;
    const t0 = performance.now();

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(this.uInputTexture, 0);
    gl.uniform2f(this.uInputResolution, inputWidth, inputHeight);
    gl.uniform2f(this.uOutputResolution, outputWidth, outputHeight);
    gl.uniform1f(this.uEdgeSharpness, sharpness);

    this.lastInferenceMs = performance.now() - t0;
  }

  /**
   * Evalúa si el coste en ms de la inferencia compensa la ganancia.
   */
  isNetPositive(fpsGained, targetFps = 60) {
    const frameBudgetMs = 1000 / targetFps;
    return this.lastInferenceMs < frameBudgetMs * 0.2 && fpsGained > 0;
  }

  destroy() {
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    this.enabled = false;
  }
}

export const AI_UPSCALER_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uInputTexture;
uniform vec2 uInputResolution;
uniform vec2 uOutputResolution;
uniform float uEdgeSharpness;

in vec2 vUV;
out vec4 fragColor;

// Luminancia perceptual
float getLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 texel = 1.0 / uInputResolution;
  vec2 pos = vUV * uInputResolution - 0.5;
  vec2 f = fract(pos);
  vec2 baseUV = (floor(pos) + 0.5) * texel;

  // Muestreo 4x4 vecindad
  vec3 c00 = texture(uInputTexture, baseUV + vec2(-texel.x, -texel.y)).rgb;
  vec3 c10 = texture(uInputTexture, baseUV + vec2(0.0, -texel.y)).rgb;
  vec3 c20 = texture(uInputTexture, baseUV + vec2(texel.x, -texel.y)).rgb;

  vec3 c01 = texture(uInputTexture, baseUV + vec2(-texel.x, 0.0)).rgb;
  vec3 c11 = texture(uInputTexture, baseUV).rgb;
  vec3 c21 = texture(uInputTexture, baseUV + vec2(texel.x, 0.0)).rgb;

  vec3 c02 = texture(uInputTexture, baseUV + vec2(-texel.x, texel.y)).rgb;
  vec3 c12 = texture(uInputTexture, baseUV + vec2(0.0, texel.y)).rgb;
  vec3 c22 = texture(uInputTexture, baseUV + vec2(texel.x, texel.y)).rgb;

  // Gradientes direccionales
  float l00 = getLuma(c00), l10 = getLuma(c10), l20 = getLuma(c20);
  float l01 = getLuma(c01), l11 = getLuma(c11), l21 = getLuma(c21);
  float l02 = getLuma(c02), l12 = getLuma(c12), l22 = getLuma(c22);

  // Sobel 2D
  float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
  float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
  float edgeStrength = clamp(length(vec2(gx, gy)) * uEdgeSharpness, 0.0, 1.0);

  // Interpolación bilineal estándar
  vec3 top = mix(c10, c20, f.x);
  vec3 mid = mix(c11, c21, f.x);
  vec3 bot = mix(c12, c22, f.x);
  vec3 bilinear = mix(mix(c11, c21, f.x), mix(c12, c22, f.x), f.y);

  // Reconstrucción adaptativa de bordes
  vec3 edgeDir = vec3(0.0);
  if (abs(gx) > abs(gy)) {
    edgeDir = mix(c11, c21, f.x);
  } else {
    edgeDir = mix(c11, c12, f.y);
  }

  vec3 result = mix(bilinear, edgeDir, edgeStrength * 0.6);
  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
`;

export default AIUpscaler;
