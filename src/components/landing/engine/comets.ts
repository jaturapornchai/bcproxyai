// Real traffic only. Every comet is one PulseEvent: it leaves the core along a curved path to its provider's star
// (latency → travel time), then flares cyan (ok) or bursts red with a shockwave (failed); an event no provider could take
// fizzles red at the core. A polled batch is replayed with its real relative timing. Flight, trail and fade run on the
// GPU from a start time per pool slot; the CPU only launches, and fires arrivals. No per-frame allocation.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import type { PulseEvent } from "../types";
import type { Core } from "./core";
import { rng, type Shared } from "./galaxy";
import { BEZIER, OUT } from "./glsl";
import type { Stars } from "./stars";

export const COMETS = 256;
const SEG = 32;
const TAIL = 0.3;
/** seconds for the trail to drain into the star after arrival */
const FADE = 0.5;
const QUEUE = 512;
/** a batch spanning more seconds than this (first load: up to 100 past events) is compressed into it */
const MAX_SPAN = 14;
/** a queue running further behind than this (tab was hidden) is dropped for the newest batch */
const MAX_BACKLOG = 20;
const BATCH_MAX = 60;
const MIN_GAP = 0.08;
const BURSTS = 32;
const SPARKS = 18;

/** Shared easing of the comet head: accelerates out of the core, decelerates into the star. */
export const cease = (k: number) => k * k * (3 - 2 * k) * 0.45 + k * 0.55;
const CEASE = /* glsl */ `float cease(float k) { return k * k * (3.0 - 2.0 * k) * 0.45 + k * 0.55; }`;

/** Comet head at flight progress k (0..1), disk frame: quadratic bezier core (origin) → ctrl → target. */
export function cometPoint(ctrl: Vector3, target: Vector3, k: number, out: Vector3): Vector3 {
  const e = cease(Math.min(1, Math.max(0, k)));
  return out.copy(ctrl).multiplyScalar(2 * (1 - e) * e).addScaledVector(target, e * e);
}

/** ctrl / target are reused vectors: copy them. */
export type LaunchFn = (slot: number, ok: boolean, start: number, dur: number, ctrl: Vector3, target: Vector3) => void;

// iA = control point xyz + start time; iB = target xyz + duration (negative = failed request)
const RIBBON_VERT = /* glsl */ `
attribute vec4 iA, iB;
uniform float uTime, uScale, uPx;
varying float vU, vSide, vFail, vK, vFade;
${BEZIER}
${CEASE}
void main() {
  float dur = abs(iB.w);
  float age = uTime - iA.w;
  if (dur < 1e-3 || age < 0.0 || age > dur + ${FADE}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = min(age / dur, 1.0);
  float head = cease(k);
  float after = max(age - dur, 0.0) / ${FADE};
  float tail = mix(max(head - ${TAIL}, 0.0), 1.0, after);
  float s = mix(tail, head, position.x);
  vec4 mv = modelViewMatrix * vec4(bez(vec3(0.0), iA.xyz, iB.xyz, s), 1.0);
  vec3 d = mat3(modelViewMatrix) * (2.0 * (1.0 - 2.0 * s) * iA.xyz + 2.0 * s * iB.xyz);
  vec2 dir = normalize(d.xy + vec2(1e-5, 0.0));
  float w = 0.22 * pow(position.x, 1.2);
  w = max(w, position.x * 1.6 * uPx * max(-mv.z, 0.1) / uScale); // head end stays >= ~1.6 px wide however far
  mv.xy += vec2(-dir.y, dir.x) * position.y * w;
  gl_Position = projectionMatrix * mv;
  vU = position.x;
  vSide = position.y;
  vFail = iB.w < 0.0 ? 1.0 : 0.0;
  vK = k;
  vFade = 1.0 - after;
}`;

