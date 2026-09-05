/**
 * CPUMonitor
 * Monitorea la actividad del hilo principal de JavaScript y rAF para detectar
 * cuellos de botella en la CPU, tareas largas (Long Tasks API) y presión de GC.
 *
 * Plan Maestro (Sección 21):
 * "GPU: 5 ms, CPU: 25 ms -> Bajar resolución no tendrá efecto en el cuello de botella."
 */

export class CPUMonitor {
  constructor({ sampleWindow = 60 } = {}) {
    this.sampleWindow = sampleWindow;
    this.cpuTimes = [];
    this.longTasks = [];
    this.observer = null;
    this.lastFrameTimestamp = 0;
    this.estimatedCpuBound = false;
    this._initLongTaskObserver();
  }

  _initLongTaskObserver() {
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const supportedTypes = PerformanceObserver.supportedEntryTypes || [];
        if (supportedTypes.includes('longtask')) {
          this.observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              this.longTasks.push({
                duration: entry.duration,
                startTime: entry.startTime,
              });
              if (this.longTasks.length > 50) this.longTasks.shift();
            }
          });
          this.observer.observe({ entryTypes: ['longtask'] });
        }
      } catch {
        // Fallback silencioso si no está permitido
      }
    }
  }

  /**
   * Registra el inicio de ejecución del frame en el main thread.
   */
  startFrame() {
    return performance.now();
  }

  /**
   * Registra el fin de la ejecución del frame en JS.
   */
  endFrame(startTime) {
    const duration = performance.now() - startTime;
    this.cpuTimes.push(duration);
    if (this.cpuTimes.length > this.sampleWindow) {
      this.cpuTimes.shift();
    }
    return duration;
  }

  /**
   * Obtiene métricas de CPU y diagnóstico de cuello de botella.
   */
  getMetrics() {
    if (this.cpuTimes.length === 0) {
      return { avgCpuMs: 0, maxCpuMs: 0, isCpuBound: false, longTaskCount: 0 };
    }

    const sum = this.cpuTimes.reduce((a, b) => a + b, 0);
    const avgCpuMs = sum / this.cpuTimes.length;
    const maxCpuMs = Math.max(...this.cpuTimes);

    // Si el tiempo de JS en CPU supera los 12ms por frame (de 16.67ms budget a 60 FPS), es CPU-bound
    const isCpuBound = avgCpuMs > 12.0;

    return {
      avgCpuMs: parseFloat(avgCpuMs.toFixed(2)),
      maxCpuMs: parseFloat(maxCpuMs.toFixed(2)),
      isCpuBound,
      longTaskCount: this.longTasks.length,
      recentLongTasks: [...this.longTasks],
    };
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.cpuTimes = [];
    this.longTasks = [];
  }
}

export default CPUMonitor;
