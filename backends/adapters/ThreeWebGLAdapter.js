/**
 * ThreeWebGLAdapter
 * Adaptador específico para Three.js WebGLRenderer.
 *
 * Ownership model:
 * - This adapter OWNS the drawing-buffer size.
 * - It drives resolution exclusively through Three's own APIs
 *   (setPixelRatio + setSize(..., false)) so camera matrices, viewport
 *   and internal state stay consistent. DynamicResolution must NOT also
 *   poke canvas.width/height when this adapter is active.
 * - CSS display size is left alone (updateStyle = false).
 */
export class ThreeWebGLAdapter {
  constructor(renderer, canvas = null) {
    this.renderer = renderer;
    this.canvas = canvas || (renderer ? renderer.domElement : null);
    this.originalPixelRatio = 1;
    this.displaySize = { width: 0, height: 0 }; // CSS / logical size Three was using
    this.currentScale = 1.0;
    this._ownsResize = true; // signal to DynamicResolution / Controller

    if (this.renderer) {
      if (typeof this.renderer.getPixelRatio === 'function') {
        this.originalPixelRatio = this.renderer.getPixelRatio() || 1;
      }
      this._captureDisplaySize();
    }

    // Keep display size in sync if the page resizes while MegaScale runs.
    this._onResize = () => {
      this._captureDisplaySize();
      // Re-apply current scale against the new display size.
      if (this.currentScale !== 1 || this.displaySize.width > 0) {
        this.applyScale(this.currentScale);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize, { passive: true });
      window.addEventListener('orientationchange', this._onResize, { passive: true });
    }
  }

  _captureDisplaySize() {
    if (!this.renderer) return;

    // Prefer clientWidth/clientHeight (CSS pixels) so we don't bake a
    // previous scaled buffer size into the "display" baseline.
    const el = this.canvas || this.renderer.domElement;
    let cssW = 0;
    let cssH = 0;
    if (el) {
      cssW = el.clientWidth || 0;
      cssH = el.clientHeight || 0;
    }

    if ((!cssW || !cssH) && typeof this.renderer.getSize === 'function') {
      const target = { width: 0, height: 0 };
      this.renderer.getSize(target);
      // getSize returns drawing-buffer size / pixelRatio → roughly CSS size
      const pr = (typeof this.renderer.getPixelRatio === 'function' && this.renderer.getPixelRatio()) || 1;
      cssW = cssW || Math.round(target.width / pr) || 800;
      cssH = cssH || Math.round(target.height / pr) || 600;
    }

    if (!cssW) cssW = (typeof window !== 'undefined' ? window.innerWidth : 800);
    if (!cssH) cssH = (typeof window !== 'undefined' ? window.innerHeight : 600);

    this.displaySize.width = cssW;
    this.displaySize.height = cssH;
  }

  /**
   * Apply a render scale in [0..1+].
   * scale=1 → native (originalPixelRatio, full display size)
   * scale=0.5 → half linear resolution via reduced pixel ratio / buffer.
   */
  applyScale(scale) {
    if (!this.renderer) return;
    this.currentScale = scale;

    // Ensure we have a fresh display baseline (handles late layout).
    if (!this.displaySize.width || !this.displaySize.height) {
      this._captureDisplaySize();
    }

    const pr = Math.max(0.25, this.originalPixelRatio * scale);

    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(pr);
    }

    if (typeof this.renderer.setSize === 'function') {
      // false = do not touch canvas.style.width/height (CSS stays 100%)
      this.renderer.setSize(this.displaySize.width, this.displaySize.height, false);
    }

    // Cheap perceptual sharpen when downscaled (same idea as OpenScale /
    // DynamicResolution CSS path). Zero GPU cost — compositor filter.
    if (this.canvas) {
      if (scale < 0.98) {
        this.canvas.style.filter = 'contrast(1.06) saturate(1.1)';
      } else {
        this.canvas.style.filter = '';
      }
    }
  }

  /** Tell DynamicResolution this adapter already resized the buffer. */
  ownsCanvasResize() {
    return true;
  }

  restore() {
    if (!this.renderer) return;
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(this.originalPixelRatio);
    }
    if (typeof this.renderer.setSize === 'function' && this.displaySize.width > 0) {
      this.renderer.setSize(this.displaySize.width, this.displaySize.height, false);
    }
    if (this.canvas) {
      this.canvas.style.filter = '';
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
    }
    this.restore();
  }
}

export default ThreeWebGLAdapter;
