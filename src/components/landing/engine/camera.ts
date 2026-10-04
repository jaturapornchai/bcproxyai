// Auto-director. Intro fly-in from deep space, then event-driven shots: frame a comet's path, follow it, hold on its
// star, ease back out. Busy traffic stays wide and higher up; a quiet galaxy gets a slow cinematic orbit. Every move
// goes through critically damped springs (target xyz, azimuth, polar, log distance, fov) with capped speeds, so nothing
// snaps. User input hands the camera to OrbitControls; the director takes it back after RESUME_S idle unless locked.
// Reduced motion: no fly-in, no auto shots or drift, and focus / reset become a quick fade cut.
import { MathUtils, PerspectiveCamera, Vector3, type Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DirectorMode } from "../types";
import { cometPoint } from "./comets";
import { GALAXY_R } from "./galaxy";
import { MAX_STARS, type Stars } from "./stars";

const RESUME_S = 8;
const IDLE_S = 30;
const BUSY_N = 6;
const BUSY_S = 10;
const HOLD_S = 3;
const COOLDOWN_S = 4;
const INTRO_MAX_S = 7;
const FLIGHT_MAX_S = 5;
const CUT_OUT_S = 0.18;
const CUT_IN_S = 0.25;
const RECENT = 32;
const TAU = Math.PI * 2;

const wrap = (a: number) => a - TAU * Math.round(a / TAU);

class Spring {
  x = 0;
  v = 0;
  /** exact critically damped step toward `goal` (stiffness w), speed capped at maxV */
  step(goal: number, w: number, dt: number, maxV: number): void {
    const y = this.x - goal;
    const e = Math.exp(-w * dt);
    const c = this.v + w * y;
    let nx = goal + (y + c * dt) * e;
    const nv = (this.v - w * c * dt) * e;
    const lim = maxV * dt;
    if (Math.abs(nx - this.x) > lim) nx = this.x + Math.sign(nx - this.x) * lim;
    this.v = MathUtils.clamp(nv, -maxV, maxV);
    this.x = nx;
  }

