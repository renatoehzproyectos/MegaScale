/**
 * FXAA (Fast Approximate Anti-Aliasing) — Sección 13 del plan.
 * Implementación ligera basada en detección de contraste de luminancia,
 * pensada para los perfiles ULTRA PERFORMANCE / PERFORMANCE donde el coste
 * debe ser mínimo.
 */

export const FXAA_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uOutputSize;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 texel = 1.0 / uOutputSize;

  vec3 rgbCenter = texture(uSource, vUV).rgb;
  vec3 rgbN = texture(uSource, vUV + vec2(0.0, -texel.y)).rgb;
  vec3 rgbS = texture(uSource, vUV + vec2(0.0,  texel.y)).rgb;
  vec3 rgbE = texture(uSource, vUV + vec2( texel.x, 0.0)).rgb;
  vec3 rgbW = texture(uSource, vUV + vec2(-texel.x, 0.0)).rgb;

  float lC = luma(rgbCenter);
  float lN = luma(rgbN);
  float lS = luma(rgbS);
  float lE = luma(rgbE);
  float lW = luma(rgbW);

  float lMin = min(lC, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lC, max(max(lN, lS), max(lE, lW)));
  float contrast = lMax - lMin;

  const float EDGE_THRESHOLD = 0.0625;
  const float EDGE_THRESHOLD_MIN = 0.0312;

  if (contrast < max(EDGE_THRESHOLD_MIN, lMax * EDGE_THRESHOLD)) {
    fragColor = vec4(rgbCenter, 1.0);
    return;
  }

  // Blend simple hacia el promedio de vecinos en la dirección de mayor
  // gradiente. No es el FXAA 3.11 completo de NVIDIA (que recorre el borde),
  // pero cubre el caso común de bajo coste que el plan pide para perfiles
  // agresivos de rendimiento.
  vec3 avgNeighbors = (rgbN + rgbS + rgbE + rgbW) * 0.25;
  float blendFactor = clamp(contrast * 2.0, 0.0, 0.75);

  vec3 result = mix(rgbCenter, avgNeighbors, blendFactor);
  fragColor = vec4(result, 1.0);
}
`;

export default { FXAA_FRAGMENT_SHADER };
