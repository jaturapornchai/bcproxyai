// Post chain (pmndrs postprocessing): HDR half-float buffers, chromatic fringe, bloom, ACES, vignette, film grain.
// LOW tier (or any build failure) renders straight to the canvas: the shaders end with tonemapping_fragment, so the
// renderer's own ACES keeps the same look minus the bloom.
import { HalfFloatType, Vector2, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import type { TierSpec } from "./quality";

export interface Fx {
  render(dt: number): void;
  setSize(w: number, h: number): void;
  /** downgrade only: drops the composer so the next frames render straight to the canvas */
  disablePost(): void;
  dispose(): void;
}

/** Throws if the composer can't be built (the caller then continues with a plain render). */
export function createFx(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, spec: TierSpec): Fx {
  let composer: EffectComposer | null = null;
  let size: [number, number] = [1, 1];
  if (spec.post) {
    composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: spec.msaa });
    composer.addPass(new RenderPass(scene, camera));
    const noise = new NoiseEffect({ premultiply: true });
    noise.blendMode.opacity.value = 0.12;
    composer.addPass(
      new EffectPass(
        camera,
        // sorted by attribute: the convolution effect (fringe) runs first, the rest keep this order
        new ChromaticAberrationEffect({ offset: new Vector2(0.0005, 0.0006), radialModulation: true, modulationOffset: 0.3 }),
        new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.62, luminanceSmoothing: 0.3, intensity: 1.05, radius: 0.85, levels: spec.bloomLevels }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        new VignetteEffect({ offset: 0.35, darkness: 0.5 }),
        noise,
      ),
    );
  }
  return {
    render(dt) {
      if (composer) composer.render(dt);
      else renderer.render(scene, camera);
    },
    setSize(w, h) {
      size = [w, h];
      if (composer) composer.setSize(w, h);
      else renderer.setSize(w, h);
    },
    disablePost() {
      if (!composer) return;
      composer.dispose();
      composer = null;
      renderer.setSize(size[0], size[1]);
    },
    dispose() {
      composer?.dispose();
      composer = null;
    },
  };
}
