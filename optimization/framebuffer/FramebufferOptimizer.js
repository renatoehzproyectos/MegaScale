/**
 * FramebufferOptimizer
 * Optimización de framebuffers y render targets para WebGL2 y WebGPU.
 *
 * Plan Maestro (Sección 17):
 * "En WebGL2 pueden existir oportunidades para descartar datos que ya no son
 * necesarios después de determinadas operaciones (gl.invalidateFramebuffer),
 * reduciendo el ancho de banda de memoria en arquitecturas tile-based."
 */

export class FramebufferOptimizer {
  constructor(gl = null) {
    this.gl = gl;
    this.isWebGL2 = !!(gl && typeof gl.invalidateFramebuffer === 'function');
  }

  /**
   * Invalida attachments de profundidad/stencil o color temporal que ya no se
   * necesitarán, ahorrando escritura a RAM en GPUs móviles (TBR/TBDR).
   */
  discardTransientAttachments(target = 0x8D40 /* gl.FRAMEBUFFER */, attachments = ['depth', 'stencil']) {
    if (!this.isWebGL2 || !this.gl) return;

    const gl = this.gl;
    const glAttachments = [];

    for (const att of attachments) {
      if (att === 'depth') glAttachments.push(gl.DEPTH_ATTACHMENT);
      else if (att === 'stencil') glAttachments.push(gl.STENCIL_ATTACHMENT);
      else if (att === 'depth_stencil') glAttachments.push(gl.DEPTH_STENCIL_ATTACHMENT);
      else if (att === 'color0') glAttachments.push(gl.COLOR_ATTACHMENT0);
    }

    if (glAttachments.length > 0) {
      try {
        gl.invalidateFramebuffer(target, glAttachments);
      } catch {
        // Fallback silencioso si el driver no lo permite
      }
    }
  }

  /**
   * Recomienda configuración de render targets óptimos según capacidades detectadas.
   */
  getRecommendedFBOConfig(capabilities = {}) {
    return {
      useHalfFloat: !!(capabilities.extensions && capabilities.extensions.includes('EXT_color_buffer_float')),
      useDepth24Stencil8: true,
      useTransientDiscard: this.isWebGL2,
    };
  }
}

export default FramebufferOptimizer;