const RIBBON_FRAG = /* glsl */ `
varying float vU, vSide, vFail, vK, vFade;
void main() {
  float prof = exp(-vSide * vSide * 3.0);
  float core = exp(-vSide * vSide * 14.0);
  vec3 c = mix(vec3(0.35, 0.85, 1.0), vec3(1.0, 0.25, 0.12), vFail * smoothstep(0.15, 0.85, vK));
  float along = pow(vU, 1.6);
  vec3 col = mix(c, vec3(1.0), core * 0.6 * along) * (prof * 0.8 + core * 1.6) * along * vFade * 2.0;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

const HEAD_VERT = /* glsl */ `
attribute vec4 iA, iB;
uniform float uTime, uScale, uPx;
varying vec2 vUv;
varying float vFail, vK;
${BEZIER}
${CEASE}
void main() {
  float dur = abs(iB.w);
  float age = uTime - iA.w;
  if (dur < 1e-3 || age < 0.0 || age > dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vK = age / dur;
  vec4 mv = modelViewMatrix * vec4(bez(vec3(0.0), iA.xyz, iB.xyz, cease(vK)), 1.0);
  float r = max(0.45, 7.0 * uPx * max(-mv.z, 0.1) / uScale);
  mv.xy += position.xy * r;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vFail = iB.w < 0.0 ? 1.0 : 0.0;
}`;

const HEAD_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFail, vK;
void main() {
  float r2 = dot(vUv, vUv);
  vec3 c = mix(vec3(0.45, 0.9, 1.0), vec3(1.0, 0.25, 0.12), vFail * smoothstep(0.15, 0.85, vK));
  float g = exp(-r2 * 30.0) * 2.5 + exp(-r2 * 5.0) * 0.6;
  vec3 col = mix(c, vec3(1.0), exp(-r2 * 40.0) * 0.8) * g * smoothstep(0.0, 0.08, vK);
  gl_FragColor = vec4(col * (1.0 - smoothstep(0.7, 1.0, sqrt(r2))), 1.0);
  ${OUT}
}`;

const SPARK_VERT = /* glsl */ `
attribute vec3 aVel, aCol;
attribute vec2 aLife; // start, duration
uniform float uTime, uPx;
varying float vK;
varying vec3 vCol;
void main() {
  float age = uTime - aLife.x;
  float k = age / aLife.y;
  if (age < 0.0 || k > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec4 mv = modelViewMatrix * vec4(position + aVel * (1.0 - exp(-age * 2.8)) / 2.8, 1.0);
  gl_PointSize = (3.0 + 5.0 * (1.0 - k)) * uPx * clamp(30.0 / -mv.z, 0.5, 3.0);
  vK = k;
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}`;

const SPARK_FRAG = /* glsl */ `
varying float vK;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 18.0);
  vec3 hot = mix(vec3(1.0, 0.95, 0.85), vCol, smoothstep(0.0, 0.3, vK));
  gl_FragColor = vec4(hot * a * (1.0 - vK) * (1.0 - vK) * 3.0, 1.0);
  ${OUT}
}`;

const tCtrl = new Vector3();
const tTarget = new Vector3();
const eventMs = (e: PulseEvent) => {
  const v = Date.parse(e.t);
  return Number.isFinite(v) ? v : 0;
};

export class Comets {
  readonly group = new Group();
  private readonly rand = rng(99);
  private seen = new Set<string>();
  private readonly attrA = new InstancedBufferAttribute(new Float32Array(COMETS * 4), 4).setUsage(DynamicDrawUsage);
  private readonly attrB = new InstancedBufferAttribute(new Float32Array(COMETS * 4), 4).setUsage(DynamicDrawUsage);
  private readonly arriveAt = new Float64Array(COMETS).fill(Infinity);
  private readonly cSlot = new Int16Array(COMETS);
  private readonly cOk = new Uint8Array(COMETS);
  private head = 0;
  // pending events (ring, sorted by play time on the engine clock)
  private readonly qAt = new Float64Array(QUEUE);
  private readonly qStar: string[] = new Array(QUEUE).fill("");
  private readonly qOk = new Uint8Array(QUEUE);
  private readonly qLat = new Float32Array(QUEUE);
  private qHead = 0;
  private qCount = 0;
  private qLast = -Infinity;
  // sparks
  private readonly sPos = new BufferAttribute(new Float32Array(BURSTS * SPARKS * 3), 3).setUsage(DynamicDrawUsage);
  private readonly sVel = new BufferAttribute(new Float32Array(BURSTS * SPARKS * 3), 3).setUsage(DynamicDrawUsage);
  private readonly sCol = new BufferAttribute(new Float32Array(BURSTS * SPARKS * 3), 3).setUsage(DynamicDrawUsage);
  private readonly sLife = new BufferAttribute(new Float32Array(BURSTS * SPARKS * 2), 2).setUsage(DynamicDrawUsage);
  private bHead = 0;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    shared: Shared,
    private readonly stars: Stars,
    private readonly core: Core,
    private readonly onLaunch: LaunchFn,
  ) {
    const a = this.attrA.array as Float32Array;
    for (let i = 0; i < COMETS; i++) a[i * 4 + 3] = -1e6; // long expired: the pool starts invisible
    const life = this.sLife.array as Float32Array;
    for (let i = 0; i < BURSTS * SPARKS; i++) {
      life[i * 2] = -1e6;
      life[i * 2 + 1] = 1; // 0 would make age / life NaN
    }
    const uniforms = { uTime: shared.uTime, uScale: shared.uScale, uPx: shared.uPx };
    // DoubleSide: the ribbon is offset along a screen-space normal, so its winding flips with the direction of travel
    const additive = { blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide } as const;

    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) verts.push(i / SEG, -1, 0, i / SEG, 1, 0);
    for (let i = 0; i < SEG; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 2, 2 * i + 1, 2 * i + 3);
    const ribbonGeo = this.instanced(new Float32Array(verts), idx);
    const ribbonMat = new ShaderMaterial({ uniforms, vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, ...additive });
    const ribbons = new Mesh(ribbonGeo, ribbonMat);

    const headGeo = this.instanced(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), [0, 1, 2, 2, 1, 3]);
    const headMat = new ShaderMaterial({ uniforms, vertexShader: HEAD_VERT, fragmentShader: HEAD_FRAG, ...additive });
    const heads = new Mesh(headGeo, headMat);

    const sparkGeo = new BufferGeometry();
    sparkGeo.setAttribute("position", this.sPos);
    sparkGeo.setAttribute("aVel", this.sVel);
    sparkGeo.setAttribute("aCol", this.sCol);
    sparkGeo.setAttribute("aLife", this.sLife);
    const sparkMat = new ShaderMaterial({ uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, ...additive });
    const sparks = new Points(sparkGeo, sparkMat);

    ribbons.renderOrder = 9;
    heads.renderOrder = 10;
    sparks.renderOrder = 11;
    for (const m of [ribbons, heads, sparks]) m.frustumCulled = false;
    this.group.add(ribbons, heads, sparks);
    this.disposables.push(ribbonGeo, ribbonMat, headGeo, headMat, sparkGeo, sparkMat);
  }

  private instanced(pos: Float32Array, index: number[]): InstancedBufferGeometry {
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setIndex(index);
    g.setAttribute("iA", this.attrA);
    g.setAttribute("iB", this.attrB);
    g.instanceCount = COMETS;
    return g;
  }

  /**
   * New events (deduped by id) are queued at their real relative timing, starting now or right after what is already
   * queued. `now` is the engine clock.
   */
  push(events: PulseEvent[], now: number): void {
    let fresh: PulseEvent[] = [];
    for (const e of Array.isArray(events) ? events : []) {
      if (!e || typeof e.id !== "string" || this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      fresh.push(e);
    }
    if (this.seen.size > 4000) this.seen = new Set([...this.seen].slice(-2000));
    if (!fresh.length) return;
    fresh = fresh.sort((a, b) => eventMs(a) - eventMs(b)).slice(-BATCH_MAX);
    const t0 = eventMs(fresh[0]);
    const span = (eventMs(fresh[fresh.length - 1]) - t0) / 1000;
    const scale = span > MAX_SPAN ? MAX_SPAN / span : 1;
    let start = Math.max(now, this.qLast + MIN_GAP);
    if (start - now > MAX_BACKLOG) {
      this.qCount = 0;
      start = now;
    }
    let prev = -Infinity;
    for (const e of fresh) {
      const at = Math.max(start + ((eventMs(e) - t0) / 1000) * scale, prev + MIN_GAP);
      prev = at;
      if (this.qCount === QUEUE) {
        this.qHead = (this.qHead + 1) % QUEUE;
        this.qCount--;
      }
      const i = (this.qHead + this.qCount++) % QUEUE;
      this.qAt[i] = at;
      this.qStar[i] = typeof e.star === "string" ? e.star : "";
      this.qOk[i] = e.ok === true ? 1 : 0;
      this.qLat[i] = Number.isFinite(e.latencyMs) ? e.latencyMs : 1000;
    }
    this.qLast = prev;
  }

  update(t: number): void {
    while (this.qCount > 0 && this.qAt[this.qHead] <= t) {
      const i = this.qHead;
      this.qHead = (i + 1) % QUEUE;
      this.qCount--;
      this.launch(i, t);
    }
    for (let i = 0; i < COMETS; i++) {
      if (this.arriveAt[i] > t) continue;
      this.arriveAt[i] = Infinity;
      const s = this.cSlot[i];
      if (!this.stars.alive(s)) continue;
      const ok = this.cOk[i] === 1;
      this.stars.arrive(s, ok, t);
      const p = this.stars.local;
      if (ok) this.burst(p[s * 3], p[s * 3 + 1], p[s * 3 + 2], 0.4, 0.9, 1.0, 10, 1.4, t);
      else this.burst(p[s * 3], p[s * 3 + 1], p[s * 3 + 2], 1.0, 0.22, 0.1, SPARKS, 2.6, t);
    }
  }

  private launch(q: number, t: number): void {
    const id = this.qStar[q];
    if (!id) {
      this.core.fizzle(t);
      this.burst(0, 0.3, 0, 1.0, 0.22, 0.1, SPARKS, 4, t);
      return;
    }
    this.core.pulse(t);
    const slot = this.stars.slotOf(id);
    if (!this.stars.alive(slot)) return; // star not (or no longer) on the map: the core still pulsed
    const ok = this.qOk[q] === 1;
    const dur = Math.min(4, Math.max(1.2, 0.9 + this.qLat[q] * 0.0006));
    tTarget.fromArray(this.stars.local, slot * 3);
    const len = tTarget.length() || 1;
    // bow sideways (mostly along the rotation) and lift off the disk
    const side = this.rand() < 0.7 ? 1 : -1;
    tCtrl.set(-tTarget.z / len, 0, tTarget.x / len).multiplyScalar(len * 0.3 * side).addScaledVector(tTarget, 0.5);
    tCtrl.y += len * (0.12 + 0.12 * this.rand());
    const c = this.head;
    this.head = (c + 1) % COMETS;
    const a = this.attrA.array as Float32Array;
    const b = this.attrB.array as Float32Array;
    tCtrl.toArray(a, c * 4);
    a[c * 4 + 3] = t;
    tTarget.toArray(b, c * 4);
    b[c * 4 + 3] = ok ? dur : -dur;
    this.attrA.needsUpdate = this.attrB.needsUpdate = true;
    this.arriveAt[c] = t + dur;
    this.cSlot[c] = slot;
    this.cOk[c] = ok ? 1 : 0;
    this.onLaunch(slot, ok, t, dur, tCtrl, tTarget);
  }

  private burst(x: number, y: number, z: number, r: number, g: number, b: number, count: number, speed: number, t: number): void {
    const base = this.bHead * SPARKS;
    this.bHead = (this.bHead + 1) % BURSTS;
    const pos = this.sPos.array as Float32Array;
    const vel = this.sVel.array as Float32Array;
    const col = this.sCol.array as Float32Array;
    const life = this.sLife.array as Float32Array;
    for (let i = 0; i < SPARKS; i++) {
      const o = base + i;
      const zz = 2 * this.rand() - 1;
      const a = this.rand() * Math.PI * 2;
      const s = Math.sqrt(1 - zz * zz);
      const v = speed * (0.5 + this.rand());
      pos[o * 3] = x;
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = z;
      vel[o * 3] = s * Math.cos(a) * v;
      vel[o * 3 + 1] = zz * v;
      vel[o * 3 + 2] = s * Math.sin(a) * v;
      col[o * 3] = r;
      col[o * 3 + 1] = g;
      col[o * 3 + 2] = b;
      life[o * 2] = i < count ? t : -1e6;
      life[o * 2 + 1] = 0.6 + this.rand() * 0.5;
    }
    this.sPos.needsUpdate = this.sVel.needsUpdate = this.sCol.needsUpdate = this.sLife.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
