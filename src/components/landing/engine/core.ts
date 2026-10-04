// The router: a supermassive core at the galactic centre. White-hot glow, a differentially rotating accretion disk, and
// a ripple across the disk plane on every real event; a request no provider could take flashes it red.
import { AdditiveBlending, DoubleSide, Group, Mesh, PlaneGeometry, RingGeometry, ShaderMaterial } from "three";
import type { Shared } from "./galaxy";
import { NOISE, OUT } from "./glsl";

const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uTime, uPulse, uFizzT;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  float fz = clamp(1.0 - (uTime - uFizzT) / 0.9, 0.0, 1.0);
  fz *= fz;
  float hot = exp(-r2 * 260.0) * 6.0 + exp(-r2 * 40.0) * 1.1;
  float halo = exp(-r2 * 9.0) * 0.32 + 0.025 / (1.0 + r2 * 60.0);
  vec3 col = vec3(1.0, 0.97, 0.92) * hot * (1.0 + 1.2 * uPulse) + vec3(0.78, 0.62, 0.8) * halo * (1.0 + 1.6 * uPulse);
  col = mix(col, vec3(1.0, 0.16, 0.08) * (hot * 1.5 + halo * 4.0), fz);
  gl_FragColor = vec4(col * (1.0 - smoothstep(0.75, 1.0, sqrt(r2))), 1.0);
  ${OUT}
}`;

const PLANE_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DISK_FRAG = /* glsl */ `
uniform float uTime, uPulse;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  float spin = atan(vP.y, vP.x) - uTime * 1.6 / pow(r, 1.5); // Keplerian shear winds the noise into streaks
  vec2 q = vec2(cos(spin), sin(spin)) * r;
  float band = 0.5 + 0.9 * fbm(vec3(q * 2.4, r * 3.0), 3.0);
  float edge = smoothstep(0.32, 0.5, r) * (1.0 - smoothstep(1.1, 2.2, r));
  vec3 col = mix(vec3(1.0, 0.45, 0.16), vec3(1.0, 0.92, 0.8), exp(-(r - 0.4) * 1.8));
  gl_FragColor = vec4(col * edge * band * (0.9 + 1.4 * uPulse) * (1.1 / (r + 0.3)), 1.0);
  ${OUT}
}`;

// cyan ring per real event; a red, slower one when routing found no provider (the bulge would swallow a red glow)
const RIPPLE_FRAG = /* glsl */ `
uniform float uTime, uPulseT, uFizzT;
varying vec2 vP;
float ring(float r, float age, float speed, float life) {
  float x = (r - 1.0 - age * speed) * 1.2;
  return age >= 0.0 && age < life ? exp(-x * x) * (1.0 - age / life) : 0.0;
}
void main() {
  float r = length(vP);
  vec3 col = vec3(0.55, 0.85, 1.0) * ring(r, uTime - uPulseT, 10.0, 1.4) * 0.45;
  col += vec3(1.0, 0.2, 0.1) * ring(r, uTime - uFizzT, 8.0, 1.6) * 1.2;
  gl_FragColor = vec4(col * (1.0 - smoothstep(10.0, 14.0, r)), 1.0);
  ${OUT}
}`;

export interface Core {
  group: Group;
  /** a real event went out: brighten + ripple */
  pulse(t: number): void;
  /** routing found no provider */
  fizzle(t: number): void;
  update(rdt: number): void;
  dispose(): void;
}

export function createCore(shared: Shared): Core {
  const group = new Group();
  const live = { uPulse: { value: 0 }, uPulseT: { value: -1e6 }, uFizzT: { value: -1e6 } };
  const additive = { blending: AdditiveBlending, transparent: true, depthWrite: false } as const;

  const glowGeo = new PlaneGeometry(2, 2);
  const glowMat = new ShaderMaterial({ uniforms: { uSize: { value: 6 }, uTime: shared.uTime, ...live }, vertexShader: BILLBOARD_VERT, fragmentShader: GLOW_FRAG, ...additive });
  const glow = new Mesh(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.renderOrder = 7;

  const diskGeo = new RingGeometry(0.32, 2.2, 128, 4).rotateX(-Math.PI / 2);
  const diskMat = new ShaderMaterial({ uniforms: { uTime: shared.uTime, ...live }, vertexShader: PLANE_VERT, fragmentShader: DISK_FRAG, side: DoubleSide, ...additive });
  const disk = new Mesh(diskGeo, diskMat);
  disk.rotation.z = 0.22;
  disk.renderOrder = 6;

  const rippleGeo = new PlaneGeometry(28, 28).rotateX(-Math.PI / 2);
  const rippleMat = new ShaderMaterial({ uniforms: { uTime: shared.uTime, ...live }, vertexShader: PLANE_VERT, fragmentShader: RIPPLE_FRAG, side: DoubleSide, ...additive });
  const ripple = new Mesh(rippleGeo, rippleMat);
  ripple.renderOrder = 5;

  group.add(ripple, disk, glow);

  return {
    group,
    pulse(t) {
      live.uPulse.value = Math.min(1.6, live.uPulse.value + 0.6);
      live.uPulseT.value = t;
    },
    fizzle(t) {
      live.uFizzT.value = t;
    },
    update(rdt) {
      live.uPulse.value *= Math.exp(-rdt * 2.2);
    },
    dispose() {
      for (const g of [glowGeo, diskGeo, rippleGeo]) g.dispose();
      for (const m of [glowMat, diskMat, rippleMat]) m.dispose();
    },
  };
}
