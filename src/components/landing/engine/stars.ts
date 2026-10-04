// Provider star systems: one bright star per PulseStar, placed deterministically on a spiral arm by hashing its id.
// One billboard shader carries the look: white-hot core, colour halo, diffraction spikes, the success flare and the
// failure burst + shockwave ring (both timed on the GPU from a single timestamp). Glass labels exist only when asked for.
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Ray,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { providerColor } from "../palette";
import type { ProviderStatus, PulseStar } from "../types";
import { armPhase, rng, type Shared } from "./galaxy";
import { OUT } from "./glsl";

export const MAX_STARS = 48;
/** billboard half-size in star radii: room for the spikes and the shockwave ring */
const QUAD = 7;
const MIN_SEP = 3.4;

const STAR_VERT = /* glsl */ `
attribute vec4 iPS, iCol, iFx, iMisc;
uniform float uScale, uPx;
varying vec2 vUv;
varying vec4 vCol, vFx, vMisc;
void main() {
  vCol = iCol;
  vFx = iFx;
  vMisc = iMisc;
  vUv = position.xy * ${QUAD}.0;
  if (iFx.w < 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 mv = modelViewMatrix * vec4(iPS.xyz, 1.0);
  float r = iPS.w * (1.0 + 0.4 * iFx.x);
  r *= max(1.0, 2.6 * uPx / (r * uScale / max(-mv.z, 0.1))); // never below ~2.6 css px of core radius
  mv.xy += position.xy * r * ${QUAD}.0;
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol, vFx, vMisc;
void main() {
  float r = length(vUv);
  float okAge = uTime - vFx.y;
  float failAge = uTime - vFx.z;
  float flare = okAge >= 0.0 ? exp(-okAge * 2.6) : 0.0;
  float burst = failAge >= 0.0 ? exp(-failAge * 2.2) : 0.0;
  float flick = mix(1.0, 0.5 + 0.5 * abs(sin(uTime * 8.0 + vMisc.y * 7.0) * sin(uTime * 3.1 + vMisc.y * 3.0)), vMisc.x);
  float b = vCol.a * flick * (1.0 + 0.7 * vFx.x);
  vec3 c = vCol.rgb;
  float core = exp(-r * r * 2.0);
  float halo = exp(-r * 1.6) * 0.35 + 0.015 / (1.0 + r * r);
  vec2 q = abs(vUv);
  float spikes = (exp(-q.x * 10.0) * exp(-q.y * 0.6) + exp(-q.y * 10.0) * exp(-q.x * 0.6)) * 0.5;
  vec3 col = (mix(c, vec3(1.0), 0.65) * core * 2.4 + c * (halo + spikes * (0.5 + 0.4 * vFx.x))) * b;
  col += vec3(0.55, 0.92, 1.0) * flare * (exp(-r * r * 0.22) * 3.0 + spikes * 3.0);
  col += vec3(1.0, 0.2, 0.1) * burst * exp(-r * r * 0.3) * 3.0;
  float x = (r - 1.0 - failAge * 5.0) * 2.2;
  col += vec3(1.0, 0.38, 0.22) * (failAge >= 0.0 && failAge < 1.1 ? exp(-x * x) * (1.0 - failAge / 1.1) * 2.2 : 0.0);
  col *= (1.0 - smoothstep(${QUAD - 1.5}, ${QUAD}.0, r)) * vFx.w;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`;

const LABEL_CLASS =
  "pointer-events-none flex select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-[#0a0b1ad9] px-2.5 py-1 text-[11px] font-medium leading-none text-white/90 shadow-[0_0_18px_-6px_var(--nx-c)] transition-[opacity,scale,border-color] duration-300 data-[s=down]:text-white/45 data-[s=nokey]:text-white/45 data-[s=degraded]:text-amber-200";
const LABEL_HOT = ["scale-110", "border-white/40", "bg-[#16143aee]"];

