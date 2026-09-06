/**
 * Overlay de desarrollo (Sección 31 del plan maestro).
 * En producción debe estar OFF; se activa pasando `overlay: true` al Engine.
 */

export class Overlay {
  constructor({ parent = document.body } = {}) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed', 'top:8px', 'left:8px', 'z-index:999999',
      'background:rgba(0,0,0,0.75)', 'color:#0f0', 'font:12px monospace',
      'padding:8px 10px', 'border-radius:4px', 'white-space:pre',
      'pointer-events:none',
    ].join(';');
    this.el.textContent = 'MEGASCALE\n(esperando datos...)';
    parent.appendChild(this.el);
  }

  update({ fps, frameTime, renderer, scale, aaMode, dpr, paused }) {
    this.el.textContent =
      `MEGASCALE\n\n` +
      `FPS: ${fps}\n` +
      `Frame: ${frameTime} ms\n\n` +
      `Renderer: ${renderer}\n` +
      `Scale: ${scale}\n` +
      (aaMode !== undefined ? `AA: ${aaMode}\n` : '') +
      (dpr !== undefined ? `DPR eff.: ${dpr}\n` : '') +
      (paused ? `\n*** ${paused} ***` : '');
    this.el.style.color = paused ? '#f80' : '#0f0';
  }

  destroy() {
    this.el.remove();
  }
}

export default Overlay;
