/**
 * RCAS (Robust Contrast Adaptive Sharpening) — Sección 11 y 14 del plan.
 * Sharpening adaptativo aplicado DESPUÉS del upscale (EASU u otro).
 *
 * `uSharpness` se calcula fuera del shader según el render scale actual
 * (Sección 14: scale bajo -> sharpening alto, scale alto -> sharpening bajo),
 * para no aplicar sharpening máximo de forma permanente.
 */

export const RCAS_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uOutputSize;
uniform float uSharpness; // 0.0 (sin efecto) .. 1.0 (máximo, evitar usar permanentemente)

vec3 sampleAt(vec2 uv) {
  return texture(uSource, uv).rgb;
}

void main() {
  vec2 texel = 1.0 / uOutputSize;

  vec3 center = sampleAt(vUV);
  vec3 up     = sampleAt(vUV + vec2(0.0, -texel.y));
  vec3 down   = sampleAt(vUV + vec2(0.0,  texel.y));
  vec3 left   = sampleAt(vUV + vec2(-texel.x, 0.0));
  vec3 right  = sampleAt(vUV + vec2( texel.x, 0.0));

  vec3 minC = min(center, min(min(up, down), min(left, right)));
  vec3 maxC = max(center, max(max(up, down), max(left, right)));

  // Peso de contraste local: en zonas de alto contraste, RCAS reduce el
  // sharpening para evitar halos (esto es lo que hace "robusto" al filtro).
  vec3 contrastRange = max(maxC - minC, vec3(1e-4));
  vec3 localContrastWeight = clamp(1.0 - contrastRange * 2.0, 0.0, 1.0);

  vec3 blurSum = up + down + left + right;
  vec3 sharpened = center * (1.0 + 4.0 * uSharpness) - blurSum * uSharpness;

  vec3 result = mix(center, sharpened, localContrastWeight);
  result = clamp(result, 0.0, 1.0);

  fragColor = vec4(result, 1.0);
}
`;

/**
 * Calcula el nivel de sharpening recomendado según el render scale actual,
 * siguiendo la tabla conceptual de la Sección 14:
 *   Scale 0.95 -> bajo | Scale 0.75 -> medio | Scale 0.55 -> alto
 */
export function computeAdaptiveSharpness(renderScale) {
  const clamped = Math.min(1.0, Math.max(0.3, renderScale));
  // Interpolación lineal simple: a menor escala, más sharpening (hasta un tope).
  const t = 1.0 - (clamped - 0.3) / (1.0 - 0.3); // 0 en scale=1.0, 1 en scale=0.3
  const MIN_SHARPNESS = 0.15;
  const MAX_SHARPNESS = 0.65; // tope: nunca "máximo absoluto" permanente
  return Number((MIN_SHARPNESS + t * (MAX_SHARPNESS - MIN_SHARPNESS)).toFixed(3));
}

export default { RCAS_FRAGMENT_SHADER, computeAdaptiveSharpness };
