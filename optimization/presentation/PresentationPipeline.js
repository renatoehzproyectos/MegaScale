/**
 * PresentationPipeline (Sección 22 del plan maestro)
 * Encadena los pasos de post-proceso (EASU -> RCAS -> AA) sobre el frame ya
 * renderizado por el juego, midiendo el coste en ms de cada etapa contra un
 * budget total (16.67ms para 60 FPS). Si el pipeline completo se pasa del
 * budget, reporta qué etapa recortar (regla de coste neto, Sección 23).
 */

import { WebGLBackend } from '../../backends/webgl/WebGLBackend.js';
import { EASU_FRAGMENT_SHADER } from '../../upscaling/easu/EASU.js';
import { RCAS_FRAGMENT_SHADER, computeAdaptiveSharpness } from '../../upscaling/rcas/RCAS.js';
import { FXAA_FRAGMENT_SHADER } from '../../upscaling/fxaa/FXAA.js';
import { SMAA_LITE_FRAGMENT_SHADER } from '../../upscaling/smaa/SMAA.js';

const AA_SHADERS = {
  off: null,
  fxaa: FXAA_FRAGMENT_SHADER,
  smaa: SMAA_LITE_FRAGMENT_SHADER,
};

export class PresentationPipeline {
  constructor({ gl, outputWidth, outputHeight, targetFrameMs = 16.67 }) {
    this.gl = gl;
    this.backend = new WebGLBackend(gl);
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    this.targetFrameMs = targetFrameMs;

    this.easuRT = null;
    this.rcasRT = null;

    this.stageCosts = { easu: 0, rcas: 0, aa: 0, other: 0 };
    this._ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null;

    this._ensureRenderTargets();
  }

  _ensureRenderTargets() {
    if (this.easuRT) this.backend.destroyRenderTarget(this.easuRT);
    if (this.rcasRT) this.backend.destroyRenderTarget(this.rcasRT);
    this.easuRT = this.backend.createRenderTarget(this.outputWidth, this.outputHeight);
    this.rcasRT = this.backend.createRenderTarget(this.outputWidth, this.outputHeight);
  }

  resize(outputWidth, outputHeight) {
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    this._ensureRenderTargets();
  }

  /**
   * Ejecuta EASU (upscale) + RCAS (sharpen) + AA opcional sobre la textura
   * de origen (render interno del juego a baja resolución) y presenta el
   * resultado en el framebuffer por defecto (pantalla).
   *
   * @param {WebGLTexture} sourceTexture - textura con el render del juego
   * @param {number} renderScale - escala actual (para el sharpening adaptativo)
   * @param {'off'|'fxaa'|'smaa'} aaMode
   */
  present(sourceTexture, renderScale, aaMode = 'off') {
    const gl = this.gl;
    const t0 = performance.now();

    // --- EASU: upscale a resolución de salida ---
    this._runPass({
      target: this.easuRT,
      fragmentSrc: EASU_FRAGMENT_SHADER,
      inputTexture: sourceTexture,
      uniforms: (program) => {
        gl.uniform2f(gl.getUniformLocation(program, 'uSourceSize'),
          sourceTexture.width || this.outputWidth, sourceTexture.height || this.outputHeight);
        gl.uniform2f(gl.getUniformLocation(program, 'uOutputSize'), this.outputWidth, this.outputHeight);
      },
    });
    const t1 = performance.now();

    // --- RCAS: sharpening adaptativo ---
    const sharpness = computeAdaptiveSharpness(renderScale);
    this._runPass({
      target: this.rcasRT,
      fragmentSrc: RCAS_FRAGMENT_SHADER,
      inputTexture: this.easuRT.texture,
      uniforms: (program) => {
        gl.uniform2f(gl.getUniformLocation(program, 'uOutputSize'), this.outputWidth, this.outputHeight);
        gl.uniform1f(gl.getUniformLocation(program, 'uSharpness'), sharpness);
      },
    });
    const t2 = performance.now();

    // --- AA opcional (a pantalla) ---
    const aaShader = AA_SHADERS[aaMode];
    if (aaShader) {
      this._runPass({
        target: null, // pantalla
        fragmentSrc: aaShader,
        inputTexture: this.rcasRT.texture,
        uniforms: (program) => {
          gl.uniform2f(gl.getUniformLocation(program, 'uOutputSize'), this.outputWidth, this.outputHeight);
        },
      });
    } else {
      this._blitToScreen(this.rcasRT.texture);
    }
    const t3 = performance.now();

    this.stageCosts = {
      easu: Number((t1 - t0).toFixed(3)),
      rcas: Number((t2 - t1).toFixed(3)),
      aa: Number((t3 - t2).toFixed(3)),
      total: Number((t3 - t0).toFixed(3)),
    };

    return this.stageCosts;
  }

  /**
   * Compara el coste total contra el budget y sugiere qué recortar primero
   * si nos pasamos (regla de coste neto, Sección 22/23).
   */
  evaluateBudget() {
    const over = this.stageCosts.total - this.targetFrameMs;
    if (over <= 0) return { withinBudget: true, overMs: 0, suggestion: null };

    // Prioridad de recorte: primero AA (menor impacto perceptual relativo
    // en perfiles agresivos), luego RCAS, EASU se mantiene el máximo posible
    // porque sin él se pierde la reconstrucción de nitidez del upscale.
    const ranked = ['aa', 'rcas', 'easu'];
    const worstFirst = ranked.sort((a, b) => this.stageCosts[b] - this.stageCosts[a]);

    return {
      withinBudget: false,
      overMs: Number(over.toFixed(3)),
      suggestion: `reducir o desactivar: ${worstFirst[0]}`,
    };
  }

  _runPass({ target, fragmentSrc, inputTexture, uniforms }) {
    const gl = this.gl;
    const program = this.backend.createProgram(fragmentSrc);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, this.outputWidth, this.outputHeight);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(gl.getUniformLocation(program, 'uSource'), 0);

    if (uniforms) uniforms(program);

    this.backend.drawQuad();
  }

  _blitToScreen(texture) {
    const gl = this.gl;
    const program = this.backend.createProgram(PASSTHROUGH_SHADER, undefined, 'passthrough');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outputWidth, this.outputHeight);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'uSource'), 0);
    this.backend.drawQuad();
  }

  destroy() {
    this.backend.destroyRenderTarget(this.easuRT);
    this.backend.destroyRenderTarget(this.rcasRT);
    this.backend.destroy();
  }
}

const PASSTHROUGH_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform sampler2D uSource;
void main() { fragColor = texture(uSource, vUV); }
`;

export default PresentationPipeline;
