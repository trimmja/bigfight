/**
 * GPU-friendly particle system: a single THREE.Points backed by preallocated
 * buffers and a ring-buffer allocator. Zero allocations per frame — bursts
 * only overwrite existing slots. Additive glow-disc sprites, vertex-colored,
 * size-attenuated. Dead particles fade their color to black (invisible under
 * additive blending) so no per-particle size channel is needed.
 */
import * as THREE from 'three';
import { POOL_PARTICLES } from '../config';
import { makeGlowDisc } from './textures';

/** Mild downward pull; lighter than gameplay gravity so sparks hang a touch. */
const PARTICLE_GRAVITY = -9;
const PARTICLE_SIZE = 0.55;
const TWO_PI = Math.PI * 2;

export class Particles {
  private readonly points: THREE.Points;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly base: Float32Array;
  private readonly vel: Float32Array; // vx, vy per particle
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly n = POOL_PARTICLES;
  private head = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const n = this.n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 2);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);

    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('color', this.colAttr);

    const mat = new THREE.PointsMaterial({
      size: PARTICLE_SIZE,
      map: makeGlowDisc(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });

    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Integrate velocity + gravity + life fade. Call once per frame. */
  update(dt: number): void {
    const { pos, col, base, vel, life, maxLife, n } = this;
    for (let i = 0; i < n; i++) {
      const l = life[i]!;
      if (l <= 0) continue;
      const nl = l - dt;
      const i3 = i * 3;
      if (nl <= 0) {
        // Normal blending can't fade via darkening (black shows on bright
        // skies) — dead confetti pops out crisply and parks far offscreen.
        life[i] = 0;
        pos[i3 + 1] = -9999;
        continue;
      }
      const i2 = i * 2;
      let vy = vel[i2 + 1]! + PARTICLE_GRAVITY * dt;
      vel[i2 + 1] = vy;
      pos[i3] = pos[i3]! + vel[i2]! * dt;
      pos[i3 + 1] = pos[i3 + 1]! + vy * dt;
      life[i] = nl;
      // Last 20% of life: blend toward white so the pop-out reads as a puff.
      const f = nl / maxLife[i]!;
      const w = f > 0.2 ? 0 : 1 - f * 5;
      col[i3] = base[i3]! + (1 - base[i3]!) * w;
      col[i3 + 1] = base[i3 + 1]! + (1 - base[i3 + 1]!) * w;
      col[i3 + 2] = base[i3 + 2]! + (1 - base[i3 + 2]!) * w;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  /** Omnidirectional burst of `count` particles from (x, y). */
  burst(x: number, y: number, color: number, count: number, speed: number): void {
    this.tmpColor.setHex(color, THREE.SRGBColorSpace);
    const r = this.tmpColor.r;
    const g = this.tmpColor.g;
    const b = this.tmpColor.b;
    for (let k = 0; k < count; k++) {
      const a = Math.random() * TWO_PI;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.4 + Math.random() * 0.5, r, g, b);
    }
  }

  /** Cone of `count` particles from (x, y) biased along (dirX, dirY). */
  directional(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    color: number,
    count: number,
    speed: number,
  ): void {
    this.tmpColor.setHex(color, THREE.SRGBColorSpace);
    const r = this.tmpColor.r;
    const g = this.tmpColor.g;
    const b = this.tmpColor.b;
    const baseA = Math.atan2(dirY, dirX);
    for (let k = 0; k < count; k++) {
      const a = baseA + (Math.random() - 0.5) * 0.8;
      const s = speed * (0.5 + Math.random() * 0.6);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.45, r, g, b);
    }
  }

  /** Even-angled expanding shockwave ring — reads as a clean blast wave. */
  ring(x: number, y: number, color: number, count: number, speed: number): void {
    this.tmpColor.setHex(color, THREE.SRGBColorSpace);
    const r = this.tmpColor.r;
    const g = this.tmpColor.g;
    const b = this.tmpColor.b;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TWO_PI;
      const s = speed * (0.9 + Math.random() * 0.2);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.4 + Math.random() * 0.4, r, g, b);
    }
  }

  /**
   * Big layered ability blast: a shockwave ring in `accent`, a dense omni cloud
   * in `color`, and a spray of fast white sparks — "particles everywhere".
   */
  blast(x: number, y: number, color: number, accent: number, scale: number): void {
    this.ring(x, y, accent, Math.round(14 + scale * 10), 7 + scale * 3);
    this.burst(x, y, color, Math.round(18 + scale * 16), 6 + scale * 3);
    this.burst(x, y, 0xffffff, Math.round(6 + scale * 6), 10 + scale * 4);
  }

  /** KO pop: a big fast radial burst plus a few slow, long-lived sparks. */
  koExplosion(x: number, y: number, color: number): void {
    this.burst(x, y, color, 60, 12);
    this.tmpColor.setHex(color, THREE.SRGBColorSpace);
    const r = this.tmpColor.r;
    const g = this.tmpColor.g;
    const b = this.tmpColor.b;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * TWO_PI;
      const s = 1 + Math.random() * 2.5;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.9 + Math.random() * 0.7, r, g, b);
    }
  }

  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const i = this.head;
    this.head = (i + 1) % this.n;
    const i3 = i * 3;
    const i2 = i * 2;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = 0;
    this.vel[i2] = vx;
    this.vel[i2 + 1] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.base[i3] = r;
    this.base[i3 + 1] = g;
    this.base[i3 + 2] = b;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
  }
}
