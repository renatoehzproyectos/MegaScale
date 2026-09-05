# MegaScale — Progreso

Ponderación por fases (peso aproximado según complejidad real, no en partes iguales):

| Fase | Peso | Estado | % completado de la fase |
|---|---|---|---|
| 1. Foundation | 15% | ✅ Completa | 100% |
| 2. WebGL (FSR/EASU/RCAS/FXAA/SMAA/DPR) | 20% | ✅ Completa | 100% |
| 3. Intelligence (predictor, GPU profiling, bottleneck) | 20% | ✅ Completa | 100% |
| 4. WebGPU (temporal upscaling) | 20% | ⬜ Pendiente | 0% |
| 5. Advanced (IA upscaling, memoria avanzada) | 15% | ⬜ Pendiente | 0% |
| 6. Universal Adapters (Three/Babylon/Pixi/unknown) | 10% | ⬜ Pendiente | 0% |

**Progreso total del proyecto: 55% (55/100)**

## Detalle Fase 1 (completada)

- [x] Arquitectura modular (árbol completo de carpetas)
- [x] RendererDetector (WebGL1/2, WebGPU, Canvas2D, capacidades, engine detection)
- [x] Profiler (FPS, frame time, varianza, tendencia)
- [x] Benchmark (baseline + tests comparativos + regla de ganancia neta)
- [x] DynamicResolution v1 (no predictiva, con cooldown/hysteresis)
- [x] Watchdog (fps floor, fps collapse, context loss, errores)
- [x] RollbackManager (snapshots + revert + disable module)
- [x] Controller (orquesta todo el ciclo)
- [x] Overlay de desarrollo
- [x] Entry point público `dist/megascale.js` (API "pastilla")

## Detalle Fase 2 (completada)

- [x] DPROptimizer (Sección 15) — prueba 2.0/1.75/1.5/1.25/1.0 y se queda con el
      más alto que cumpla el target de FPS
- [x] EASU simplificado (Sección 11) — shader GLSL ES 3.00, kernel 3x3 con
      detección de gradiente. **Nota honesta:** no es port bit-exact del kernel
      Lanczos oficial de AMD FidelityFX; es una aproximación de coste bajo con
      resultado visual similar (bordes más definidos que bilinear plano)
- [x] RCAS adaptativo (Sección 14) — sharpening que escala con el render scale
      actual (`computeAdaptiveSharpness`), nunca al máximo de forma permanente
- [x] FXAA (Sección 13) — versión ligera basada en contraste de luminancia
- [x] SMAA-lite (Sección 13) — **Nota honesta:** el SMAA oficial usa 3 passes
      con texturas de área/búsqueda precalculadas (AreaTex/SearchTex); esta es
      una versión single-pass de detección de bordes + blend direccional,
      mejor calidad que FXAA pero no bit-exact con el algoritmo original.
      Reemplazable después sin tocar el resto del pipeline si se necesita el
      SMAA completo.
- [x] WebGLBackend — compilación/cache de shaders, fullscreen quad, render
      targets con liberación explícita (para el futuro Memory Manager)
- [x] PresentationPipeline (Sección 22) — encadena EASU → RCAS → AA opcional,
      mide ms por etapa contra el budget de 16.67ms y sugiere qué recortar

### Limitación conocida de esta entrega

`PresentationPipeline` está listo y probado como módulo aislado, pero **no
está auto-conectado dentro del `Controller`** todavía: para insertarlo en el
pipeline de un juego arbitrario hace falta que el juego renderice a una
textura interna (render-to-texture) en vez de directamente a pantalla, y esa
integración varía según el motor (raw WebGL vs Three.js vs Babylon). Esa
integración "sin fricción" es exactamente el trabajo de la **Fase 6
(Universal Adapters)**. Por ahora, `PresentationPipeline` se puede usar
manualmente pasándole la textura de origen del juego.

## Detalle Fase 3 (completada)

- [x] `PerformancePredictor` (Sección 8) — ajusta un modelo `FPS ≈ a/scale² + b`
      por mínimos cuadrados sobre muestras reales, predice FPS para una escala
      o la escala necesaria para un FPS objetivo. Incluye `validatePrediction`
      para detectar cuándo el modelo se equivoca seguido y hay que desconfiar
      de él (protección explícita pedida en la Sección 8).
- [x] `GPUTiering` (Sección 4) — clasifica TIER 0-5 combinando capacidades
      detectadas + un micro-benchmark real de fill-rate (no solo el nombre
      de la GPU, que puede venir bloqueado/falseado por el navegador).
- [x] `BottleneckEngine` (Sección 20) — correlación de Pearson entre "píxeles
      a renderizar" (1/scale²) y FPS observado, para distinguir GPU-bound,
      CPU-bound, memory-bound o señal ambigua.
- [x] `OptimizationGraph` (Sección 23/24) — propone perfil/upscaler/AA inicial
      según GPU tier + bottleneck, sin probar combinaciones exhaustivas, y
      aprende qué módulos descartar tras resultados netos negativos repetidos.
- [x] `OscillationDetector` (Sección 9) — detecta el patrón 60→45→60→45 contando
      cambios de signo en la dirección de ajustes, y recomienda multiplicar el
      cooldown de `DynamicResolution` cuando hay oscilación.
- [x] Integrado en `Controller`: al terminar el baseline, clasifica la GPU,
      propone configuración inicial, y alimenta predictor/bottleneck engine
      con cada frame. Expuesto vía `MegaScale.getIntelligenceReport()`.

### Nota de calibración

Los umbrales de `GPUTiering` (fill-rate) y `BottleneckEngine` (correlación) son
heurísticos iniciales razonables, no calibrados contra un dataset real de
dispositivos. `benchmark/regression/` (Fase futura de benchmark científico,
Sección 34) es donde correspondería validarlos y ajustarlos con datos reales.


## Siguiente entrega (Fase 4 — WebGPU)

- [ ] WebGPU detection ya existe (Fase 1), falta el backend real
- [ ] Compute pipeline para reconstrucción temporal
- [ ] Motion vectors, depth, jitter, history buffers
- [ ] Temporal upscaling completo + RCAS final
- [ ] Fallback automático a WebGL si WebGPU no está disponible

Cuando el usuario confirme, se construye la Fase 4 y este archivo se actualiza.
