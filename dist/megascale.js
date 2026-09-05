/**
 * MegaScale — Plataforma universal de optimización en tiempo real para juegos web.
 * Entry point público ("modo pastilla").
 *
 * Uso estándar:
 * ```html
 * <script type="module" src="dist/megascale.js"></script>
 * <script type="module">
 *   import MegaScale from './dist/megascale.js';
 *   MegaScale.start({ targetFps: 60, overlay: true });
 * </script>
 * ```
 */

import { Controller } from '../core/controller/Controller.js';
import { Overlay } from '../ui/overlay/Overlay.js';
import { RendererDetector } from '../detection/renderer-detection/RendererDetector.js';
import { BenchmarkSuite } from '../benchmark/regression/BenchmarkSuite.js';
import { ProfileManager, PROFILES } from '../profiles/ProfileManager.js';
import { WebGPUBackend } from '../backends/webgpu/WebGPUBackend.js';
import { TemporalUpscaler } from '../upscaling/temporal/TemporalUpscaler.js';
import { AIUpscaler } from '../upscaling/ai/AIUpscaler.js';
import { MemoryManager } from '../optimization/memory/MemoryManager.js';

let _activeController = null;
let _activeOverlay = null;

export const MegaScale = {
  version: '1.0.0',

  /**
   * Arranca la optimización inteligente en el canvas especificado o detectado.
   */
  async start(options = {}) {
    if (_activeController) {
      // eslint-disable-next-line no-console
      console.warn('[MegaScale] Ya existe una instancia activa.');
      return _activeController;
    }

    let canvas = options.canvas;
    if (!canvas && typeof document !== 'undefined') {
      canvas = document.querySelector('canvas');
    }

    if (!canvas) {
      throw new Error('[MegaScale] No se encontró ningún elemento <canvas>. Pásalo explícitamente en { canvas }.');
    }

    if (options.overlay) {
      _activeOverlay = new Overlay();
      _activeOverlay.mount();
    }

    _activeController = new Controller({
      canvas,
      targetFps: options.targetFps || 60,
      profile: options.profile || 'auto',
      engine: options.engine || null,
      overlay: _activeOverlay,
      aaMode: options.aaMode || 'fxaa',
      enableUpscaling: options.enableUpscaling !== false,
    });

    await _activeController.init();
    return _activeController;
  },

  /**
   * Detiene MegaScale y restaura la configuración previa.
   */
  stop() {
    if (_activeController) {
      _activeController.stop();
      _activeController = null;
    }
    if (_activeOverlay) {
      _activeOverlay.unmount();
      _activeOverlay = null;
    }
  },

  /**
   * Cambia el perfil activo ('ultra-performance' | 'performance' | 'balanced' | 'quality' | 'auto').
   */
  setProfile(profileName) {
    if (_activeController) {
      _activeController.setProfile(profileName);
    }
  },

  /**
   * Obtiene reporte de diagnóstico e inteligencia acumulada.
   */
  getIntelligenceReport() {
    return _activeController ? _activeController.getIntelligenceReport() : null;
  },

  /**
   * Ejecuta la suite de benchmark científico comparando Original vs OpenScale vs MegaScale.
   */
  runScientificBenchmarkSuite() {
    const suite = new BenchmarkSuite();
    return suite.runAll();
  },

  // Exportaciones de subsistemas para integraciones avanzadas
  Controller,
  Overlay,
  RendererDetector,
  BenchmarkSuite,
  ProfileManager,
  PROFILES,
  WebGPUBackend,
  TemporalUpscaler,
  AIUpscaler,
  MemoryManager,
};

// Auto-export global en entorno browser
if (typeof window !== 'undefined') {
  window.MegaScale = MegaScale;
}

export default MegaScale;
