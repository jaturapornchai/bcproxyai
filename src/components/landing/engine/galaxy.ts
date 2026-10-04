// Milky Way style barred spiral. Stars ride density-wave orbits: each keeps its own angular speed (falling with radius)
// but bunches up while it crosses an arm, so the arm pattern turns rigidly at OMEGA_P and never winds up. Everything but
// the sky lives in the engine's disk group, which rotates at that pattern speed: in the disk frame the arms are fixed,
// so provider stars placed on them stay on them.
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  Group,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  type Camera,
} from "three";
import { NOISE, OUT } from "./glsl";
import type { TierSpec } from "./quality";

export interface Shared {
  /** engine clock: real seconds while running (comets, flares, twinkle) */
  uTime: { value: number };
  /** galaxy rotation clock (slower under reduced motion) */
  uGal: { value: number };
  uPx: { value: number };
  /** device px per world unit at distance 1: drawing-buffer height / (2·tan(fov/2)) */
  uScale: { value: number };
}

export const GALAXY_R = 40;
export const BAR_R = 6;
const PITCH_K = 1 / Math.tan((19 * Math.PI) / 180);
const V0 = 0.8;
const RC = 3;
/** pattern speed (rad per galaxy-clock second): corotation at r = 24 */
export const OMEGA_P = V0 / (24 + RC);
const TAU = Math.PI * 2;

/** Arm crest angle at radius a in the disk frame (trailing log spiral off the bar ends; the twin arm is +π). Same as ARM_GLSL. */
export function armPhase(a: number): number {
  return -PITCH_K * Math.log(Math.max(a, BAR_R) / BAR_R) + 0.1 * Math.sin(a * 0.55 + 1.3) + 0.05 * Math.sin(a * 1.7);
}

/** Deterministic PRNG: every load draws the same galaxy. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n6 = (x: number) => x.toFixed(6);

const ARM_GLSL = /* glsl */ `
float armPhase(float a) {
  return -${n6(PITCH_K)} * log(max(a, ${n6(BAR_R)}) / ${n6(BAR_R)}) + 0.1 * sin(a * 0.55 + 1.3) + 0.05 * sin(a * 1.7);
}`;

// o = (guiding radius, start angle in the disk frame, height); shape = (arm count m, z squash, lane offset); k = arm
// affinity 0..1. The angle advances at (omega(a) - OMEGA_P) and is pulled toward the nearest crest, so the density of
// stars peaks there. crest = 1 on an arm, 0 between arms. The lane offset shifts the crest to the arm's inner (dust,
// > 0) or outer (young stars, < 0) edge.
const ORBIT_GLSL = /* glsl */ `
uniform float uGal;
${ARM_GLSL}
vec3 orbit(vec3 o, vec3 shape, float k, out float crest) {
  float a = o.x;
  float th = o.y + (${n6(V0)} / (a + ${n6(RC)}) - ${n6(OMEGA_P)}) * uGal;
  float d = shape.x * (th - armPhase(a + shape.z));
  crest = 0.5 + 0.5 * cos(d);
  th -= k / shape.x * sin(d);
  return vec3(a * cos(th), o.z, a * sin(th) * shape.y);
}`;

interface VertOpts {
  crestPow: number;
  maxPx: number;
  near: [number, number];
  twinkle: boolean;
}

/** aShape.w = world size; aCol = rgb (brightness folded in) + how much the point only lights up on an arm crest. */
function orbitVert(o: VertOpts): string {
  return /* glsl */ `
attribute vec4 aShape;
attribute vec4 aCol;
attribute float aK;
uniform float uTime, uPx, uScale;
varying vec3 vCol;
${ORBIT_GLSL}
void main() {
  float crest;
  vec3 p = orbit(position, aShape.xyz, aK, crest);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.05);
  float px = aShape.w * uScale / depth;
  float minPx = 1.3 * uPx;
  float light = mix(1.0, 0.2 + 1.6 * pow(crest, ${n6(o.crestPow)}), aCol.w);
  ${o.twinkle ? "float seed = fract(position.y * 7.31 + position.x * 3.17); light *= 0.82 + 0.18 * sin(uTime * (0.6 + 2.0 * seed) + seed * 40.0);" : ""}
  float dim = min(1.0, px / minPx); // sub-pixel points shrink in brightness instead of shimmering
  light *= dim * dim * smoothstep(${n6(o.near[0])}, ${n6(o.near[1])}, depth);
  vCol = aCol.rgb * light;
  gl_PointSize = clamp(px, minPx, ${n6(o.maxPx)} * uPx);
  gl_Position = projectionMatrix * mv;
}`;
}

