/**
 * Bloom post-processing chain for the high-quality tier. Scene → bloom →
 * output (tone-map + sRGB). The bloom blur runs at half the drawing-buffer
 * resolution for a soft neon glow that stays cheap on mobile GPUs.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD } from '../config';

export class Bloom {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly size = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Half drawing-buffer resolution for the bloom's internal blur targets.
    renderer.getDrawingBufferSize(this.size);
    const res = new THREE.Vector2(this.size.x * 0.5, this.size.y * 0.5);
    this.bloomPass = new UnrealBloomPass(res, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // Match composer buffers to the current CSS size.
    const s = renderer.getSize(this.size);
    this.composer.setSize(s.x, s.y);
  }

  /** Render the scene through the bloom composer. */
  render(): void {
    this.composer.render();
  }

  /** Resize composer buffers and re-derive the half-res bloom target. */
  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.renderer.getDrawingBufferSize(this.size);
    this.bloomPass.setSize(this.size.x * 0.5, this.size.y * 0.5);
  }

  /** Free all GPU render targets owned by the chain. */
  dispose(): void {
    this.composer.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
  }
}
