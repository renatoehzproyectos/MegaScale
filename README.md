# MegaScale

Plataforma universal de optimización en tiempo real para juegos web.

> Estado actual: **FASE 1, FASE 2 y FASE 3 completadas — 55% del proyecto.**
> Ver `PROGRESS.md` para el desglose por fases y las notas honestas sobre alcance
> real de EASU/SMAA (aproximaciones simplificadas) y calibración de heurísticas.

## Uso (modo pastilla)

```html
<script type="module">
  import MegaScale from './dist/megascale.js';

  const canvas = document.querySelector('canvas');
  MegaScale.start({ canvas, targetFps: 60, overlay: true });
</script>
```

Con `overlay: true` verás un panel en la esquina superior izquierda con FPS, frame time,
renderer detectado y el render scale actual. En producción, déjalo en `false` (por defecto).

## Qué hace ahora mismo (Fase 1)

- **Detecta** el entorno: WebGL1 / WebGL2 / WebGPU / Canvas2D, extensiones, capacidades,
  DPR, tamaño de canvas y motor (Three.js/Babylon/Pixi si están presentes en `window`).
- **Mide un baseline** de FPS y frame time apenas arranca.
- **Monitorea** cada frame (FPS, frame time, varianza, tendencia).
- **Ajusta la resolución dinámicamente** (render scale) dentro de límites seguros, con
  cooldown para evitar oscilaciones (sube/baja/sube/baja).
- **Vigila fallos** (colapso de FPS, pérdida de contexto WebGL, errores) mediante el
  `Watchdog`, y si detecta un problema, **revierte** al último estado bueno conocido vía
  `RollbackManager` y desactiva el módulo problemático.

## Qué agrega la Fase 2 (WebGL)

- **DPROptimizer**: prueba valores de DPR efectivo (2.0 → 1.0) y se queda con el más alto
  que siga cumpliendo el target de FPS.
- **EASU** (upscale con reconstrucción de bordes) + **RCAS** (sharpening adaptativo, sube
  cuando el render scale baja, nunca al máximo permanente).
- **FXAA** y **SMAA-lite** como opciones de antialiasing por perfil.
- **PresentationPipeline**: encadena EASU → RCAS → AA y mide el coste en ms de cada etapa
  contra el budget de 16.67ms (60 FPS), sugiriendo qué recortar si no entra.
- ⚠️ Nota de alcance honesta: EASU y SMAA aquí son **aproximaciones simplificadas**, no
  ports bit-exact de FSR1/AMD ni de SMAA de Jimenez et al. (ver detalle en `PROGRESS.md`).
  El `PresentationPipeline` funciona como módulo aislado pero todavía no está
  auto-conectado al render de un juego arbitrario — eso depende de cómo cada motor expone
  su render-to-texture, y se resuelve en la Fase 6 (Universal Adapters).

## Qué agrega la Fase 3 (Intelligence)

- **PerformancePredictor**: aprende `FPS ≈ a/scale² + b` de muestras reales y predice
  la escala necesaria para un FPS objetivo, con protección contra predicciones erróneas.
- **GPUTiering**: clasifica TIER 0-5 combinando capacidades detectadas + un micro-benchmark
  real de fill-rate (no solo el nombre de la GPU).
- **BottleneckEngine**: distingue GPU-bound / CPU-bound / memory-bound por correlación
  entre render scale y FPS observado — evita seguir bajando resolución cuando no ayuda.
- **OptimizationGraph**: propone perfil + upscaler + AA inicial según GPU tier y bottleneck,
  sin probar todas las combinaciones, y aprende qué módulos descartar tras fallar repetido.
- **OscillationDetector**: detecta el patrón 60→45→60→45 y extiende el cooldown automáticamente.
- Todo integrado en el `Controller`: consulta con `MegaScale.getIntelligenceReport()`.

⚠️ Los umbrales de `GPUTiering` y `BottleneckEngine` son heurísticos razonables pero no
calibrados contra un dataset real de dispositivos — ver nota en `PROGRESS.md`.

## Qué NO hace todavía

WebGPU backend y temporal upscaling, IA upscaling, optimización de texturas/framebuffers/
shaders del juego, memory manager avanzado, compatibility layer completo para
Three.js/Babylon/Pixi, y la suite de benchmark científico. Todo mapeado en `PROGRESS.md`.

## Estructura

Ver el árbol completo en `MegaScale_Plan_Maestro.md` (incluido). Las carpetas ya existen
para las fases futuras, aunque muchas están vacías a propósito — se irán llenando en orden.

## Principio central

> Toda optimización debe demostrar una ganancia neta de rendimiento para mantenerse activa.
> Si no la demuestra, MegaScale no la usa.