const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 16.0);
  gl_FragColor = vec4(vCol * a, 1.0);
  ${OUT}
}`;

const KNOT_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 >= 1.0) discard;
  float a = exp(-r2 * 3.0) * (1.0 - r2) + exp(-r2 * 28.0) * 0.5;
  gl_FragColor = vec4(vCol * a, 1.0);
  ${OUT}
}`;

// dust absorbs: premultiplied "over" with a near-black tint darkens whatever the disk drew before it
const DUST_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 >= 1.0) discard;
  float a = (1.0 - r2) * (1.0 - r2) * min(vCol.r, 0.85);
  gl_FragColor = vec4(vec3(0.045, 0.028, 0.018) * a, a);
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// unresolved starlight: exponential disk lit along the arms, darker in the lanes, plus bar and bulge
const GLOW_FRAG = /* glsl */ `
uniform float uBright, uTime;
varying vec2 vP;
${NOISE}
${ARM_GLSL}
void main() {
  float r = length(vP);
  float phi = atan(vP.y, vP.x);
  float ph = phi - armPhase(r);
  float onDisk = smoothstep(${n6(BAR_R * 0.8)}, ${n6(BAR_R * 1.5)}, r);
  float arms = pow(0.5 + 0.5 * cos(2.0 * ph), 3.0) + 0.3 * pow(0.5 + 0.5 * cos(4.0 * ph), 4.0);
  float lane = pow(0.5 + 0.5 * cos(2.0 * (phi - armPhase(r + 1.0))), 24.0) * onDisk;
  float disk = exp(-r / 11.0) * (1.0 - smoothstep(${n6(GALAXY_R * 0.8)}, ${n6(GALAXY_R * 1.1)}, r));
  vec2 b = vec2(vP.x / ${n6(BAR_R)}, vP.y / ${n6(BAR_R * 0.33)});
  float bar = exp(-dot(b, b) * 1.4);
  float bulge = exp(-r * r / 9.0);
  vec3 warm = vec3(1.0, 0.76, 0.5);
  vec3 blue = vec3(0.5, 0.62, 1.0);
  vec3 col = mix(warm, blue, smoothstep(4.0, 26.0, r)) * disk * (0.3 + 0.9 * arms * onDisk) * (1.0 - 0.7 * lane);
  col += warm * (bar * 0.45 + bulge * 1.1);
  col *= uBright;
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) * 0.004; // dither: dark gradients band on 8-bit
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  ${OUT}
}`;

const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const BULGE_FRAG = /* glsl */ `
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  vec3 col = vec3(1.0, 0.74, 0.46) * (exp(-r2 * 7.0) * 0.5 + exp(-r2 * 30.0) * 0.6);
  gl_FragColor = vec4(col * (1.0 - smoothstep(0.7, 1.0, sqrt(r2))), 1.0);
  ${OUT}
}`;

const NEBULA_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NEBULA_FRAG = /* glsl */ `
uniform float uTime, uOct;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float t = uTime * 0.008;
  vec3 q = d * 1.7 + vec3(t, -t * 0.7, t * 0.4);
  float warp = fbm(q * 0.7 + vec3(5.2, 1.3, 8.1), uOct);
  float n1 = fbm(q + warp * 1.7, uOct);
  float n2 = fbm(q * 1.9 - warp * 1.2 + 11.7, uOct);
  float cloud = smoothstep(0.42, 0.82, n1);
  float wisp = smoothstep(0.52, 0.88, n2);
  vec3 col = vec3(0.002, 0.0028, 0.008);
  col += vec3(0.22, 0.09, 0.6) * cloud * 0.13;
  col += vec3(0.04, 0.34, 0.62) * wisp * 0.06 * (1.0 - cloud * 0.5);
  col += vec3(0.9, 0.2, 0.55) * pow(cloud, 3.0) * 0.025;
  col += (hash13(vec3(gl_FragCoord.xy, uTime)) - 0.5) * 0.004;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  ${OUT}
}`;