const STATUS_CODE: Record<ProviderStatus, number> = { up: 0, degraded: 1, down: 2, nokey: 3 };
const UP = 0;
const DEGRADED = 1;
const AMBER = new Color(1, 0.6, 0.1);
const WHITE = new Color(1, 1, 1);

interface Label {
  obj: CSS2DObject;
  el: HTMLDivElement;
  name: HTMLSpanElement;
  count: HTMLElement;
  text: string;
  num: number;
  opacity: number;
}

function makeLabel(color: string, blur: boolean): Label {
  const el = document.createElement("div");
  el.className = LABEL_CLASS;
  if (blur) el.classList.add("backdrop-blur-sm");
  el.style.setProperty("--nx-c", color);
  const dot = document.createElement("i");
  dot.className = "size-1.5 shrink-0 rounded-full bg-[var(--nx-c)] shadow-[0_0_8px_var(--nx-c)]";
  const name = document.createElement("span");
  const count = document.createElement("b");
  count.className = "font-mono text-[10px] font-semibold text-[var(--nx-c)]";
  el.append(dot, name, count);
  const obj = new CSS2DObject(el);
  obj.center.set(0, 1.6); // up-right of the star
  return { obj, el, name, count, text: "", num: -1, opacity: -1 };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, x) : 0);
// Public stars carry no model counts: draw them all full size, so only status and load tell them apart.
const avail = (p: PulseStar) => (p.available === undefined ? 1 : num(p.available));
const tmpV = new Vector3();
const tmpInv = new Matrix4();
const tmpRay = new Ray();
const tmpC = new Color();

export class Stars {
  readonly group = new Group();
  /** disk-frame position per slot (static: the disk group does the rotating) */
  readonly local = new Float32Array(MAX_STARS * 3);
  private readonly ids: Array<string | null> = new Array(MAX_STARS).fill(null);
  private readonly idToSlot = new Map<string, number>();
  private readonly labels: Array<Label | null> = new Array(MAX_STARS).fill(null);
  private readonly wanted = new Uint8Array(MAX_STARS);
  private readonly status = new Uint8Array(MAX_STARS);
  private readonly avail = new Float32Array(MAX_STARS);
  private readonly load = new Float32Array(MAX_STARS);
  private readonly base = new Float32Array(MAX_STARS * 3);
  private readonly tSize = new Float32Array(MAX_STARS);
  private readonly tBright = new Float32Array(MAX_STARS);
  private readonly tAlpha = new Float32Array(MAX_STARS);
  private readonly size = new Float32Array(MAX_STARS);
  private readonly bright = new Float32Array(MAX_STARS);
  private readonly alpha = new Float32Array(MAX_STARS);
  private readonly hover = new Float32Array(MAX_STARS);
  private readonly labelOn = new Uint8Array(MAX_STARS);
  private readonly order = new Int32Array(MAX_STARS);
  private readonly rects = new Float32Array(MAX_STARS * 4);
  private hoverSlot = -1;
  private used = 0;
  private frame = 0;

