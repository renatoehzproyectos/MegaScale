/**
 * Profiler
 * Low-overhead FPS / frame-time monitor.
 * Uses a circular buffer (no Array.shift allocations) and incremental
 * running stats to keep MegaScale itself out of the hot path.
 */

export class Profiler {
  constructor({ historySize = 120 } = {}) {
    this.historySize = Math.max(16, historySize | 0);
    this.frameTimes = new Float64Array(this.historySize);
    this._write = 0;
    this._count = 0;
    this.lastTimestamp = null;
    this.frameCount = 0;
    this._running = false;

    // Incremental stats
    this._sum = 0;
    this._sumSq = 0;
  }

  start() {
    this._running = true;
    this.lastTimestamp = null;
  }

  stop() {
    this._running = false;
  }

  /**
   * Must be called once per frame (ideally from rAF).
   * @param {number} timestamp - DOMHighResTimeStamp
   */
  tick(timestamp) {
    if (!this._running) return null;

    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      return null;
    }

    const delta = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.frameCount++;

    // Circular overwrite: subtract old sample if buffer full
    if (this._count === this.historySize) {
      const old = this.frameTimes[this._write];
      this._sum -= old;
      this._sumSq -= old * old;
    } else {
      this._count++;
    }

    this.frameTimes[this._write] = delta;
    this._write = (this._write + 1) % this.historySize;
    this._sum += delta;
    this._sumSq += delta * delta;

    return this.getStats();
  }

  getStats() {
    if (this._count === 0) {
      return { fps: 0, frameTime: 0, variance: 0, samples: 0, onePercentLow: 0 };
    }

    const n = this._count;
    const avgFrameTime = this._sum / n;
    const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    const variance = Math.max(0, this._sumSq / n - avgFrameTime * avgFrameTime);

    return {
      fps: Number(fps.toFixed(2)),
      frameTime: Number(avgFrameTime.toFixed(3)),
      variance: Number(variance.toFixed(3)),
      samples: n,
      onePercentLow: Number(this._onePercentLow().toFixed(2)),
    };
  }

  /**
   * Approximate 1% low FPS from the worst ~1% of frame times in the window.
   * Avoids full sort every frame: only samples a small tail.
   */
  _onePercentLow() {
    if (this._count < 10) return 0;
    const n = this._count;
    const tail = Math.max(1, Math.floor(n * 0.01));
    // Collect current buffer contents into a small temp for partial select
    const vals = new Float64Array(n);
    let idx = 0;
    const start = this._count === this.historySize ? this._write : 0;
    for (let i = 0; i < n; i++) {
      vals[i] = this.frameTimes[(start + i) % this.historySize];
    }
    // Partial selection: find the `tail` largest frame times (worst)
    // Simple insertion for tiny tail size
    const worst = new Float64Array(tail);
    for (let i = 0; i < tail; i++) worst[i] = 0;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (v > worst[tail - 1]) {
        worst[tail - 1] = v;
        // bubble down
        for (let j = tail - 1; j > 0 && worst[j] > worst[j - 1]; j--) {
          const t = worst[j];
          worst[j] = worst[j - 1];
          worst[j - 1] = t;
        }
      }
    }
    let sumWorst = 0;
    for (let i = 0; i < tail; i++) sumWorst += worst[i];
    const avgWorst = sumWorst / tail;
    return avgWorst > 0 ? 1000 / avgWorst : 0;
  }

  /**
   * Returns 'up' | 'down' | 'stable' by comparing first and second half
   * of the history (frame-time trend).
   */
  getTrend() {
    if (this._count < 10) return 'stable';

    const n = this._count;
    const mid = Math.floor(n / 2);
    const start = this._count === this.historySize ? this._write : 0;

    let sum1 = 0;
    let sum2 = 0;
    for (let i = 0; i < mid; i++) {
      sum1 += this.frameTimes[(start + i) % this.historySize];
    }
    for (let i = mid; i < n; i++) {
      sum2 += this.frameTimes[(start + i) % this.historySize];
    }
    const avg1 = sum1 / mid;
    const avg2 = sum2 / (n - mid);
    const diff = avg2 - avg1;

    const threshold = 0.5; // ms
    if (diff > threshold) return 'down';
    if (diff < -threshold) return 'up';
    return 'stable';
  }

  getRecentFrameTimes() {
    const n = this._count;
    const out = new Array(n);
    const start = this._count === this.historySize ? this._write : 0;
    for (let i = 0; i < n; i++) {
      out[i] = this.frameTimes[(start + i) % this.historySize];
    }
    return out;
  }
}

export default Profiler;
