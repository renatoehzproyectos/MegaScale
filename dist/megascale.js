/**
 * MegaScale — entry point (FASE 1)
 *
 * Uso mínimo (modo "pastilla"):
 *
 *   <script type="module">
 *     import MegaScale from './megascale.js';
 *     MegaScale.start({ canvas: document.querySelector('canvas') });
 *   </script>
 *
 * En FASE 1 solo se activa: detección de renderer, monitor de FPS/frame time,
 * dynamic resolution básica (no predictiva), watchdog y rollback.
 * Las fases siguientes (upscaling, WebGPU, IA, etc.) se irán habilitando
 * automáticamente cuando estén listas, sin cambiar esta API pública.
 */

import { Controller } from '../core/controller/Controller.js';
import { Overlay } from '../ui/overlay/Overlay.js';

const MegaScale = {
  _controller: null,

  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {number} [opts.targetFps=60]
   * @param {boolean} [opts.overlay=false] - overlay de desarrollo (Sección 31)
   * @param {'off'|'fxaa'|'smaa'} [opts.aaMode='fxaa'] - antialiasing (Sección 13)
   */
  async start(opts = {}) {
    if (!opts.canvas) {
      throw new Error('MegaScale.start requiere { canvas }.');
    }

    const overlay = opts.overlay ? new Overlay() : null;

    this._controller = new Controller({
      canvas: opts.canvas,
      targetFps: opts.targetFps || 60,
      overlay,
      aaMode: opts.aaMode || 'fxaa',
    });

    const environment = await this._controller.init();

    // eslint-disable-next-line no-console
    console.info('[MegaScale] Iniciado. Entorno detectado:', environment);
    return environment;
  },

  stop() {
    if (this._controller) {
      this._controller.stop();
      this._controller = null;
    }
  },

  getStats() {
    if (!this._controller) return null;
    return this._controller.profiler.getStats();
  },

  /**
   * Reporte de "inteligencia" (Fase 3): GPU tier, config activa, bottleneck
   * detectado, si el performance predictor ya tiene modelo, etc.
   */
  getIntelligenceReport() {
    if (!this._controller) return null;
    return this._controller.getIntelligenceReport();
  },
};

if (typeof window !== 'undefined') {
  window.MegaScale = MegaScale;
}

export default MegaScale;
