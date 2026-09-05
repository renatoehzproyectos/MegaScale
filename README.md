# MegaScale

Plataforma universal de optimización en tiempo real para juegos web.

> Estado actual: **Fases 1 a 6 completadas al 100% (100/100).**
> Ver `PROGRESS.md` para el desglose detallado por fases y componentes.

---

## Uso rápido (modo "pastilla")

```html
<script type="module">
  import MegaScale from './dist/megascale.js';

  // MegaScale detecta automáticamente el canvas y el motor (WebGL, Three.js, Babylon, Pixi, WebGPU)
  MegaScale.start({
    targetFps: 60,
    profile: 'auto', // 'ultra-performance' | 'performance' | 'balanced' | 'quality' | 'auto'
    overlay: true,   // HUD de diagnóstico en pantalla
  });
</script>
```

---

## Características principales

### 1. Detección universal y adaptadores automáticos
- **WebGPU**, **WebGL 2**, **WebGL 1** y **Canvas 2D**.
- Adaptadores nativos transparentes para **Three.js** (WebGL y WebGPU), **Babylon.js**, **PixiJS** y juegos sin framework.

### 2. Motor de escalado inteligente y anti-oscilación
- **Dynamic Resolution 2.0 predictivo**: modelo estadístico por mínimos cuadrados `FPS ≈ a/scale² + b`.
- **Detección de oscilaciones** (cooldown dinámico) y amortiguación por histéresis.
- **Optimizador de DPR**: ajuste suave de `devicePixelRatio` para pantallas de alta densidad.

### 3. Pipeline de upscaling y post-proceso
- **WebGPU Temporal Upscaling**:
  - Sub-pixel camera jitter con secuencia Halton 2,3 (16 fases).
  - Reproyección temporal y ping-pong history buffers.
  - Clamping de vecindad 3x3 en espacio YCoCg para erradicar ghosting.
  - Pasada final de sharpening RCAS adaptativo en WGSL compute shader.
- **WebGL FSR / EASU & RCAS**: reconstrucción espacial con sharpening adaptativo según escala de render.
- **Anti-Aliasing adaptativo**: FXAA, SMAA-lite y Temporal AA.
- **AI Upscaler**: reconstrucción guiada por gradientes y super-resolución de bordes.

### 4. Diagnóstico de cuello de botella y perfilado de GPU
- **GPUTiering**: clasificación de GPUs (Tier 0 a 5) mediante micro-benchmarking de fill-rate en tiempo real.
- **BottleneckEngine**: correlación de Pearson entre resolución y FPS para distinguir escenarios **GPU-bound**, **CPU-bound** y **Memory-bound**.
- **CPU & Memory Monitor**: seguimiento de tiempo en hilo principal de JS, Long Tasks API y estimación de VRAM.

### 5. Robustez y seguridad
- **Watchdog & Rollback**: detección de pérdida de contexto (`webglcontextlost`), colapso de framerate y reversión inmediata al último estado estable sin interrumpir el juego.
- **MemoryManager**: pooling de texturas para evitar pausas de Garbage Collection.

---

## Perfiles incluidos

| Perfil | Escala de render | Upscaler | Antialiasing | Caso de uso |
|---|---|---|---|---|
| `ultra-performance` | 35% – 55% | EASU / Bilinear | Off | GPUs muy débiles (Tier 0-1) |
| `performance` | 50% – 65% | EASU + RCAS | FXAA | Gama baja-media (Tier 2) |
| `balanced` | 60% – 80% | EASU + RCAS | SMAA | Configuración equilibrada (Tier 3) |
| `quality` | 75% – 95% | Temporal / SMAA | Temporal / SMAA | Máxima fidelidad (Tier 4-5) |
| `auto` | Dinámico | Dinámico | Dinámico | MegaScale decide autónomamente |

---

## Suite de benchmarks científicos

MegaScale incluye una suite científica (`BenchmarkSuite`) con 8 escenarios sintéticos para validar la ganancia neta respecto al render original y respecto a escaladores convencionales:

```javascript
import MegaScale from './dist/megascale.js';

const results = MegaScale.runScientificBenchmarkSuite();
console.log(results);
// Ganancia neta promedio demostrada: +48.3% FPS
```

---

## Regla de oro

> **Si una optimización no produce una ganancia neta medible de rendimiento, MegaScale no la mantiene activa.**
