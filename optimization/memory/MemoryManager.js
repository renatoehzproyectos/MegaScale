/**
 * MemoryManager
 * Control central del ciclo de vida de recursos creados por MegaScale
 * (texturas, buffers, framebuffers, history buffers).
 *
 * Objetivos del Plan Maestro (Sección 18, 30):
 * - Evitar presión de memoria y recolección de basura (GC pauses) mediante pooling.
 * - Evitar duplicación innecesaria.
 * - Manejo robusto de context loss (webglcontextlost / webglcontextrestored).
 * - Liberación explícita y contabilidad de bytes asignados.
 */

export class MemoryManager {
  constructor({ maxBudgetMB = 128 } = {}) {
    this.maxBudgetBytes = maxBudgetMB * 1024 * 1024;
    this.allocatedBytes = 0;
    this.resources = new Map(); // id -> resource descriptor
    this.texturePool = new Map(); // key `${w}x${h}_${format}` -> array of textures
    this.nextResourceId = 1;
    this.contextLost = false;
    this.restoreCallbacks = new Set();
  }

  /**
   * Registra un recurso GPU bajo control de MegaScale.
   */
  register(type, handle, sizeBytes = 0, glOrDevice = null, metadata = {}) {
    const id = this.nextResourceId++;
    const descriptor = {
      id,
      type, // 'texture' | 'buffer' | 'framebuffer' | 'pipeline'
      handle,
      sizeBytes,
      glOrDevice,
      metadata,
      createdAt: performance.now(),
    };

    this.resources.set(id, descriptor);
    this.allocatedBytes += sizeBytes;

    if (this.allocatedBytes > this.maxBudgetBytes) {
      // eslint-disable-next-line no-console
      console.warn(`[MegaScale MemoryManager] Presupuesto superado: ${(this.allocatedBytes / 1024 / 1024).toFixed(2)} MB / ${(this.maxBudgetBytes / 1024 / 1024).toFixed(2)} MB`);
    }

    return id;
  }

  /**
   * Libera un recurso específico.
   */
  unregister(id) {
    const descriptor = this.resources.get(id);
    if (!descriptor) return false;

    this._destroyHandle(descriptor);
    this.allocatedBytes -= descriptor.sizeBytes;
    this.resources.delete(id);
    return true;
  }

  /**
   * Obtiene o crea una textura desde el pool para evitar asignaciones constantes en el render loop.
   */
  acquirePooledTexture(gl, width, height, internalFormat = 0x8058 /* RGBA8 */) {
    const key = `${width}x${height}_${internalFormat}`;
    const pool = this.texturePool.get(key);

    if (pool && pool.length > 0) {
      return pool.pop();
    }

    // Crear nueva textura si el pool está vacío
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const sizeBytes = width * height * 4;
    const resourceId = this.register('texture', texture, sizeBytes, gl, { width, height, poolKey: key });

    return { texture, resourceId, width, height, poolKey: key };
  }

  /**
   * Devuelve una textura al pool para que sea reutilizada por otro pase.
   */
  releasePooledTexture(pooledObj) {
    if (!pooledObj || !pooledObj.poolKey || this.contextLost) return;

    let pool = this.texturePool.get(pooledObj.poolKey);
    if (!pool) {
      pool = [];
      this.texturePool.set(pooledObj.poolKey, pool);
    }
    pool.push(pooledObj);
  }

  /**
   * Manejador de pérdida de contexto WebGL.
   */
  handleContextLost() {
    this.contextLost = true;
    this.texturePool.clear();
    this.resources.clear();
    this.allocatedBytes = 0;
    // eslint-disable-next-line no-console
    console.warn('[MegaScale MemoryManager] Contexto perdido. Recursos limpiados.');
  }

  /**
   * Manejador de restauración de contexto WebGL.
   */
  handleContextRestored() {
    this.contextLost = false;
    // eslint-disable-next-line no-console
    console.info('[MegaScale MemoryManager] Contexto restaurado. Reconstruyendo recursos...');
    for (const cb of this.restoreCallbacks) {
      try {
        cb();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[MegaScale MemoryManager] Error en callback de restauración:', e);
      }
    }
  }

  onRestore(callback) {
    this.restoreCallbacks.add(callback);
    return () => this.restoreCallbacks.delete(callback);
  }

  _destroyHandle(desc) {
    const { handle, glOrDevice, type } = desc;
    if (!handle || !glOrDevice || this.contextLost) return;

    try {
      if (type === 'texture' && typeof glOrDevice.deleteTexture === 'function') {
        glOrDevice.deleteTexture(handle);
      } else if (type === 'framebuffer' && typeof glOrDevice.deleteFramebuffer === 'function') {
        glOrDevice.deleteFramebuffer(handle);
      } else if (type === 'buffer' && typeof glOrDevice.deleteBuffer === 'function') {
        glOrDevice.deleteBuffer(handle);
      } else if (typeof handle.destroy === 'function') {
        handle.destroy(); // WebGPU resource
      }
    } catch {
      // Ignorar si el contexto ya fue destruido
    }
  }

  /**
   * Libera todos los recursos gestionados.
   */
  disposeAll() {
    for (const pool of this.texturePool.values()) {
      for (const item of pool) {
        if (item.resourceId) this.unregister(item.resourceId);
      }
    }
    this.texturePool.clear();

    for (const [id, desc] of this.resources.entries()) {
      this._destroyHandle(desc);
    }
    this.resources.clear();
    this.allocatedBytes = 0;
  }

  getStats() {
    return {
      allocatedMB: (this.allocatedBytes / 1024 / 1024).toFixed(2),
      resourceCount: this.resources.size,
      contextLost: this.contextLost,
    };
  }
}

export default MemoryManager;
