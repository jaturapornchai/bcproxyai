// Galaxy: the BCAiRouter landing scene. Imperative three.js so React never sits in the render loop.
// Scene graph: scene -> [sky (dome + far stars, follows the camera)] + disk (turns at the arm pattern speed) ->
// [galaxy (stars, dust, knots, glow), core (the router), stars (providers), comets (real events)]
import { ACESFilmicToneMapping, Group, Raycaster, Scene, Vector2, WebGLRenderer } from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { GalaxyHandle, GalaxyOptions } from "./types";
import { Director } from "./engine/camera";
import { Comets } from "./engine/comets";
import { createCore } from "./engine/core";
import { buildGalaxy, OMEGA_P, type Shared } from "./engine/galaxy";
import { createFx, type Fx } from "./engine/post";
import { Governor, TIERS, initialTier, loadStoredTier, storeTier, type GovAction, type Tier } from "./engine/quality";
import { Stars } from "./engine/stars";

/** Reduced motion slows the galaxy's rotation instead of freezing it. Comets keep real time: they are the data. */
const CALM = 0.35;
const LOW_EXPOSURE = 0.65;
const PROBE_RAFS = 6;
const PICK_INTERVAL_MS = 50;
const CLICK_SLOP_PX = 6;

const NOOP_HANDLE: GalaxyHandle = {
  setStars() {},
  pushEvents() {},
  focusStar() {},
  setDirector() {},
  resetView() {},
  setPaused() {},
  dispose() {},
};

/** Never throws: any failure is reported through onFallback so the page can show its static scene. */
export function createGalaxy(host: HTMLElement, opts: GalaxyOptions): GalaxyHandle {
  try {
    return build(host, opts);
  } catch (e) {
    opts.onFallback?.(`init-error: ${e instanceof Error ? e.message : String(e)}`);
    return NOOP_HANDLE;
  }
}

