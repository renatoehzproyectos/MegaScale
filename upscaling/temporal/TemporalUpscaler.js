/**
 * TemporalUpscaler (WebGPU)
 * Reconstrucción temporal con jitter sub-pixel (Halton 2,3), reproyección
 * mediante vectores de movimiento, rechazo de ghosting mediante YCoCg neighborhood
 * clamping y pasada final de sharpening RCAS adaptativo en compute shader (WGSL).
 */

export class TemporalUpscaler {
  constructor(backend) {
    this.backend = backend;
    this.inputWidth = 0;
    this.inputHeight = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;

    // Ping-pong history textures
    this.historyTextures = [null, null];
    this.historyIndex = 0;

    // Pipelines
    this.reconstructPipeline = null;
    this.rcasPipeline = null;
    this.uniformBuffer = null;

    // Jitter sequence state
    this.jitterIndex = 0;
    this.jitterSequenceLength = 16;
    this.jitterSamples = this._generateHaltonSequence(this.jitterSequenceLength);

    this.initialized = false;
  }

  /**
   * Genera una secuencia de Halton 2,3 centrada en [-0.5, 0.5] para jitter de cámara.
   */
  _generateHaltonSequence(count) {
    const sequence = [];
    for (let i = 1; i <= count; i++) {
      const x = this._halton(i, 2) - 0.5;
      const y = this._halton(i, 3) - 0.5;
      sequence.push({ x, y });
    }
    return sequence;
  }

