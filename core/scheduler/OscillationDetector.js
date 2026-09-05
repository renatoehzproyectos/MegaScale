/**
 * OscillationDetector (Sección 9 del plan maestro)
 *
 * Complementa el cooldown simple ya presente en DynamicResolution v1
 * (Fase 1). Aquí se detecta el patrón específico que el plan describe:
 *
 *   60 -> 45 -> 60 -> 45 -> 60   (sube/baja/sube/baja repetido)
 *
 * mirando cambios de signo consecutivos en la dirección de los ajustes de
 * escala. Si se detecta oscilación, se recomienda un "hold time" extendido
 * (much más largo que el cooldown normal) antes de permitir el próximo
 * cambio, para dejar que el sistema se asiente.
 */

export class OscillationDetector {
  constructor({ historySize = 10, oscillationSignThreshold = 3 } = {}) {
    this.historySize = historySize;
    this.oscillationSignThreshold = oscillationSignThreshold;
    this.directionHistory = []; // 'up' | 'down'
  }

  /**
   * Registra la dirección de un cambio de escala aplicado.
   * @param {'up'|'down'} direction
   */
  recordChange(direction) {
    this.directionHistory.push(direction);
    if (this.directionHistory.length > this.historySize) {
      this.directionHistory.shift();
    }
  }

  /**
   * Cuenta cuántas veces cambió el signo de dirección en el historial
   * reciente (up->down o down->up). Muchos cambios de signo en poco
   * historial = oscilación.
   */
  countSignChanges() {
    let changes = 0;
    for (let i = 1; i < this.directionHistory.length; i++) {
      if (this.directionHistory[i] !== this.directionHistory[i - 1]) {
        changes++;
      }
    }
    return changes;
  }

  isOscillating() {
    return this.countSignChanges() >= this.oscillationSignThreshold;
  }

  /**
   * Multiplicador a aplicar sobre el cooldown/hold-time normal cuando se
   * detecta oscilación. 1.0 = sin cambio, 4.0 = cuadruplicar el tiempo de
   * espera antes de permitir otro ajuste.
   */
  getRecommendedHoldMultiplier() {
    if (!this.isOscillating()) return 1.0;
    const changes = this.countSignChanges();
    return Math.min(6.0, 1.0 + changes * 0.8);
  }

  reset() {
    this.directionHistory = [];
  }
}

export default OscillationDetector;
