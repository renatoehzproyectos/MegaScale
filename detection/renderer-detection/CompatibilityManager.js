/**
 * CompatibilityManager
 * Capa de compatibilidad universal de MegaScale (Plan Maestro Sección 25).
 * Detecta y enlaza el adaptador adecuado:
 * - Raw WebGL (1 / 2)
 * - Three.js (WebGL / WebGPU)
 * - Babylon.js
 * - PixiJS
 * - Canvas 2D
 * - Motores desconocidos
 */

import { WebGLAdapter } from '../../backends/adapters/WebGLAdapter.js';
import { ThreeWebGLAdapter } from '../../backends/adapters/ThreeWebGLAdapter.js';
import { ThreeWebGPUAdapter } from '../../backends/adapters/ThreeWebGPUAdapter.js';
import { BabylonAdapter } from '../../backends/adapters/BabylonAdapter.js';
import { PixiAdapter } from '../../backends/adapters/PixiAdapter.js';
import { CanvasAdapter } from '../../backends/adapters/CanvasAdapter.js';

export class CompatibilityManager {
  constructor(canvas, customEngine = null) {
    this.canvas = canvas;
    this.customEngine = customEngine;
    this.adapter = null;
    this.adapterType = 'unknown';
  }

  /**
   * Resuelve y crea el adaptador adecuado según el entorno detectado.
   */
  resolveAdapter(environment = {}) {
    // 1. Motor explícito pasado por el usuario
    if (this.customEngine) {
      if (this.customEngine.isWebGLRenderer) {
        this.adapterType = 'threejs-webgl';
        this.adapter = new ThreeWebGLAdapter(this.customEngine, this.canvas);
        return this.adapter;
      }
      if (this.customEngine.isWebGPURenderer) {
        this.adapterType = 'threejs-webgpu';
        this.adapter = new ThreeWebGPUAdapter(this.customEngine, this.canvas);
        return this.adapter;
      }
      if (typeof this.customEngine.setHardwareScalingLevel === 'function') {
        this.adapterType = 'babylon';
        this.adapter = new BabylonAdapter(this.customEngine, this.canvas);
        return this.adapter;
      }
      if (this.customEngine.stage || this.customEngine.renderer) {
        this.adapterType = 'pixijs';
        this.adapter = new PixiAdapter(this.customEngine, this.canvas);
        return this.adapter;
      }
    }

    // 2. Detección global de motores
    if (typeof window !== 'undefined') {
      if (environment.engine === 'threejs' || window.THREE) {
        // Si hay una instancia de renderer en canvas o window
        this.adapterType = 'threejs-webgl';
        this.adapter = new WebGLAdapter(this.canvas);
        return this.adapter;
      }
      if (environment.engine === 'babylon' || window.BABYLON) {
        this.adapterType = 'babylon';
        this.adapter = new WebGLAdapter(this.canvas);
        return this.adapter;
      }
      if (environment.engine === 'pixijs' || window.PIXI) {
        this.adapterType = 'pixijs';
        this.adapter = new WebGLAdapter(this.canvas);
        return this.adapter;
      }
    }

    // 3. WebGL nativo
    if (environment.webgl2 || environment.webgl1 || (this.canvas && (this.canvas.getContext('webgl2') || this.canvas.getContext('webgl')))) {
      this.adapterType = environment.webgl2 ? 'webgl2' : 'webgl1';
      this.adapter = new WebGLAdapter(this.canvas);
      return this.adapter;
    }

    // 4. Canvas 2D
    if (environment.canvas2d || (this.canvas && this.canvas.getContext('2d'))) {
      this.adapterType = 'canvas2d';
      this.adapter = new CanvasAdapter(this.canvas);
      return this.adapter;
    }

    // 5. Fallback por defecto
    this.adapterType = 'generic';
    this.adapter = new WebGLAdapter(this.canvas);
    return this.adapter;
  }

  applyScale(scale) {
    if (this.adapter && typeof this.adapter.applyScale === 'function') {
      this.adapter.applyScale(scale);
    }
  }

  restore() {
    if (this.adapter && typeof this.adapter.destroy === 'function') {
      this.adapter.destroy();
    }
  }
}

export default CompatibilityManager;