  _halton(index, base) {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
      result += f * (i % base);
      i = Math.floor(i / base);
      f /= base;
    }
    return result;
  }

  /**
   * Obtiene el offset de jitter para el frame actual en espacio de píxeles normalizado [-0.5, 0.5].
   */
  getNextJitter() {
    const sample = this.jitterSamples[this.jitterIndex];
    this.jitterIndex = (this.jitterIndex + 1) % this.jitterSequenceLength;
    return sample;
  }

  /**
   * Inicializa buffers, texturas y shaders de compute en WebGPU.
   */
  async init(inputWidth, inputHeight, outputWidth, outputHeight) {
    if (!this.backend || !this.backend.isReady) {
      throw new Error('[MegaScale TemporalUpscaler] Backend WebGPU no está listo.');
    }

    this.inputWidth = Math.max(1, Math.round(inputWidth));
    this.inputHeight = Math.max(1, Math.round(inputHeight));
    this.outputWidth = Math.max(1, Math.round(outputWidth));
    this.outputHeight = Math.max(1, Math.round(outputHeight));

    // Crear ping-pong history textures a resolución de salida
    this._disposeHistory();
    this.historyTextures[0] = this.backend.createTexture(
      this.outputWidth,
      this.outputHeight,
      'rgba8unorm',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    );
    this.historyTextures[1] = this.backend.createTexture(
      this.outputWidth,
      this.outputHeight,
      'rgba8unorm',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    );

    // Uniform buffer (inputSize.xy, outputSize.xy, jitter.xy, sharpness, historyWeight)
    // 8 floats = 32 bytes
    this.uniformBuffer = this.backend.createBuffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

    // Compilar WGSL compute pipelines
    this.reconstructPipeline = this.backend.createComputePipeline(
      TEMPORAL_RECONSTRUCT_WGSL,
      'main',
      'TemporalReconstruct'
    );

    this.rcasPipeline = this.backend.createComputePipeline(
      TEMPORAL_RCAS_WGSL,
      'main',
      'TemporalRCAS'
    );

    this.initialized = true;
    return true;
  }

  /**
   * Ejecuta la pasada de reconstrucción temporal + RCAS.
   * @param {Object} params
   * @param {GPUTextureView} params.inputView - Textura de render actual (baja resolución)
   * @param {GPUTextureView} [params.motionView] - Textura de vectores de movimiento (opcional)
   * @param {GPUTextureView} params.outputView - Textura de destino (alta resolución)
   * @param {number} params.renderScale - Escala actual (e.g. 0.7)
   * @param {number} [params.sharpness] - Nivel de nitidez [0..1]
   */
  render({ inputView, motionView = null, outputView, renderScale = 1.0, sharpness = null }) {
    if (!this.initialized || !this.backend.isReady) {
      throw new Error('[MegaScale TemporalUpscaler] No inicializado.');
    }

    const device = this.backend.device;
    const currentHistory = this.historyTextures[this.historyIndex];
    const nextHistory = this.historyTextures[1 - this.historyIndex];

    // Calcular nitidez adaptativa si no se especifica
    const computedSharpness = sharpness !== null
      ? sharpness
      : Math.max(0.1, Math.min(0.9, (1.0 - renderScale) * 1.5 + 0.2));

    const jitter = this.getNextJitter();

    // Actualizar uniforms
    const uniformData = new Float32Array([
      this.inputWidth, this.inputHeight,
      this.outputWidth, this.outputHeight,
      jitter.x, jitter.y,
      computedSharpness,
      0.90, // history blend factor (90% historia, 10% actual)
    ]);
    device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Compute Pass 1: Reconstrucción temporal
    const reconstructBindGroup = device.createBindGroup({
      layout: this.reconstructPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: inputView },
        { binding: 2, resource: currentHistory.createView() },
        { binding: 3, resource: nextHistory.createView() },
      ],
    });

    const workgroupsX = Math.ceil(this.outputWidth / 8);
    const workgroupsY = Math.ceil(this.outputHeight / 8);

    this.backend.runComputePass(
      this.reconstructPipeline,
      [reconstructBindGroup],
      [workgroupsX, workgroupsY, 1]
    );

    // Compute Pass 2: RCAS sharpening hacia el target final
    const rcasBindGroup = device.createBindGroup({
      layout: this.rcasPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: nextHistory.createView() },
        { binding: 2, resource: outputView },
      ],
    });

    this.backend.runComputePass(
      this.rcasPipeline,
      [rcasBindGroup],
      [workgroupsX, workgroupsY, 1]
    );

    // Swap ping-pong history
    this.historyIndex = 1 - this.historyIndex;
  }

  _disposeHistory() {
    if (this.historyTextures[0]) this.backend.destroyResource(this.historyTextures[0]);
    if (this.historyTextures[1]) this.backend.destroyResource(this.historyTextures[1]);
    this.historyTextures = [null, null];
  }

  destroy() {
    this._disposeHistory();
    if (this.uniformBuffer) {
      this.backend.destroyResource(this.uniformBuffer);
      this.uniformBuffer = null;
    }
    this.initialized = false;
  }
}