const SKY_VERT = /* glsl */ `
attribute float aSeed, aSize;
attribute vec3 aCol;
uniform float uTime, uPx;
varying vec3 vCol;
void main() {
  vCol = aCol * (0.75 + 0.25 * sin(uTime * (0.4 + aSeed * 1.6) + aSeed * 57.0));
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_TINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.65, 0.78, 1.0],
  [1.0, 0.96, 0.9],
  [1.0, 0.8, 0.6],
  [0.8, 0.7, 1.0],
];

/** Struct-of-arrays for one orbiting point cloud. */
class Cloud {
  readonly orbit: Float32Array;
  readonly shape: Float32Array;
  readonly col: Float32Array;
  readonly k: Float32Array;
  n = 0;

  constructor(readonly cap: number) {
    this.orbit = new Float32Array(cap * 3);
    this.shape = new Float32Array(cap * 4);
    this.col = new Float32Array(cap * 4);
    this.k = new Float32Array(cap);
  }

  add(a: number, th: number, h: number, k: number, m: number, squash: number, lane: number, size: number, r: number, g: number, b: number, armLight: number): void {
    const i = this.n++;
    this.orbit.set([a, th, h], i * 3);
    this.shape.set([m, squash, lane, size], i * 4);
    this.col.set([r, g, b, armLight], i * 4);
    this.k[i] = k;
  }

  points(material: ShaderMaterial, renderOrder: number): Points {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.orbit, 3));
    g.setAttribute("aShape", new BufferAttribute(this.shape, 4));
    g.setAttribute("aCol", new BufferAttribute(this.col, 4));
    g.setAttribute("aK", new BufferAttribute(this.k, 1));
    const p = new Points(g, material);
    p.frustumCulled = false;
    p.renderOrder = renderOrder;
    return p;
  }
}

function gauss(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(TAU * rand());
}

/** Exponential-disk radius (scale length `scale`) truncated to [lo, hi]. */
function diskR(rand: () => number, scale: number, lo: number, hi: number): number {
  return lo - scale * Math.log(1 - rand() * (1 - Math.exp(-(hi - lo) / scale)));
}

/** Components are interleaved at random, so a draw-range prefix (governor downgrade) keeps the same mix. */
function buildStars(n: number, rand: () => number): Cloud {
  const c = new Cloud(n);
  while (c.n < n) {
    const x = rand();
    if (x < 0.13) {
      // bulge: flattened gaussian
      const px = gauss(rand) * 2.6;
      const pz = gauss(rand) * 2.6;
      const b = 0.25 + 0.5 * rand() ** 2;
      c.add(Math.hypot(px, pz) + 0.05, Math.atan2(pz, px), gauss(rand) * 1.5, 0, 2, 1, 0, 0.07 + 0.05 * rand(), b, 0.76 * b, 0.5 * b, 0);
    } else if (x < 0.2) {
      // bar: orbits squashed along the disk-frame x axis, the arms leave from its ends
      const b = 0.3 + 0.55 * rand() ** 2;
      c.add(BAR_R * 1.05 * Math.sqrt(rand()), rand() * TAU, gauss(rand) * 0.45, 0, 2, 0.32, 0, 0.07 + 0.04 * rand(), b, 0.82 * b, 0.58 * b, 0);
    } else if (x < 0.24) {
      // halo
      const b = 0.12 + 0.2 * rand();
      c.add(3 + 52 * rand() ** 1.6, rand() * TAU, gauss(rand) * 13, 0, 2, 1, 0, 0.08, 0.75 * b, 0.78 * b, 0.95 * b, 0);
    } else if (x < 0.3) {
      // young blue cluster riding just downstream of an arm
      const a0 = diskR(rand, 12, BAR_R * 1.3, GALAXY_R);
      const th0 = rand() * TAU;
      const k = 0.7 + 0.15 * rand();
      const m = rand() < 0.8 ? 2 : 4;
      const members = 8 + Math.floor(rand() * 22);
      for (let j = 0; j < members && c.n < n; j++) {
        const b = 0.7 + 1.7 * rand() ** 3;
        c.add(a0 + gauss(rand) * 0.45, th0 + (gauss(rand) * 0.45) / a0, gauss(rand) * 0.12, k, m, 1, -0.6, 0.09 + 0.09 * rand(), 0.55 * b, 0.72 * b, b, 0.9);
      }
    } else {
      // disk: old stars barely feel the arms, arm stars bunch on them
      const a = diskR(rand, 11, BAR_R * 0.75, GALAXY_R * 1.08);
      const old = rand() < 0.45;
      const k = a < BAR_R ? 0 : old ? 0.15 + 0.2 * rand() : 0.45 + 0.3 * rand();
      const m = rand() < 0.72 ? 2 : 4;
      const b = (old ? 0.22 : 0.3) + 0.6 * rand() ** 2;
      const h = gauss(rand) * (old ? 0.5 : 0.28) * (0.6 + a / 30);
      if (old) c.add(a, rand() * TAU, h, k, m, 1, 0, 0.06 + 0.04 * rand(), b, 0.88 * b, 0.74 * b, 0.15);
      else c.add(a, rand() * TAU, h, k, m, 1, 0, 0.06 + 0.05 * rand(), 0.82 * b, 0.88 * b, b, 0.3);
    }
  }
  return c;
}

function buildKnots(n: number, rand: () => number): Cloud {
  const c = new Cloud(n);
  for (let i = 0; i < n; i++) {
    const a = diskR(rand, 12, BAR_R * 1.4, GALAXY_R * 0.95);
    const k = 0.88 + 0.08 * rand();
    const m = rand() < 0.8 ? 2 : 4;
    const size = 0.6 + 0.9 * rand();
    const b = 0.2 + 0.3 * rand();
    // mostly pink HII, a few blue reflection nebulae
    if (rand() < 0.85) c.add(a, rand() * TAU, gauss(rand) * 0.15, k, m, 1, -0.7, size, b, 0.3 * b, 0.55 * b, 1);
    else c.add(a, rand() * TAU, gauss(rand) * 0.15, k, m, 1, -0.5, size * 0.8, 0.35 * b, 0.55 * b, b, 1);
  }
  return c;
}

function buildDust(n: number, rand: () => number): Cloud {
  const c = new Cloud(n);
  for (let i = 0; i < n; i++) {
    const a = diskR(rand, 13, BAR_R * 1.1, GALAXY_R * 0.95);
    const k = 0.86 + 0.1 * rand();
    const m = rand() < 0.85 ? 2 : 4;
    c.add(a, rand() * TAU, gauss(rand) * 0.1, k, m, 1, 1.0, 1.6 + 1.8 * rand(), 0.45 + 0.4 * rand(), 0, 0, 1);
  }
  return c;
}

function buildSky(n: number, rand: () => number, material: ShaderMaterial): Points {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = 2 * rand() - 1;
    const a = rand() * TAU;
    const s = Math.sqrt(1 - z * z);
    const r = 900 + 500 * rand();
    pos.set([r * s * Math.cos(a), r * z, r * s * Math.sin(a)], i * 3);
    const tint = SKY_TINTS[Math.floor(rand() * SKY_TINTS.length)];
    const hot = rand() < 0.03;
    const k = hot ? 1.4 + rand() : 0.25 + 0.55 * rand();
    col.set([tint[0] * k, tint[1] * k, tint[2] * k], i * 3);
    seed[i] = rand();
    size[i] = hot ? 2.6 : 1 + 1.2 * rand();
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aCol", new BufferAttribute(col, 3));
  g.setAttribute("aSeed", new BufferAttribute(seed, 1));
  g.setAttribute("aSize", new BufferAttribute(size, 1));
  const p = new Points(g, material);
  p.frustumCulled = false;
  p.renderOrder = -9;
  return p;
}

export interface Galaxy {
  /** goes inside the engine's rotating disk group */
  disk: Group;
  /** nebula dome + far stars: follows the camera (at infinity, no parallax) */
  sky: Group;
  update(camera: Camera): void;
  setTier(spec: TierSpec): void;
  dispose(): void;
}

export function buildGalaxy(shared: Shared, spec: TierSpec): Galaxy {
  const rand = rng(7);
  const disk = new Group();
  const sky = new Group();
  const additive = { blending: AdditiveBlending, transparent: true, depthWrite: false } as const;
  const pointUniforms = { uTime: shared.uTime, uGal: shared.uGal, uPx: shared.uPx, uScale: shared.uScale };

  const glowGeo = new PlaneGeometry(GALAXY_R * 2.3, GALAXY_R * 2.3).rotateX(-Math.PI / 2);
  const glowMat = new ShaderMaterial({ uniforms: { uBright: { value: 0.2 }, uTime: shared.uTime }, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, side: DoubleSide, ...additive });
  const glow = new Mesh(glowGeo, glowMat);
  glow.renderOrder = 0;

  const starMat = new ShaderMaterial({ uniforms: pointUniforms, vertexShader: orbitVert({ crestPow: 3, maxPx: 9, near: [0.4, 2], twinkle: true }), fragmentShader: STAR_FRAG, ...additive });
  const stars = buildStars(spec.stars, rand).points(starMat, 1);

  const dustMat = new ShaderMaterial({
    uniforms: pointUniforms,
    vertexShader: orbitVert({ crestPow: 3, maxPx: 300, near: [2, 9], twinkle: false }),
    fragmentShader: DUST_FRAG,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    transparent: true,
    depthWrite: false,
  });
  const dust = buildDust(spec.dust, rand).points(dustMat, 2);

  const knotMat = new ShaderMaterial({ uniforms: pointUniforms, vertexShader: orbitVert({ crestPow: 10, maxPx: 260, near: [2, 8], twinkle: false }), fragmentShader: KNOT_FRAG, ...additive });
  const knots = buildKnots(spec.knots, rand).points(knotMat, 3);

  const bulgeGeo = new PlaneGeometry(2, 2);
  const bulgeMat = new ShaderMaterial({ uniforms: { uSize: { value: 11 } }, vertexShader: BILLBOARD_VERT, fragmentShader: BULGE_FRAG, ...additive });
  const bulge = new Mesh(bulgeGeo, bulgeMat);
  bulge.frustumCulled = false;
  bulge.renderOrder = 4;
  disk.add(glow, stars, dust, knots, bulge);

  const nebulaGeo = new SphereGeometry(1500, 48, 24);
  const nebulaMat = new ShaderMaterial({
    uniforms: { uTime: shared.uTime, uOct: { value: spec.nebulaOctaves } },
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const nebula = new Mesh(nebulaGeo, nebulaMat);
  nebula.renderOrder = -10;
  nebula.frustumCulled = false;
  const skyMat = new ShaderMaterial({ uniforms: { uTime: shared.uTime, uPx: shared.uPx }, vertexShader: SKY_VERT, fragmentShader: STAR_FRAG, ...additive, depthTest: false });
  const skyStars = buildSky(spec.sky, rand, skyMat);
  sky.add(nebula, skyStars);

  return {
    disk,
    sky,
    update(camera) {
      sky.position.copy(camera.position);
    },
    setTier(s) {
      nebulaMat.uniforms.uOct.value = s.nebulaOctaves;
      stars.geometry.setDrawRange(0, Math.min(s.stars, spec.stars));
      dust.geometry.setDrawRange(0, Math.min(s.dust, spec.dust));
      knots.geometry.setDrawRange(0, Math.min(s.knots, spec.knots));
      skyStars.geometry.setDrawRange(0, Math.min(s.sky, spec.sky));
    },
    dispose() {
      for (const g of [glowGeo, stars.geometry, dust.geometry, knots.geometry, bulgeGeo, nebulaGeo, skyStars.geometry]) g.dispose();
      for (const m of [glowMat, starMat, dustMat, knotMat, bulgeMat, nebulaMat, skyMat]) m.dispose();
    },
  };
}
