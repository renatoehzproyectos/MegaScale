/**
 * MemoryProfiler
 * Supervises JS heap and estimated VRAM allocated by MegaScale.
 */

export class MemoryProfiler {
  constructor({ sampleWindow = 30 } = {}) {
    this.sampleWindow = sampleWindow;
    this.heapSamples = [];
    this.vramBytes = 0;
  }

  setAllocatedVram(bytes) {
    this.vramBytes = bytes || 0;
  }

  sample() {
    let heapUsedMB = 0;
    let heapTotalMB = 0;

    if (typeof performance !== 'undefined' && performance.memory) {
      heapUsedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
      heapTotalMB = performance.memory.totalJSHeapSize / (1024 * 1024);
    }

    const entry = {
      timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      heapUsedMB: parseFloat(heapUsedMB.toFixed(2)),
      heapTotalMB: parseFloat(heapTotalMB.toFixed(2)),
      vramMB: parseFloat((this.vramBytes / (1024 * 1024)).toFixed(2)),
    };

    this.heapSamples.push(entry);
    if (this.heapSamples.length > this.sampleWindow) {
      this.heapSamples.shift();
    }

    return entry;
  }

  detectLeak() {
    if (this.heapSamples.length < 10) return { leaking: false, slope: 0 };

    const n = this.heapSamples.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = this.heapSamples[i].heapUsedMB;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
    return {
      leaking: slope > 0.5,
      growthRateMBPerSample: parseFloat(slope.toFixed(3)),
    };
  }

  getStats() {
    const last = this.heapSamples.length
      ? this.heapSamples[this.heapSamples.length - 1]
      : { heapUsedMB: 0, heapTotalMB: 0, vramMB: 0 };
    const leak = this.detectLeak();
    // Rough growth rate per minute (samples are ~1/frame; assume ~60 fps window)
    const growthMBPerMin =
      leak.growthRateMBPerSample * 60 * (60 / Math.max(1, this.sampleWindow));
    return {
      ...last,
      growthMBPerMin: parseFloat(growthMBPerMin.toFixed(2)),
      leaking: leak.leaking,
    };
  }
}

export default MemoryProfiler;