  private readonly iPS = new InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4).setUsage(DynamicDrawUsage);
  private readonly iCol = new InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4).setUsage(DynamicDrawUsage);
  private readonly iFx = new InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4).setUsage(DynamicDrawUsage);
  private readonly iMisc = new InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4);
  private readonly geo = new InstancedBufferGeometry();
  private readonly mat: ShaderMaterial;
  private readonly quad = new PlaneGeometry(2, 2);

  constructor(
    shared: Shared,
    private readonly showLabels: boolean,
    private readonly blurLabels: boolean,
  ) {
    this.geo.index = this.quad.index;
    this.geo.setAttribute("position", this.quad.getAttribute("position"));
    for (const [name, a] of [["iPS", this.iPS], ["iCol", this.iCol], ["iFx", this.iFx], ["iMisc", this.iMisc]] as const) this.geo.setAttribute(name, a);
    this.geo.instanceCount = 0;
    const fx = this.iFx.array as Float32Array;
    for (let s = 0; s < MAX_STARS; s++) fx[s * 4 + 1] = fx[s * 4 + 2] = -1e6; // no flare / burst yet
    this.mat = new ShaderMaterial({
      uniforms: { uTime: shared.uTime, uScale: shared.uScale, uPx: shared.uPx },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    this.group.add(mesh);
  }

  /** Reconcile with fresh data: new ids fade in, missing ones fade out, the rest retarget smoothly. */
  set(list: PulseStar[]): void {
    const valid = (Array.isArray(list) ? list : [])
      .filter((s) => s && typeof s.id === "string" && s.id)
      .sort((a, b) => avail(b) - avail(a))
      .slice(0, MAX_STARS);
    const maxAvail = Math.max(1, ...valid.map(avail));
    const maxLoad = Math.max(1, ...valid.map((s) => num(s.load)));
    this.wanted.fill(0);
    for (const p of valid) {
      const s = this.idToSlot.get(p.id) ?? this.allocate(p.id);
      if (s < 0) continue;
      this.wanted[s] = 1;
      this.status[s] = STATUS_CODE[p.status] ?? UP;
      this.avail[s] = avail(p) / maxAvail;
      this.load[s] = Math.log1p(num(p.load)) / Math.log1p(maxLoad);
      const lab = this.labels[s];
      if (lab) {
        const text = p.label || p.id;
        if (lab.text !== text) lab.name.textContent = lab.text = text;
        if (lab.num !== num(p.available)) lab.count.textContent = String((lab.num = num(p.available)));
        lab.el.dataset.s = p.status;
      }
    }
    for (let s = 0; s < this.used; s++) if (this.ids[s]) this.retarget(s);
  }

  private allocate(id: string): number {
    const s = this.ids.indexOf(null);
    if (s < 0) return -1;
    this.ids[s] = id;
    this.idToSlot.set(id, s);
    this.size[s] = this.alpha[s] = this.hover[s] = 0;
    this.bright[s] = 1;
    this.place(id, s);
    const hex = providerColor(id);
    tmpC.set(hex);
    this.base.set([tmpC.r, tmpC.g, tmpC.b], s * 3);
    (this.iMisc.array as Float32Array)[s * 4 + 1] = (hash(id) % 1000) / 1000;
    this.iMisc.needsUpdate = true;
    if (this.showLabels) {
      const lab = makeLabel(hex, this.blurLabels);
      lab.obj.position.fromArray(this.local, s * 3);
      this.labels[s] = lab;
      this.group.add(lab.obj);
    }
    this.used = Math.max(this.used, s + 1);
    return s;
  }

  /** Hash → radius + arm (+ small scatter); re-salt up to 12 times to keep clear of the stars already placed. */
  private place(id: string, s: number): void {
    let bestD = -1;
    for (let salt = 0; salt < 12; salt++) {
      const r = rng(hash(id) + salt * 0x9e3779b9);
      const a = 10 + 24 * r();
      const ang = armPhase(a) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.16;
      const x = a * Math.cos(ang);
      const y = (r() - 0.5) * 0.6;
      const z = a * Math.sin(ang);
      let d = Infinity;
      for (let o = 0; o < this.used; o++) {
        if (o === s || !this.ids[o]) continue;
        d = Math.min(d, Math.hypot(x - this.local[o * 3], y - this.local[o * 3 + 1], z - this.local[o * 3 + 2]));
      }
      if (d > bestD) {
        bestD = d;
        this.local.set([x, y, z], s * 3);
      }
      if (d >= MIN_SEP) break;
    }
  }

  private release(s: number): void {
    const id = this.ids[s];
    if (id) this.idToSlot.delete(id);
    this.ids[s] = null;
    const lab = this.labels[s];
    if (lab) this.group.remove(lab.obj);
    this.labels[s] = null;
    this.size[s] = this.alpha[s] = this.tAlpha[s] = 0;
    this.labelOn[s] = 0;
    if (this.hoverSlot === s) this.hoverSlot = -1;
    while (this.used > 0 && !this.ids[this.used - 1]) this.used--;
  }

  private retarget(s: number): void {
    if (!this.wanted[s]) {
      this.tAlpha[s] = 0;
      return;
    }
    const st = this.status[s];
    const live = st === UP || st === DEGRADED;
    const norm = Math.sqrt(this.avail[s]);
    this.tAlpha[s] = 1;
    this.tSize[s] = (0.2 + 0.22 * norm + 0.14 * this.load[s]) * (live ? 1 : 0.75);
    this.tBright[s] = st === UP ? 1.1 + 1.1 * norm : st === DEGRADED ? 1 : 0.25;
    // colour: up = provider hue toward white, degraded = amber, down / nokey = desaturated
    tmpC.fromArray(this.base, s * 3);
    if (st === UP) tmpC.lerp(WHITE, 0.25);
    else if (st === DEGRADED) tmpC.lerp(AMBER, 0.65);
    else {
      const l = 0.3 * tmpC.r + 0.59 * tmpC.g + 0.11 * tmpC.b;
      tmpC.lerp(tmpC.clone().setRGB(l, l, l), 0.85);
    }
    tmpC.toArray(this.iCol.array as Float32Array, s * 4);
    const misc = this.iMisc.array as Float32Array;
    misc[s * 4] = st === DEGRADED ? 1 : 0;
    this.iMisc.needsUpdate = true;
  }

  slotOf(id: string): number {
    return this.idToSlot.get(id) ?? -1;
  }

  idOf(s: number): string | null {
    return this.ids[s] ?? null;
  }

  /** present and wanted (not fading out) */
  alive(s: number): boolean {
    return s >= 0 && !!this.ids[s] && this.wanted[s] === 1;
  }

  sizeOf(s: number): number {
    return this.tSize[s] || 0.5;
  }

  worldPos(s: number, out: Vector3): Vector3 {
    return out.fromArray(this.local, s * 3).applyMatrix4(this.group.matrixWorld);
  }

  /** a comet landed: ok = cyan flare, otherwise red burst + shockwave */
  arrive(s: number, ok: boolean, t: number): void {
    (this.iFx.array as Float32Array)[s * 4 + (ok ? 1 : 2)] = t;
  }

  setHover(s: number): void {
    if (s === this.hoverSlot) return;
    this.labels[this.hoverSlot]?.el.classList.remove(...LABEL_HOT);
    this.hoverSlot = s;
    this.labels[s]?.el.classList.add(...LABEL_HOT);
  }

  /** Nearest star whose pick radius the ray passes through (angular tolerance so fingers can hit them too). */
  pick(ray: Ray, camDist: number): number {
    tmpInv.copy(this.group.matrixWorld).invert();
    tmpRay.copy(ray).applyMatrix4(tmpInv);
    let best = -1;
    let bestD = Infinity;
    for (let s = 0; s < this.used; s++) {
      if (!this.alive(s) || this.alpha[s] < 0.5) continue;
      tmpV.fromArray(this.local, s * 3);
      const r = Math.max(this.size[s] * 2.5, camDist * 0.022);
      if (tmpRay.distanceSqToPoint(tmpV) > r * r) continue;
      const d = tmpRay.origin.distanceToSquared(tmpV);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** CSS px of a slot relative to the host. */
  screenOf(s: number, camera: PerspectiveCamera, w: number, h: number, out: { x: number; y: number }): void {
    this.worldPos(s, tmpV).project(camera);
    out.x = (tmpV.x * 0.5 + 0.5) * w;
    out.y = (-tmpV.y * 0.5 + 0.5) * h;
  }

  update(rdt: number, camera: PerspectiveCamera, w: number, h: number): void {
    const ease = 1 - Math.exp(-rdt * 3.2);
    const hov = 1 - Math.exp(-rdt * 10);
    const ps = this.iPS.array as Float32Array;
    const col = this.iCol.array as Float32Array;
    const fx = this.iFx.array as Float32Array;
    for (let s = 0; s < this.used; s++) {
      if (!this.ids[s]) {
        fx[s * 4 + 3] = 0;
        continue;
      }
      this.alpha[s] += (this.tAlpha[s] - this.alpha[s]) * ease;
      if (!this.wanted[s] && this.alpha[s] < 0.01) {
        this.release(s);
        fx[s * 4 + 3] = 0;
        continue;
      }
      this.size[s] += (this.tSize[s] - this.size[s]) * ease;
      this.bright[s] += (this.tBright[s] - this.bright[s]) * ease;
      this.hover[s] += ((this.hoverSlot === s ? 1 : 0) - this.hover[s]) * hov;
      const o = s * 4;
      ps[o] = this.local[s * 3];
      ps[o + 1] = this.local[s * 3 + 1];
      ps[o + 2] = this.local[s * 3 + 2];
      ps[o + 3] = this.size[s];
      col[o + 3] = this.bright[s];
      fx[o] = this.hover[s];
      fx[o + 3] = this.alpha[s];
    }
    this.iPS.needsUpdate = this.iCol.needsUpdate = this.iFx.needsUpdate = true;
    this.geo.instanceCount = this.used;
    if (!this.showLabels) return;
    if (this.frame++ % 6 === 0) this.layoutLabels(camera, w, h);
    for (let s = 0; s < this.used; s++) {
      const lab = this.labels[s];
      if (!lab) continue;
      const target = this.labelOn[s] ? this.alpha[s] * (this.status[s] >= 2 ? 0.55 : 1) : 0;
      if (Math.abs(target - lab.opacity) > 0.03 || (target === 0 && lab.opacity !== 0)) {
        lab.opacity = target;
        lab.el.style.opacity = target.toFixed(2);
      }
      lab.obj.visible = lab.opacity > 0.02;
    }
  }

  /** Greedy declutter: brightest labels claim screen rects first, overlapping ones hide; small screens show fewer. */
  private layoutLabels(camera: PerspectiveCamera, w: number, h: number): void {
    let n = 0;
    for (let s = 0; s < this.used; s++) if (this.ids[s]) this.order[n++] = s;
    const key = (s: number) => (s === this.hoverSlot ? 1e9 : this.size[s] * this.bright[s]);
    const sorted = this.order.subarray(0, n).sort((a, b) => key(b) - key(a));
    const cap = w < 640 ? 6 : w < 1024 ? 12 : MAX_STARS;
    let shown = 0;
    for (const s of sorted) {
      const lab = this.labels[s]!;
      this.labelOn[s] = 0;
      if (this.alpha[s] < 0.3 || shown >= cap) continue;
      this.worldPos(s, tmpV).project(camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) continue;
      const sx = (tmpV.x * 0.5 + 0.5) * w;
      const width = 46 + lab.text.length * 6.4;
      const flip = sx + width > w - 6; // near the right edge the label sits left of the star instead of clipping
      lab.obj.center.x = flip ? 1 : 0;
      const x0 = flip ? sx + 2 - width : sx - 2;
      const x1 = x0 + width;
      const y0 = (-tmpV.y * 0.5 + 0.5) * h - 34;
      const y1 = y0 + 22;
      if (x0 < 6 || x1 > w - 2) continue;
      let clash = false;
      for (let k = 0; k < shown && !clash && s !== this.hoverSlot; k++) {
        const r = k * 4;
        clash = x0 < this.rects[r + 2] && x1 > this.rects[r] && y0 < this.rects[r + 3] && y1 > this.rects[r + 1];
      }
      if (clash) continue;
      this.rects.set([x0, y0, x1, y1], shown * 4);
      shown++;
      this.labelOn[s] = 1;
    }
  }

  dispose(): void {
    for (const lab of this.labels) if (lab) this.group.remove(lab.obj);
    this.geo.dispose();
    this.quad.dispose();
    this.mat.dispose();
  }
}
