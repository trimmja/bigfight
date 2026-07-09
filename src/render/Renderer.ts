/**
 * WebGL renderer for BIG FIGHT. Owns the Three renderer, scene, camera, and
 * (on the high tier) the bloom composer. Resolves a quality tier, tracks a
 * rolling frame-time average, and — in 'auto' mode — permanently drops to the
 * mobile tier if the device can't hold the target frame time.
 */
import * as THREE from 'three';
import type { IRenderer, QualityTier } from '../contracts';
import type { SaveSettings } from '../data/types';
import {
  CAM_FOV,
  COLOR_BG,
  DPR_CAP_MOBILE,
  DPR_CAP_DESKTOP,
  AUTO_QUALITY_FRAME_MS,
} from '../config';
import { Bloom } from './Bloom';

/** Window over which frame time is averaged for the auto-downgrade check. */
const SAMPLE_WINDOW_S = 5;

export class Renderer implements IRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private bloom: Bloom | null = null;

  /** Requested mode; `tier` is the resolved/active tier. */
  private mode: SaveSettings['quality'];
  private _tier: QualityTier;

  // Rolling frame-time accumulation (auto-downgrade).
  private frameSumMs = 0;
  private frameCount = 0;
  private elapsedS = 0;
  private downgraded = false;

  constructor(canvas: HTMLCanvasElement, quality: 'auto' | 'mobile' | 'high') {
    this.canvas = canvas;
    this.mode = quality;
    this._tier = Renderer.resolveTier(quality);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this._tier === 'high',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(COLOR_BG, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(COLOR_BG, 0.006);

    // Bright-cartoon lighting: soft sky/ground fill + one warm sun key.
    const hemi = new THREE.HemisphereLight(0xd8efff, 0xffe3b8, 1.15);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 18, 12);
    this.scene.add(hemi, sun);

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
    this.camera.position.set(0, 0, 22);
    this.camera.lookAt(0, 0, 0);

    // Size the renderer + camera before the bloom chain reads the buffer size.
    this.onResize();
    if (this._tier === 'high') this.buildBloom();
  }

  get tier(): QualityTier {
    return this._tier;
  }

  /** 'auto' → mobile on touch devices, else high. */
  private static resolveTier(mode: SaveSettings['quality']): QualityTier {
    if (mode === 'mobile') return 'mobile';
    if (mode === 'high') return 'high';
    return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 ? 'mobile' : 'high';
  }

  setQuality(q: SaveSettings['quality']): void {
    this.mode = q;
    if (q === 'auto') this.downgraded = false;
    const next = Renderer.resolveTier(q);
    if (next !== this._tier) this.applyTier(next);
  }

  render(dt: number): void {
    // Frame-time tracking → auto-downgrade (bucketed rolling average).
    this.frameSumMs += dt * 1000;
    this.frameCount++;
    this.elapsedS += dt;
    if (this.elapsedS >= SAMPLE_WINDOW_S) {
      const avg = this.frameSumMs / this.frameCount;
      if (
        this.mode === 'auto' &&
        this._tier === 'high' &&
        !this.downgraded &&
        avg > AUTO_QUALITY_FRAME_MS
      ) {
        this.downgraded = true;
        console.warn(
          `[Renderer] avg frame ${avg.toFixed(1)}ms > ${AUTO_QUALITY_FRAME_MS}ms — dropping to mobile tier`,
        );
        this.applyTier('mobile');
      }
      this.frameSumMs = 0;
      this.frameCount = 0;
      this.elapsedS = 0;
    }

    if (this._tier === 'high' && this.bloom) {
      this.bloom.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  onResize(): void {
    // visualViewport can report odd values mid-gesture on iOS; innerWidth/
    // innerHeight are the stable full-viewport size we want.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cap = this._tier === 'mobile' ? DPR_CAP_MOBILE : DPR_CAP_DESKTOP;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    // updateStyle = false: the canvas display size is owned by CSS (#game).
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bloom?.setSize(w, h);
  }

  private buildBloom(): void {
    if (!this.bloom) this.bloom = new Bloom(this.renderer, this.scene, this.camera);
  }

  private applyTier(tier: QualityTier): void {
    this._tier = tier;
    if (tier === 'high') {
      this.buildBloom();
    } else if (this.bloom) {
      this.bloom.dispose();
      this.bloom = null;
    }
    // Re-derive DPR cap + buffer sizes (and bloom size) for the new tier.
    this.onResize();
  }
}
