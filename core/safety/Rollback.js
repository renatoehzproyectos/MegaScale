/**
 * RollbackManager
 * Guarda snapshots de configuración aplicada por MegaScale y permite
 * revertir a un estado anterior conocido-bueno cuando el Watchdog detecta
 * un problema (Sección 28 del plan maestro).
 */

export class RollbackManager {
  constructor({ maxHistory = 20 } = {}) {
    this.maxHistory = maxHistory;
    this.history = [];
    this.disabledModules = new Set();
  }

  /**
   * Guarda un snapshot ANTES de aplicar un cambio.
   */
  snapshot(state) {
    this.history.push({ state: JSON.parse(JSON.stringify(state)), timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Devuelve el último estado conocido-bueno sin eliminarlo del historial.
   */
  peekLastGood() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].state;
  }

  /**
   * Revierte al último estado guardado, y opcionalmente desactiva el módulo
   * responsable para que no se vuelva a intentar automáticamente.
   */
  rollback({ disableModule = null } = {}) {
    const last = this.history.pop();
    if (disableModule) {
      this.disabledModules.add(disableModule);
    }
    return last ? last.state : null;
  }

  isModuleDisabled(moduleName) {
    return this.disabledModules.has(moduleName);
  }

  clear() {
    this.history = [];
  }
}

export default RollbackManager;
