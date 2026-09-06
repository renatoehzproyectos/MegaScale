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
 *
 * Cuando detecta Three.js intenta localizar la instancia real del
 * WebGLRenderer (no solo el global THREE) para que ThreeWebGLAdapter
 * pueda conducir la resolución a través de setPixelRatio/setSize.
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
   * Try hard to find a live Three.js WebGLRenderer / WebGPURenderer
   * associated with this canvas. Non-invasive: never creates contexts.
   */
  _findThreeRenderer() {
    if (typeof window === 'undefined') return null;

    // 1. Explicit engine already passed
    if (this.customEngine && (this.customEngine.isWebGLRenderer || this.customEngine.isWebGPURenderer)) {
      return this.customEngine;
    }

    // 2. Common attachment points games use
    const candidates = [];
    if (this.canvas) {
      if (this.canvas.__threeRenderer) candidates.push(this.canvas.__threeRenderer);
      if (this.canvas.__renderer) candidates.push(this.canvas.__renderer);
      if (this.canvas.renderer) candidates.push(this.canvas.renderer);
    }
    if (window.__THREE_RENDERER) candidates.push(window.__THREE_RENDERER);
    if (window.__threeRenderer) candidates.push(window.__threeRenderer);
    if (window.renderer && (window.renderer.isWebGLRenderer || window.renderer.isWebGPURenderer)) {
      candidates.push(window.renderer);
    }
    // Stress-test / demo convention used by the Heavy Test page
    if (window.__gameCanvas && window.__gameCanvas === this.canvas) {
      // Look for a renderer whose domElement is this canvas
      // (scanned below)
    }

    // 3. Scan a few well-known globals without walking the whole heap
    const globalsToCheck = [
      window.game,
      window.app,
      window.App,
      window.engine,
      window.Engine,
      window.main,
      window.Main,
      window.scene,
    ];
    for (const g of globalsToCheck) {
      if (!g || typeof g !== 'object') continue;
      if (g.renderer && (g.renderer.isWebGLRenderer || g.renderer.isWebGPURenderer)) {
        candidates.push(g.renderer);
      }
      if (g.isWebGLRenderer || g.isWebGPURenderer) candidates.push(g);
    }

    // Prefer the one whose domElement matches our canvas
    for (const r of candidates) {
      if (r && r.domElement === this.canvas) return r;
    }
    // Otherwise first plausible one
    for (const r of candidates) {
      if (r && (r.isWebGLRenderer || r.isWebGPURenderer)) return r;
    }

    // 4. Last resort: if THREE is present and the canvas already has a
    // WebGL context, we still fall back to WebGLAdapter (safe). Returning
    // null here means "couldn't get the renderer instance".
    return null;
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

    // 2. Auto-detect Three.js and try to bind the real renderer
    const isThree =
      (environment && environment.engine === 'threejs') ||
      (typeof window !== 'undefined' && window.THREE);

    if (isThree) {
      const threeRenderer = this._findThreeRenderer();
      if (threeRenderer) {
        if (threeRenderer.isWebGPURenderer) {
          this.adapterType = 'threejs-webgpu';
          this.adapter = new ThreeWebGPUAdapter(threeRenderer, this.canvas);
        } else {
          this.adapterType = 'threejs-webgl';
          this.adapter = new ThreeWebGLAdapter(threeRenderer, this.canvas);
        }
        return this.adapter;
      }
      // THREE present but no renderer instance found → safe raw WebGL path
      this.adapterType = 'threejs-webgl-fallback';
      this.adapter = new WebGLAdapter(this.canvas);
      return this.adapter;
    }

    if (typeof window !== 'undefined') {
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
    if (
      environment.webgl2 ||
      environment.webgl1 ||
      (this.canvas && (this.canvas.getContext('webgl2') || this.canvas.getContext('webgl')))
    ) {
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

  /** True when the active adapter fully owns canvas buffer resizing. */
  adapterOwnsResize() {
    return !!(
      this.adapter &&
      typeof this.adapter.ownsCanvasResize === 'function' &&
      this.adapter.ownsCanvasResize()
    );
  }

  restore() {
    if (this.adapter && typeof this.adapter.destroy === 'function') {
      this.adapter.destroy();
    }
  }
}

export default CompatibilityManager;
