/**
 * GPUTiering (Sección 4 del plan maestro)
 *
 * Clasifica la GPU en TIER 0-5 combinando:
 *   1. Capacidades detectadas (maxTextureSize, extensiones, WebGPU/WebGL2/1)
 *   2. Micro-benchmarks reales (fill-rate y coste de shader), NO solo el
 *      nombre de la GPU (que puede venir bloqueado o ser engañoso).
 *
 * Los micro-benchmarks son deliberadamente cortos (una fracción de segundo)
 * para no afectar la experiencia del usuario durante el arranque.
 */

const TIERS = ['Very Weak', 'Weak', 'Low-Mid', 'Mid', 'High', 'Extreme'];

export class GPUTiering {
  constructor(gl) {
    this.gl = gl;
  }

  /**
   * Ejecuta un micro-benchmark de fill-rate: dibuja muchos quads
   * superpuestos con un shader simple y mide cuántos puede procesar en un
   * tiempo fijo. Aproxima el throughput de píxeles de la GPU.
   */
  async _benchmarkFillRate({ durationMs = 150, quadCount = 400 } = {}) {
    const gl = this.gl;
    if (!gl) return { score: 0, error: 'no_gl_context' };

    const vs = `#version 300 es
      in vec2 aPos;
      void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
    `;
    const fs = `#version 300 es
      precision highp float;
      out vec4 fragColor;
      uniform float uSeed;
      void main() {
        // Un poco de trabajo aritmético para no ser trivialmente optimizado.
        float v = sin(gl_FragCoord.x * 0.01 + uSeed) * cos(gl_FragCoord.y * 0.01 + uSeed);
        fragColor = vec4(v, v, v, 0.02);
      }
    `;

    try {
      const program = this._compileProgram(vs, fs);
      const vao = this._quadVAO();

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const seedLoc = gl.getUniformLocation(program, 'uSeed');

      const start = performance.now();
      let draws = 0;
      while (performance.now() - start < durationMs) {
        for (let i = 0; i < quadCount; i++) {
          gl.uniform1f(seedLoc, i * 0.001);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.finish();
        draws += quadCount;
      }
      const elapsed = performance.now() - start;

      gl.disable(gl.BLEND);
      gl.deleteProgram(program);

      const drawsPerMs = draws / elapsed;
      return { score: drawsPerMs, error: null };
    } catch (e) {
      return { score: 0, error: String(e) };
    }
  }

  _compileProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  _quadVAO() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  /**
   * Combina capacidades + micro-benchmark en un tier 0-5.
   * @param {Object} environment - reporte de RendererDetector
   */
  async classify(environment) {
    const fillRate = await this._benchmarkFillRate();

    let capabilityScore = 0;
    if (environment.webgpu) capabilityScore += 3;
    else if (environment.webgl2) capabilityScore += 2;
    else if (environment.webgl1) capabilityScore += 1;

    const maxTex = environment.capabilities?.maxTextureSize || 0;
    if (maxTex >= 16384) capabilityScore += 2;
    else if (maxTex >= 8192) capabilityScore += 1;

    // Normalizar el score de fill-rate (drawsPerMs) a una banda 0-3.
    // Estos umbrales son heurísticos, calibrados de forma conservadora;
    // se recomienda re-calibrar con datos reales de producción con el
    // tiempo (ver benchmark/regression).
    let fillRateScore = 0;
    if (fillRate.score > 40) fillRateScore = 3;
    else if (fillRate.score > 20) fillRateScore = 2;
    else if (fillRate.score > 8) fillRateScore = 1;

    const totalScore = capabilityScore + fillRateScore; // rango aprox 0-8
    const tierIndex = Math.min(5, Math.round((totalScore / 8) * 5));

    return {
      tier: tierIndex,
      tierName: TIERS[tierIndex],
      capabilityScore,
      fillRateScore,
      fillRateRaw: fillRate.score,
      benchmarkError: fillRate.error,
    };
  }
}

export const TIER_NAMES = TIERS;
export default GPUTiering;