  snap(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

const tmp = new Vector3();
const tmp2 = new Vector3();

export interface DirectorEvents {
  onIntroDone(): void;
  /** mode changed by the user or the idle timer (not by setDirector) */
  onMode(mode: DirectorMode): void;
}

export class Director {
  readonly camera = new PerspectiveCamera(45, 1, 0.1, 5000);
  readonly controls: OrbitControls;
  mode: DirectorMode = "auto";
  /** canvas opacity 0..1 (reduced-motion fade cuts) */
  fade = 1;
  introActive: boolean;
  private introT0 = -1;
  private locked = false;
  private flying = false;
  private flightT0 = 0;
  private dragging = false;
  private now = 0;
  private lastInput = -1e9;
  private lastLaunch = 0;
  private cooldownUntil = 0;
  private cutT = -1;
  // springs + goals
  private readonly tx = new Spring();
  private readonly ty = new Spring();
  private readonly tz = new Spring();
  private readonly az = new Spring();
  private readonly pol = new Spring();
  private readonly ld = new Spring();
  private readonly fov = new Spring();
  private readonly gT = new Vector3();
  private gAz = 0;
  private gPol = 1;
  private gLd = 4;
  private gW = 1;
  private gFov = 45;
  // framing
  private wideD = 70;
  private baseFov = 45;
  private portrait = false;
  private wideAz = 0.6;
  // focus: hard = page asked (sticky until null), soft = a click (dropped when the director resumes)
  private focusSlot = -1;
  private focusHard = false;
  private readonly focusPrev = new Vector3();
  // current event shot
  private shotSlot = -1;
  private shotStart = 0;
  private shotDur = 1;
  private shotAz = 0;
  private readonly shotCtrl = new Vector3();
  private readonly shotTarget = new Vector3();
  // recent launches (ring) + decaying per-star activity
  private readonly rStart = new Float64Array(RECENT).fill(-1e9);
  private readonly rDur = new Float32Array(RECENT);
  private readonly rSlot = new Int16Array(RECENT);
  private readonly rOk = new Uint8Array(RECENT);
  private readonly rCtrl = new Float32Array(RECENT * 3);
  private readonly rTarget = new Float32Array(RECENT * 3);
  private rHead = 0;
  private readonly activity = new Float32Array(MAX_STARS);

  constructor(
    canvas: HTMLCanvasElement,
    private readonly reduced: boolean,
    private readonly disk: Object3D,
    private readonly stars: Stars,
    private readonly ev: DirectorEvents,
  ) {
    this.introActive = !reduced;
    const c = new OrbitControls(this.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.5;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.8;
    c.screenSpacePanning = false; // pan slides along the disk plane
    c.minDistance = 3;
    c.maxDistance = 420;
    c.minPolarAngle = 0.05;
    c.maxPolarAngle = Math.PI - 0.05;
    c.addEventListener("start", this.onStart);
    c.addEventListener("end", this.onEnd);
    this.controls = c;
    this.resize(1280, 720);
    if (reduced) {
      this.wideGoals(0, false, false);
      this.snap();
    } else {
      // deep space, looking down at the disk from far above and to the side
      this.az.snap(this.wideAz + 1.8);
      this.pol.snap(0.32);
      this.ld.snap(Math.log(520));
      this.fov.snap(70);
    }
    this.apply();
  }

  resize(w: number, h: number): void {
    const aspect = w / h;
    this.portrait = aspect < 0.9;
    this.baseFov = this.portrait ? 55 : 45;
    const halfW = this.portrait ? 24 : 44; // phones crop the disk's sides rather than show a speck
    this.wideD = MathUtils.clamp(halfW / (Math.tan(MathUtils.degToRad(this.baseFov / 2)) * aspect), 55, 160);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Call once the first frames are on screen, so shader compilation doesn't eat the fly-in. */
  startIntro(t: number): void {
    if (!this.introActive) this.ev.onIntroDone();
    else this.introT0 = t;
  }

  comet(slot: number, ok: boolean, start: number, dur: number, ctrl: Vector3, target: Vector3): void {
    const i = this.rHead;
    this.rHead = (i + 1) % RECENT;
    this.rStart[i] = start;
    this.rDur[i] = dur;
    this.rSlot[i] = slot;
    this.rOk[i] = ok ? 1 : 0;
    ctrl.toArray(this.rCtrl, i * 3);
    target.toArray(this.rTarget, i * 3);
    this.activity[slot] += 1;
    this.lastLaunch = start;
  }

  /** slot -1 = back to the wide shot */
  focus(slot: number, hard: boolean): void {
    if (slot < 0 && this.focusSlot < 0) return;
    if (this.introActive) this.finishIntro();
    this.focusSlot = slot;
    this.focusHard = hard;
    if (slot >= 0) this.stars.worldPos(slot, this.focusPrev);
    this.shotSlot = -1;
    this.fly();
  }

  reset(): void {
    if (this.introActive) this.finishIntro();
    this.focusSlot = -1;
    this.shotSlot = -1;
    this.fly();
    if (!this.locked) this.setMode("auto");
  }

  setDirector(mode: DirectorMode): void {
    this.locked = mode === "manual";
    if (mode === this.mode) return;
    this.mode = mode;
    this.shotSlot = -1;
    if (mode === "auto") this.wideAz = this.az.x;
  }

  /** `rdt` real seconds, `t` engine clock. Returns true while the intro fly-in runs. */
  update(rdt: number, t: number): boolean {
    this.now = t;
    const decay = Math.exp(-rdt / 30);
    for (let i = 0; i < MAX_STARS; i++) this.activity[i] *= decay;
    if (this.cutT >= 0) this.stepCut(t);
    if (this.dragging) this.lastInput = t;
    if (this.focusSlot >= 0 && !this.stars.alive(this.focusSlot)) this.focusSlot = -1;
    if (this.shotSlot >= 0 && !this.stars.alive(this.shotSlot)) this.endShot(t);

    if (!this.introActive && !this.flying && this.mode === "manual") {
      // OrbitControls drives; a focused star keeps its framing while the disk turns
      if (this.focusSlot >= 0) {
        this.stars.worldPos(this.focusSlot, tmp);
        tmp2.subVectors(tmp, this.focusPrev);
        this.controls.target.add(tmp2);
        this.camera.position.add(tmp2);
        this.focusPrev.copy(tmp);
      }
      this.controls.update(rdt);
      if (this.controls.target.length() > GALAXY_R * 1.5) this.controls.target.setLength(GALAXY_R * 1.5);
      this.syncFromCamera();
      if (!this.locked && t - this.lastInput > RESUME_S) this.resume();
      return false;
    }

    if (this.introActive && this.introT0 < 0) return true; // warm-up frames: hold the start pose
    this.goals(t, rdt);
    if (this.reduced) {
      if (this.cutT < 0 || t - this.cutT >= CUT_OUT_S) this.snap();
    } else this.stepSprings(rdt);
    this.apply();

    const settled = Math.abs(this.ld.x - this.gLd) < 0.04 && Math.abs(wrap(this.az.x - this.gAz)) < 0.05 && tmp.set(this.tx.x, this.ty.x, this.tz.x).distanceTo(this.gT) < 0.5;
    if (this.introActive && (settled || t - this.introT0 > INTRO_MAX_S)) this.finishIntro();
    if (this.flying && (settled || t - this.flightT0 > FLIGHT_MAX_S)) {
      this.flying = false;
      if (this.focusSlot >= 0) this.stars.worldPos(this.focusSlot, this.focusPrev);
    }
    return this.introActive;
  }

  private goals(t: number, rdt: number): void {
    if (this.focusSlot >= 0) {
      this.stars.worldPos(this.focusSlot, this.gT);
      this.gAz = this.az.x + (this.reduced ? 0 : rdt * 0.03);
      this.gPol = 1.12;
      this.gLd = Math.log(10 + this.stars.sizeOf(this.focusSlot) * 10);
      this.gFov = this.baseFov;
      this.gW = 1.4;
      return;
    }
    if (this.introActive) {
      this.wideGoals(t, false, false);
      this.gW = 1.1;
      return;
    }
    const auto = this.mode === "auto" && !this.reduced;
    const busy = !this.reduced && this.launchesSince(t - BUSY_S) >= BUSY_N;
    if (this.shotSlot >= 0 && (busy || !auto)) this.endShot(t);
    if (this.shotSlot < 0 && auto && !busy && !this.flying && t >= this.cooldownUntil) this.pickShot(t);
    if (this.shotSlot >= 0 && this.shotGoals(t)) return;
    const idle = auto && t - this.lastLaunch > IDLE_S;
    if (auto) this.wideAz += rdt * (idle ? 0.04 : 0.012);
    this.wideGoals(t, busy, idle);
  }

  private wideGoals(t: number, busy: boolean, idle: boolean): void {
    this.gT.set(0, 0, 0);
    this.gAz = this.wideAz;
    this.gPol = (this.portrait ? 0.8 : 0.98) - (busy ? 0.32 : 0) + (idle ? 0.1 * Math.sin(t * 0.05) : 0);
    this.gLd = Math.log(this.wideD * (busy ? 1.1 : 1) * (idle ? 1 + 0.06 * Math.sin(t * 0.037) : 1));
    this.gFov = this.baseFov;
    this.gW = busy ? 0.8 : 0.9;
  }

  /** Prefer a failure, then the busiest star, among comets that just left and still have time to fly. */
  private pickShot(t: number): void {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < RECENT; i++) {
      const s = this.rSlot[i];
      if (t - this.rStart[i] > 1 || this.rStart[i] + this.rDur[i] - t < 0.6 || !this.stars.alive(s)) continue;
      const score = (this.rOk[i] ? 0 : 1000) + this.activity[s];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return;
    this.shotSlot = this.rSlot[best];
    this.shotStart = this.rStart[best];
    this.shotDur = this.rDur[best];
    this.shotCtrl.fromArray(this.rCtrl, best * 3);
    this.shotTarget.fromArray(this.rTarget, best * 3);
    // look at the path from the side, on whichever side is nearer the current angle
    this.stars.worldPos(this.shotSlot, tmp);
    const starAz = Math.atan2(tmp.x, tmp.z);
    const a = wrap(starAz + 1.25 - this.az.x);
    const b = wrap(starAz - 1.25 - this.az.x);
    this.shotAz = this.az.x + (Math.abs(a) < Math.abs(b) ? a : b);
  }

  /** false once the shot is over */
  private shotGoals(t: number): boolean {
    const arrive = this.shotStart + this.shotDur;
    if (t >= arrive + HOLD_S) {
      this.endShot(t);
      return false;
    }
    this.stars.worldPos(this.shotSlot, tmp);
    this.gFov = this.baseFov;
    if (t < arrive) {
      // whole path in frame, leaning toward the comet head
      cometPoint(this.shotCtrl, this.shotTarget, (t - this.shotStart) / this.shotDur, tmp2);
      this.disk.localToWorld(tmp2);
      this.gT.copy(tmp).multiplyScalar(0.5).lerp(tmp2, 0.45);
      this.gLd = Math.log(Math.max(16, tmp.length() * 1.05 + 10));
      this.gPol = 1.02;
      this.gAz = this.shotAz;
      this.gW = 1.5;
    } else {
      this.gT.copy(tmp);
      this.gLd = Math.log(12 + this.stars.sizeOf(this.shotSlot) * 8);
      this.gPol = 1.14;
      this.gAz = this.shotAz + (t - arrive) * 0.05;
      this.gW = 1.2;
    }
    return true;
  }

  private endShot(t: number): void {
    this.shotSlot = -1;
    this.cooldownUntil = t + COOLDOWN_S;
    this.wideAz = this.az.x;
  }

  private launchesSince(t0: number): number {
    let n = 0;
    for (let i = 0; i < RECENT; i++) if (this.rStart[i] > t0) n++;
    return n;
  }

  private stepSprings(dt: number): void {
    const w = this.gW;
    const vT = 0.6 * Math.exp(this.ld.x) + 4;
    this.tx.step(this.gT.x, w, dt, vT);
    this.ty.step(this.gT.y, w, dt, vT);
    this.tz.step(this.gT.z, w, dt, vT);
    this.az.step(this.az.x + wrap(this.gAz - this.az.x), w, dt, 0.45);
    this.pol.step(this.gPol, w, dt, 0.3);
    this.ld.step(this.gLd, w, dt, 0.75);
    this.fov.step(this.gFov, w, dt, 10);
  }

  private snap(): void {
    this.tx.snap(this.gT.x);
    this.ty.snap(this.gT.y);
    this.tz.snap(this.gT.z);
    this.az.snap(this.gAz);
    this.pol.snap(this.gPol);
    this.ld.snap(this.gLd);
    this.fov.snap(this.gFov);
  }

  private apply(): void {
    this.controls.target.set(this.tx.x, this.ty.x, this.tz.x);
    this.camera.position.setFromSphericalCoords(Math.exp(this.ld.x), this.pol.x, this.az.x).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    if (Math.abs(this.camera.fov - this.fov.x) > 1e-3) {
      this.camera.fov = this.fov.x;
      this.camera.updateProjectionMatrix();
    }
  }

  private syncFromCamera(): void {
    const t = this.controls.target;
    tmp.subVectors(this.camera.position, t);
    const d = tmp.length() || 1;
    this.tx.snap(t.x);
    this.ty.snap(t.y);
    this.tz.snap(t.z);
    this.ld.snap(Math.log(d));
    this.pol.snap(Math.acos(MathUtils.clamp(tmp.y / d, -1, 1)));
    this.az.snap(Math.atan2(tmp.x, tmp.z));
    this.fov.snap(this.camera.fov);
  }

  private fly(): void {
    this.flying = true;
    this.flightT0 = this.now;
    if (this.reduced) {
      this.cutT = this.now;
      this.fade = 1;
    }
  }

  private stepCut(t: number): void {
    const k = t - this.cutT;
    if (k < CUT_OUT_S) this.fade = 1 - k / CUT_OUT_S;
    else if (k < CUT_OUT_S + CUT_IN_S) this.fade = (k - CUT_OUT_S) / CUT_IN_S;
    else {
      this.fade = 1;
      this.cutT = -1;
    }
  }

  private finishIntro(): void {
    this.introActive = false;
    this.wideAz = this.az.x;
    this.lastLaunch = Math.max(this.lastLaunch, this.now);
    this.ev.onIntroDone();
  }

  private setMode(mode: DirectorMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.ev.onMode(mode);
  }

  private resume(): void {
    this.wideAz = this.az.x;
    if (!this.focusHard) this.focusSlot = -1;
    this.cooldownUntil = this.now + 1.5;
    this.setMode("auto");
  }

  private readonly onStart = () => {
    if (this.introActive) this.finishIntro();
    this.flying = false;
    this.cutT = -1;
    this.fade = 1;
    this.shotSlot = -1;
    this.dragging = true;
    this.lastInput = this.now;
    if (this.focusSlot >= 0) this.stars.worldPos(this.focusSlot, this.focusPrev);
    this.setMode("manual");
  };

  private readonly onEnd = () => {
    this.dragging = false;
    this.lastInput = this.now;
  };

  dispose(): void {
    this.controls.removeEventListener("start", this.onStart);
    this.controls.removeEventListener("end", this.onEnd);
    this.controls.dispose();
  }
}
