/**
 * Overlay de desarrollo (Sección 31 del plan maestro).
 * En producción debe estar OFF; se activa pasando `overlay: true`.
 */

export class Overlay {
  constructor({ parent = typeof document !== 'undefined' ? document.body : null } = {}) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed', 'top:8px', 'left:8px', 'z-index:999999',
      'background:rgba(0,0,0,0.75)', 'color:#0f0', 'font:12px monospace',
      'padding:8px 10px', 'border-radius:4px', 'white-space:pre',
      'pointer-events:none',
    ].join(';');
    this.el.textContent = 'MEGASCALE\n(esperando datos...)';
    if (parent) parent.appendChild(this.el);
  }

  mount() {
    // already mounted in constructor
  }

  unmount() {
    this.destroy();
  }

  update({
    fps,
    frameTime,
    onePercentLow,
    renderer,
    scale,
    aaMode,
    dpr,
    paused,
    adapter,
    bottleneck,
  }) {
    this.el.textContent =
      `MEGASCALE\n\n` +
      `FPS: ${fps != null ? fps : '—'}\n` +
      `1% Low: ${onePercentLow != null ? onePercentLow : '—'}\n` +
      `Frame: ${frameTime != null ? frameTime : '—'} ms\n\n` +
      `Renderer: ${renderer || '—'}\n` +
      (adapter ? `Adapter: ${adapter}\n` : '') +
      `Scale: ${scale != null ? scale : '—'}\n` +
      (bottleneck ? `Bottleneck: ${bottleneck}\n` : '') +
      (aaMode !== undefined ? `AA: ${aaMode}\n` : '') +
      (dpr !== undefined ? `DPR eff.: ${dpr}\n` : '') +
      (paused ? `\n*** ${paused} ***` : '');
    this.el.style.color = paused ? '#f80' : '#0f0';
  }

  destroy() {
    if (this.el && this.el.parentNode) this.el.remove();
  }
}

export default Overlay;