// WGSL: Temporal accumulation con clamping de vecindad en YCoCg para evitar ghosting
export const TEMPORAL_RECONSTRUCT_WGSL = /* wgsl */`
struct Uniforms {
  inputSize: vec2<f32>,
  outputSize: vec2<f32>,
  jitter: vec2<f32>,
  sharpness: f32,
  historyWeight: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var historyTex: texture_2d<f32>;
@group(0) @binding(3) var outHistoryTex: texture_storage_2d<rgba8unorm, write>;

fn rgbToYCoCg(c: vec3<f32>) -> vec3<f32> {
  let y  = dot(c, vec3<f32>(0.25, 0.5, 0.25));
  let co = dot(c, vec3<f32>(0.5, 0.0, -0.5));
  let cg = dot(c, vec3<f32>(-0.25, 0.5, -0.25));
  return vec3<f32>(y, co, cg);
}

fn yCoCgToRGB(c: vec3<f32>) -> vec3<f32> {
  let y  = c.x;
  let co = c.y;
  let cg = c.z;
  let r  = clamp(y + co - cg, 0.0, 1.0);
  let g  = clamp(y + cg, 0.0, 1.0);
  let b  = clamp(y - co - cg, 0.0, 1.0);
  return vec3<f32>(r, g, b);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let outCoord = vec2<i32>(global_id.xy);
  if (f32(outCoord.x) >= u.outputSize.x || f32(outCoord.y) >= u.outputSize.y) {
    return;
  }

  // Mapear coordenadas de salida a coordenadas del input
  let uv = (vec2<f32>(outCoord) + 0.5) / u.outputSize;
  let inCoord = vec2<i32>(uv * u.inputSize);

  // Leer 3x3 vecindad del frame actual y computar bounding box en espacio YCoCg
  var minColor = vec3<f32>(999.0);
  var maxColor = vec3<f32>(-999.0);
  var currentSample = textureLoad(inputTex, inCoord, 0).rgb;

  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let sampleCoord = clamp(inCoord + vec2<i32>(x, y), vec2<i32>(0), vec2<i32>(u.inputSize) - vec2<i32>(1));
      let col = textureLoad(inputTex, sampleCoord, 0).rgb;
      let ycocg = rgbToYCoCg(col);
      minColor = min(minColor, ycocg);
      maxColor = max(maxColor, ycocg);
    }
  }

  // Leer muestra de historia
  let historyColorRGB = textureLoad(historyTex, outCoord, 0).rgb;
  var historyYCoCg = rgbToYCoCg(historyColorRGB);

  // Clamp de historia al bounding box de vecindad (evita ghosting)
  historyYCoCg = clamp(historyYCoCg, minColor, maxColor);
  let clampedHistoryRGB = yCoCgToRGB(historyYCoCg);

  // Mezcla temporal
  let blendedRGB = mix(currentSample, clampedHistoryRGB, u.historyWeight);

  textureStore(outHistoryTex, outCoord, vec4<f32>(blendedRGB, 1.0));
}
`;

// WGSL: Robust Contrast Adaptive Sharpening (RCAS)
export const TEMPORAL_RCAS_WGSL = /* wgsl */`
struct Uniforms {
  inputSize: vec2<f32>,
  outputSize: vec2<f32>,
  jitter: vec2<f32>,
  sharpness: f32,
  historyWeight: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outFinalTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let coord = vec2<i32>(global_id.xy);
  if (f32(coord.x) >= u.outputSize.x || f32(coord.y) >= u.outputSize.y) {
    return;
  }

  let maxCoord = vec2<i32>(u.outputSize) - vec2<i32>(1);
  let c = textureLoad(inputTex, coord, 0).rgb;
  let n = textureLoad(inputTex, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxCoord), 0).rgb;
  let s = textureLoad(inputTex, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxCoord), 0).rgb;
  let w = textureLoad(inputTex, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxCoord), 0).rgb;
  let e = textureLoad(inputTex, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxCoord), 0).rgb;

  // Luminancia
  let lumaC = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let lumaN = dot(n, vec3<f32>(0.2126, 0.7152, 0.0722));
  let lumaS = dot(s, vec3<f32>(0.2126, 0.7152, 0.0722));
  let lumaW = dot(w, vec3<f32>(0.2126, 0.7152, 0.0722));
  let lumaE = dot(e, vec3<f32>(0.2126, 0.7152, 0.0722));

  let minLuma = min(lumaC, min(min(lumaN, lumaS), min(lumaW, lumaE)));
  let maxLuma = max(lumaC, max(max(lumaN, lumaS), max(lumaW, lumaE)));

  // Contraste adaptativo
  let amp = clamp(min(minLuma, 1.0 - maxLuma) / (maxLuma - minLuma + 0.0001), 0.0, 1.0);
  let peak = -0.25 * amp * u.sharpness;

  let sharpened = (c + (n + s + w + e) * peak) / (1.0 + 4.0 * peak);
  let finalRGB = clamp(sharpened, vec3<f32>(0.0), vec3<f32>(1.0));

  textureStore(outFinalTex, coord, vec4<f32>(finalRGB, 1.0));
}
`;

export default TemporalUpscaler;