function build(host: HTMLElement, opts: GalaxyOptions): GalaxyHandle {
  const reduced = opts.reducedMotion;
  let tier: Tier = initialTier(loadStoredTier());
  let spec = TIERS[tier];
  const canvas = document.createElement("canvas");
  canvas.className = "block h-full w-full cursor-grab outline-none active:cursor-grabbing";
  const gl = canvas.getContext("webgl2", { antialias: !spec.post, alpha: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) {
    opts.onFallback?.("webgl2-unavailable");
    return NOOP_HANDLE;
  }
  // without float colour buffers there is no HDR composer: plain render at the LOW tier
  if (!(gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("EXT_color_buffer_float")) && tier !== "low") {
    tier = "low";
    spec = TIERS.low;
  }

  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: !spec.post, alpha: false, stencil: false });
  renderer.setClearColor(0x020308, 1);
  renderer.toneMapping = ACESFilmicToneMapping; // only applies in the no-composer fallback (composer renders to buffers)
  let dpr = Math.min(window.devicePixelRatio || 1, spec.dprCap);
  renderer.setPixelRatio(dpr);

  const shared: Shared = { uTime: { value: 0 }, uGal: { value: 0 }, uPx: { value: dpr }, uScale: { value: 1000 } };
  const scene = new Scene();
  const disk = new Group();
  const galaxy = buildGalaxy(shared, spec);
  const core = createCore(shared);
  const stars = new Stars(shared, opts.showLabels, spec.post);
  let introDone = false;
  const director = new Director(canvas, reduced, disk, stars, {
    onIntroDone: () => {
      introDone = true;
      opts.onIntroDone?.();
    },
    onMode: (m) => opts.onDirector?.(m),
  });
  const comets = new Comets(shared, stars, core, (slot, ok, start, dur, ctrl, target) => director.comet(slot, ok, start, dur, ctrl, target));
  scene.add(galaxy.sky, disk);
  disk.add(galaxy.disk, core.group, stars.group, comets.group);
  const camera = director.camera;

  // public view: no label layer at all, so no provider name ever reaches the DOM
  const labels = opts.showLabels ? new CSS2DRenderer() : null;
  host.append(canvas);
  if (labels) {
    labels.domElement.className = "pointer-events-none absolute inset-0 overflow-hidden";
    host.append(labels.domElement);
  }

  let fx: Fx;
  try {
    fx = createFx(renderer, scene, camera, spec);
  } catch {
    spec = { ...spec, post: false };
    fx = createFx(renderer, scene, camera, spec);
  }
  // no bloom to soak up the HDR highlights: pull exposure down so the core and stars don't clip to flat white
  renderer.toneMappingExposure = spec.post ? 1 : LOW_EXPOSURE;

  const gov = new Governor(tier, dpr, spec.dprFloor, performance.now());

  // ── frame state ──
  let w = 0;
  let h = 0;
  let raf = 0;
  let lastTs = 0;
  let frames = 0;
  let t = 0; // engine clock: real seconds while running (shared.uTime)
  let fade = 1;
  let disposed = false;
  let lost = false;
  let paused = false;
  let onScreen = true;
  let capProbe: number[] | null = null;

  // ── pointer / picking ──
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const ptr = { inside: false, dirty: false, lastPick: 0, downX: 0, downY: 0, downT: 0, touch: false };
  const hoverAt = { x: 0, y: 0 };
  let hoverSlot = -1;

  function setNdc(clientX: number, clientY: number): void {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }
  function pickNow(): number {
    raycaster.setFromCamera(ndc, camera);
    return stars.pick(raycaster.ray, camera.position.distanceTo(director.controls.target));
  }
  function emitHover(): void {
    const id = hoverSlot >= 0 ? stars.idOf(hoverSlot) : null;
    if (!id) return opts.onHover?.(null, null);
    stars.screenOf(hoverSlot, camera, w, h, hoverAt);
    opts.onHover?.(id, { x: hoverAt.x, y: hoverAt.y });
  }
  function updateHover(): void {
    const s = ptr.inside && !ptr.touch ? pickNow() : -1;
    if (s !== hoverSlot) {
      hoverSlot = s;
      stars.setHover(s);
      canvas.classList.toggle("cursor-pointer", s >= 0);
      canvas.classList.toggle("cursor-grab", s < 0);
      emitHover();
    } else if (s >= 0) {
      emitHover(); // the star keeps turning with the disk: keep the page's tooltip glued to it
    }
  }
  const onPointerMove = (e: PointerEvent) => {
    ptr.touch = e.pointerType === "touch";
    ptr.inside = true;
    setNdc(e.clientX, e.clientY);
    ptr.dirty = true;
  };
  const onPointerLeave = () => {
    ptr.inside = false;
    ptr.dirty = true;
  };
  const onPointerDown = (e: PointerEvent) => {
    ptr.touch = e.pointerType === "touch";
    ptr.downX = e.clientX;
    ptr.downY = e.clientY;
    ptr.downT = performance.now();
  };
  const onPointerUp = (e: PointerEvent) => {
    if (performance.now() - ptr.downT > 450 || Math.hypot(e.clientX - ptr.downX, e.clientY - ptr.downY) > CLICK_SLOP_PX) return;
    setNdc(e.clientX, e.clientY);
    const s = pickNow();
    const id = s >= 0 ? stars.idOf(s) : null;
    if (!id) return;
    opts.onSelect?.(id);
    director.focus(s, false);
  };
  const onDblClick = () => director.reset();
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("dblclick", onDblClick);

  // ── lifecycle plumbing ──
  const running = () => !disposed && !lost && !paused && onScreen && w > 0 && h > 0 && !document.hidden;
  function invalidate(): void {
    if (!raf && running()) raf = requestAnimationFrame(frame);
  }
  const onVisibility = () => {
    lastTs = 0;
    invalidate();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onContextLost = (e: Event) => {
    e.preventDefault();
    if (disposed) return;
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    opts.onFallback?.("context-lost");
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  function resize(): void {
    const nw = host.clientWidth;
    const nh = host.clientHeight;
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    if (w === 0 || h === 0) return;
    director.resize(w, h);
    fx.setSize(w, h);
    labels?.setSize(w, h);
    invalidate();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    lastTs = 0;
    invalidate();
  });
  intersection.observe(host);
  resize();

  // ── governor ──
  function applyTier(next: Tier): void {
    tier = next;
    spec = TIERS[next];
    storeTier(next);
    galaxy.setTier(spec);
    if (!spec.post) {
      fx.disablePost();
      renderer.toneMappingExposure = LOW_EXPOSURE;
    }
    gov.floor = spec.dprFloor;
    gov.dpr = Math.min(gov.dpr, spec.dprCap);
    setDpr(gov.dpr);
  }
  function setDpr(next: number): void {
    dpr = next;
    renderer.setPixelRatio(dpr);
    shared.uPx.value = dpr;
    fx.setSize(w, h);
  }
  /** true = this frame stops here (a cap probe just started) */
  function govern(a: GovAction | null): boolean {
    if (a?.kind === "probe") {
      capProbe = [];
      invalidate();
      return true;
    }
    if (a?.kind === "dpr") setDpr(a.dpr);
    else if (a?.kind === "tier") applyTier(a.tier);
    return false;
  }

  // ── main loop ──
  function frame(ts: number): void {
    raf = 0;
    if (!running()) {
      lastTs = 0;
      if (capProbe) capProbe = [];
      return;
    }
    if (capProbe) {
      // idle a few rAFs and measure the bare cadence: tells a display/browser cap apart from our own cost
      capProbe.push(ts);
      if (capProbe.length <= PROBE_RAFS) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const d = capProbe.slice(1).map((v, i) => v - capProbe![i]).sort((a, b) => a - b);
      capProbe = null;
      lastTs = 0;
      if (govern(gov.probed(d[d.length >> 1]))) return;
    }

    const rawMs = lastTs ? ts - lastTs : 1000 / 60;
    const rdt = Math.min(0.1, rawMs / 1000);
    lastTs = ts;
    t += rdt;
    frames++;
    shared.uTime.value = t;
    shared.uGal.value += rdt * (reduced ? CALM : 1);
    disk.rotation.y = -OMEGA_P * shared.uGal.value;
    disk.updateMatrixWorld();
    if (frames === 3) director.startIntro(t); // two warm-up frames absorb shader compilation, so the fly-in starts smooth

    comets.update(t);
    core.update(rdt);
    const flying = director.update(rdt, t);
    if (director.fade !== fade) {
      fade = director.fade;
      canvas.style.opacity = fade.toFixed(3);
      if (labels) labels.domElement.style.opacity = canvas.style.opacity;
    }
    shared.uScale.value = (h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    galaxy.update(camera);
    stars.update(rdt, camera, w, h);

    const now = performance.now();
    if (ptr.inside ? now - ptr.lastPick > (ptr.dirty ? PICK_INTERVAL_MS : 120) : ptr.dirty) {
      ptr.lastPick = now;
      ptr.dirty = false;
      updateHover();
    }

    fx.render(rdt);
    labels?.render(scene, camera);

    if (frames === 1) opts.onReady?.();
    if (govern(gov.sample(rawMs, now, flying || !introDone))) return;
    raf = requestAnimationFrame(frame); // the galaxy always turns
  }
  invalidate();

  return {
    setStars(list) {
      if (!disposed) stars.set(list);
    },
    pushEvents(list) {
      if (!disposed) comets.push(list, t);
    },
    focusStar(id) {
      if (disposed) return;
      const slot = id ? stars.slotOf(id) : -1;
      if (id && slot < 0) return;
      director.focus(slot, true);
    },
    setDirector(mode) {
      if (!disposed) director.setDirector(mode);
    },
    resetView() {
      if (!disposed) director.reset();
    },
    setPaused(p) {
      paused = p;
      lastTs = 0;
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("dblclick", onDblClick);
      director.dispose();
      stars.dispose();
      comets.dispose();
      core.dispose();
      galaxy.dispose();
      fx.dispose();
      renderer.dispose();
      if (!gl.isContextLost()) renderer.forceContextLoss(); // free the GPU context now instead of waiting for GC
      labels?.domElement.remove();
      canvas.remove();
    },
  };
}
