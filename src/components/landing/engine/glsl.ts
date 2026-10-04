// Shared GLSL chunks. Every custom material ends with OUT so it is correct both under the HDR composer (linear, no-op)
// and in the no-composer fallback (renderer ACES tone mapping + sRGB output).
export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm(vec3 p, float oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= oct) break;
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`;

export const OUT = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

/** Quadratic bezier shared by packets and arcs (b = control point). */
export const BEZIER = /* glsl */ `
vec3 bez(vec3 a, vec3 b, vec3 c, float t) {
  float u = 1.0 - t;
  return u * u * a + 2.0 * u * t * b + t * t * c;
}
`;
