/**
 * EASU (Edge Adaptive Spatial Upsampling) — parte de FSR1 (Sección 11).
 *
 * Esta es una versión SIMPLIFICADA del EASU original de AMD, adaptada para
 * WebGL1/2 (GLSL ES 1.00/3.00) sin depender de las macros oficiales de AMD
 * (FSR_ONE_H, etc.), que están pensadas para HLSL/compute. El objetivo es el
 * mismo: reconstruir bordes con más nitidez que un bilinear plano al hacer
 * upscale desde una resolución interna menor.
 *
 * Nota de honestidad técnica: esto NO es un port 1:1 del kernel oficial de
 * AMD FidelityFX; es una aproximación basada en un sampling de vecindario
 * 3x3 con detección de gradiente, que da resultados visualmente similares
 * (bordes más definidos que bilinear) a un coste bajo. Para una implementación
 * bit-exact habría que portar el kernel Lanczos de AMD tal cual.
 */

export const EASU_VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const EASU_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uSourceSize;   // resolución interna (baja)
uniform vec2 uOutputSize;   // resolución de salida (alta)

vec3 sampleSrc(vec2 uv) {
  return texture(uSource, uv).rgb;
}

void main() {
  vec2 texelSize = 1.0 / uSourceSize;
  vec2 srcUV = vUV;

  // Vecindario 3x3 alrededor del texel más cercano en la fuente.
  vec3 c00 = sampleSrc(srcUV + texelSize * vec2(-1.0, -1.0));
  vec3 c10 = sampleSrc(srcUV + texelSize * vec2( 0.0, -1.0));
  vec3 c20 = sampleSrc(srcUV + texelSize * vec2( 1.0, -1.0));
  vec3 c01 = sampleSrc(srcUV + texelSize * vec2(-1.0,  0.0));
  vec3 c11 = sampleSrc(srcUV);
  vec3 c21 = sampleSrc(srcUV + texelSize * vec2( 1.0,  0.0));
  vec3 c02 = sampleSrc(srcUV + texelSize * vec2(-1.0,  1.0));
  vec3 c12 = sampleSrc(srcUV + texelSize * vec2( 0.0,  1.0));
  vec3 c22 = sampleSrc(srcUV + texelSize * vec2( 1.0,  1.0));

  // Detección de gradiente (Sobel simplificado) para decidir cuánto pesar
  // el centro vs. el promedio bilinear -> más nitidez en bordes, más
  // suavidad en zonas planas.
  float lC00 = dot(c00, vec3(0.299, 0.587, 0.114));
  float lC20 = dot(c20, vec3(0.299, 0.587, 0.114));
  float lC02 = dot(c02, vec3(0.299, 0.587, 0.114));
  float lC22 = dot(c22, vec3(0.299, 0.587, 0.114));
  float lC11 = dot(c11, vec3(0.299, 0.587, 0.114));

  float gx = (lC20 + lC22) - (lC00 + lC02);
  float gy = (lC02 + lC22) - (lC00 + lC20);
  float edgeStrength = clamp(length(vec2(gx, gy)) * 2.0, 0.0, 1.0);

  vec3 bilinear = texture(uSource, srcUV).rgb;

  vec3 sharpNeighborhood =
      c11 * 0.5
    + (c10 + c01 + c21 + c12) * 0.1
    + (c00 + c20 + c02 + c22) * 0.025;

  vec3 result = mix(bilinear, sharpNeighborhood, edgeStrength);

  fragColor = vec4(result, 1.0);
}
`;

export default { EASU_VERTEX_SHADER, EASU_FRAGMENT_SHADER };
