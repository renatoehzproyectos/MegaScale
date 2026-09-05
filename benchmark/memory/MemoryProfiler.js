/**
 * MemoryProfiler
 * Supervisa el uso de memoria JS heap y estima el consumo de VRAM asignado
 * por MegaScale para detectar fugas o sobrecarga de memoria en tiempo real.
 */

export class MemoryProfiler {
  constructor({ sampleWindow = 30 } = {}) {
    this.sampleWindow = sampleWindow;
    this.heapSamples = [];
    this.vramBytes = 0;
  }

  setAllocatedVram(bytes) {
    this.vramBytes = bytes;
  }

  sample() {
    let heapUsedMB = 0;
    let heapTotalMB = 0;

    if (typeof performance !== 'undefined' && performance.memory) {
      heapUsedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
      heapTotalMB = performance.memory.totalJSHeapSize / (1024 * 1024);
    }

    const entry = {
      timestamp: performance.now(),
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

    // Regresión lineal simple sobre los últimos samples de heap
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
      leaking: slope > 0.5, // Si sube más de 0.5 MB/sample sostenido
      growthRateMBPerSample: parseFloat(slope.toFixed(3)),
    };
  }
}

export default MemoryProfiler;
