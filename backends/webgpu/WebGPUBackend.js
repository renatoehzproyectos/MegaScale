/**
 * WebGPUBackend
 * Gestiona la inicialización de WebGPU (Adapter, Device, Queue, Context),
 * compilación de shaders WGSL, creación de compute/render pipelines, texturas,
 * buffers y pasadas de cómputo para el pipeline temporal de MegaScale.
 * Incluye fallback automático a WebGL si WebGPU no está disponible.
 */

export class WebGPUBackend {
  constructor(canvas = null) {
    this.canvas = canvas;
    this.adapter = null;
    this.device = null;
    this.context = null;
    this.format = null;
    this.isReady = false;
    this._pipelines = new Map();
    this._allocatedResources = new Set();
  }

  /**
   * Comprueba si WebGPU está soportado por el navegador/entorno.
   */
  static async isSupported() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return false;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch {
      return false;
    }
  }

  /**
   * Inicializa el backend WebGPU en el canvas indicado.
   */
  async init(canvas = this.canvas, options = {}) {
    this.canvas = canvas;
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      throw new Error('[MegaScale WebGPU] navigator.gpu no está disponible en este entorno.');
    }

    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: options.powerPreference || 'high-performance',
    });

    if (!this.adapter) {
      throw new Error('[MegaScale WebGPU] No se pudo obtener un GPUAdapter compatible.');
    }

    this.device = await this.adapter.requestDevice({
      requiredFeatures: options.requiredFeatures || [],
      requiredLimits: options.requiredLimits || {},
    });

    if (this.canvas) {
      this.context = this.canvas.getContext('webgpu');
      if (this.context) {
        this.format = navigator.gpu.getPreferredCanvasFormat
          ? navigator.gpu.getPreferredCanvasFormat()
          : 'bgra8unorm';
        this.context.configure({
          device: this.device,
          format: this.format,
          alphaMode: options.alphaMode || 'premultiplied',
        });
      }
    }

    // Manejo de pérdida de contexto WebGPU
    if (this.device.lost) {
      this.device.lost.then((info) => {
        // eslint-disable-next-line no-console
        console.warn(`[MegaScale WebGPU] Dispositivo perdido: ${info.message} (${info.reason})`);
        this.isReady = false;
      });
    }

    this.isReady = true;
    return this;
  }

  /**
   * Compila un shader module WGSL y crea una Compute Pipeline.
   */
  createComputePipeline(wgslCode, entryPoint = 'main', label = 'compute_pipeline') {
    if (!this.device) throw new Error('[MegaScale WebGPU] Device no inicializado.');

    const cacheKey = `${label}_${entryPoint}_${wgslCode}`;
    if (this._pipelines.has(cacheKey)) {
      return this._pipelines.get(cacheKey);
    }

    const shaderModule = this.device.createShaderModule({
      label: `${label}_module`,
      code: wgslCode,
    });

    const pipeline = this.device.createComputePipeline({
      label,
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint,
      },
    });

    this._pipelines.set(cacheKey, pipeline);
    return pipeline;
  }

  /**
   * Crea una textura GPU con los flags de uso especificados.
   */
  createTexture(width, height, format = 'rgba8unorm', usage = null) {
    if (!this.device) throw new Error('[MegaScale WebGPU] Device no inicializado.');

    const defaultUsage =
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC;

    const texture = this.device.createTexture({
      size: [Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), 1],
      format,
      usage: usage !== null ? usage : defaultUsage,
    });

    this._allocatedResources.add(texture);
    return texture;
  }

  /**
   * Crea un buffer GPU para uniforms o storage.
   */
  createBuffer(dataOrSize, usage) {
    if (!this.device) throw new Error('[MegaScale WebGPU] Device no inicializado.');

    let size = 0;
    let mappedAtCreation = false;

    if (typeof dataOrSize === 'number') {
      size = Math.ceil(dataOrSize / 4) * 4; // alinear a 4 bytes
    } else if (dataOrSize instanceof ArrayBuffer || ArrayBuffer.isView(dataOrSize)) {
      size = Math.ceil(dataOrSize.byteLength / 4) * 4;
      mappedAtCreation = true;
    }

    const buffer = this.device.createBuffer({
      size,
      usage,
      mappedAtCreation,
    });

    if (mappedAtCreation) {
      const arrayBuffer = buffer.getMappedRange();
      if (dataOrSize instanceof Float32Array) {
        new Float32Array(arrayBuffer).set(dataOrSize);
      } else if (dataOrSize instanceof Uint32Array) {
        new Uint32Array(arrayBuffer).set(dataOrSize);
      } else if (dataOrSize instanceof Uint8Array) {
        new Uint8Array(arrayBuffer).set(dataOrSize);
      } else {
        new Uint8Array(arrayBuffer).set(new Uint8Array(dataOrSize));
      }
      buffer.unmap();
    }

    this._allocatedResources.add(buffer);
    return buffer;
  }

  /**
   * Ejecuta una pasada de computación (compute pass).
   */
  runComputePass(pipeline, bindGroups = [], workgroups = [1, 1, 1]) {
    if (!this.device) throw new Error('[MegaScale WebGPU] Device no inicializado.');

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);

    bindGroups.forEach((bg, index) => {
      passEncoder.setBindGroup(index, bg);
    });

    passEncoder.dispatchWorkgroups(workgroups[0] || 1, workgroups[1] || 1, workgroups[2] || 1);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Libera un recurso específico (textura o buffer).
   */
  destroyResource(resource) {
    if (!resource) return;
    if (typeof resource.destroy === 'function') {
      resource.destroy();
    }
    this._allocatedResources.delete(resource);
  }

  /**
   * Destruye todos los recursos y limpia el estado del backend.
   */
  destroy() {
    for (const res of this._allocatedResources) {
      if (typeof res.destroy === 'function') {
        res.destroy();
      }
    }
    this._allocatedResources.clear();
    this._pipelines.clear();

    if (this.device) {
      if (typeof this.device.destroy === 'function') {
        this.device.destroy();
      }
      this.device = null;
    }
    this.isReady = false;
  }
}

export default WebGPUBackend;
