/**
 * SMAA (Subpixel Morphological Anti-Aliasing) — Sección 13 del plan.
 *
 * Nota de honestidad técnica: el SMAA oficial de Jimenez et al. usa 3 passes
 * (edge detection -> blend weight con texturas de área/búsqueda precalculadas
 * -> neighborhood blend). Portar eso completo requiere empaquetar las
 * texturas AreaTex/SearchTex oficiales, que no vamos a generar aquí.
 *
 * Esta es una versión SINGLE-PASS simplificada ("SMAA-lite"): detección de
 * bordes morfológicos por luminancia + blend direccional a lo largo del
 * borde detectado. Da mejor calidad que FXAA (menos "borroneo" plano) a un
 * coste mayor, suficiente para los perfiles BALANCED/QUALITY, pero no es
 * bit-exact con el algoritmo original. Si se necesita SMAA completo más
 * adelante, se puede reemplazar este módulo sin tocar el resto del pipeline.
 */

export const SMAA_LITE_FRAGMENT_SHADER = `#version 300 es
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
  vec3 center = texture(uSource, vUV).rgb;

  vec3 n  = texture(uSource, vUV + vec2(0.0, -texel.y)).rgb;
  vec3 s  = texture(uSource, vUV + vec2(0.0,  texel.y)).rgb;
  vec3 e  = texture(uSource, vUV + vec2( texel.x, 0.0)).rgb;
  vec3 w  = texture(uSource, vUV + vec2(-texel.x, 0.0)).rgb;
  vec3 ne = texture(uSource, vUV + vec2( texel.x, -texel.y)).rgb;
  vec3 nw = texture(uSource, vUV + vec2(-texel.x, -texel.y)).rgb;
  vec3 se = texture(uSource, vUV + vec2( texel.x,  texel.y)).rgb;
  vec3 sw = texture(uSource, vUV + vec2(-texel.x,  texel.y)).rgb;

  float lC = luma(center);
  float dH = abs(luma(e) - luma(w));
  float dV = abs(luma(n) - luma(s));
  float dDiag1 = abs(luma(ne) - luma(sw));
  float dDiag2 = abs(luma(nw) - luma(se));

  const float EDGE_THRESHOLD = 0.05;
  float edgeMag = max(max(dH, dV), max(dDiag1, dDiag2));

  if (edgeMag < EDGE_THRESHOLD) {
    fragColor = vec4(center, 1.0);
    return;
  }

  // Blend direccional: más peso a los vecinos perpendiculares al borde
  // dominante, aproximando el "morphological blend" del SMAA real.
  vec3 result;
  if (dH >= dV && dH >= dDiag1 && dH >= dDiag2) {
    result = mix(center, (n + s) * 0.5, 0.6);
  } else if (dV > dH && dV >= dDiag1 && dV >= dDiag2) {
    result = mix(center, (e + w) * 0.5, 0.6);
  } else if (dDiag1 >= dDiag2) {
    result = mix(center, (nw + se) * 0.5, 0.6);
  } else {
    result = mix(center, (ne + sw) * 0.5, 0.6);
  }

  fragColor = vec4(result, 1.0);
}
`;

export default { SMAA_LITE_FRAGMENT_SHADER };
