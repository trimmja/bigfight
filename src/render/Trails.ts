/**
 * Motion-trail ribbons for fast movers (dashes, projectiles, weapon swings).
 * A fixed pool of triangle-strip meshes, each built from a short ring buffer of
 * positions and faded to transparent toward the tail. Additive, depth-write
 * off. Geometry is rebuilt in place every frame — no per-frame allocations.
 */
import * as THREE from 'three';

const POOL = 16;
/** Ring-buffer length (positions) per trail. */
const SEG = 16;
const VERTS = SEG * 2;
/** Seconds for an inactive trail to fade its remaining segments away. */
const FADE_TIME = 0.25;

/** Caller-facing control for one acquired trail. */
export interface TrailHandle {
  /** Append a world-space point to the head of the trail. */
  push(x: number, y: number, z: number): void;
  /** Active trails render at full alpha; inactive ones fade their tail out. */
  setActive(active: boolean): void;
  /** Return the trail to the pool. */
  release(): void;
}

class Trail {
  readonly src = new Float32Array(SEG * 3); // chronological: [0]=oldest
  count = 0;
  readonly color = new THREE.Color();
  width = 0.5;
  active = false;
  inUse = false;
  fade = 1;

  readonly mesh: THREE.Mesh;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;

  constructor() {
    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('color', this.colAttr);

    // Static index: a quad (2 tris) between each pair of consecutive points.
    const index = new Uint16Array((SEG - 1) * 6);
    for (let k = 0; k < SEG - 1; k++) {
      const a = k * 2;
      const o = k * 6;
      index[o] = a;
      index[o + 1] = a + 1;
      index[o + 2] = a + 2;
      index[o + 3] = a + 1;
      index[o + 4] = a + 3;
      index[o + 5] = a + 2;
    }
    geom.setIndex(new THREE.BufferAttribute(index, 1));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  push(x: number, y: number, z: number): void {
    let idx: number;
    if (this.count < SEG) {
      idx = this.count;
      this.count++;
    } else {
      this.src.copyWithin(0, 3); // drop the oldest point
      idx = SEG - 1;
    }
    const o = idx * 3;
    this.src[o] = x;
    this.src[o + 1] = y;
    this.src[o + 2] = z;
  }

  reset(): void {
    this.count = 0;
    this.active = false;
    this.inUse = false;
    this.fade = 1;
    this.mesh.visible = false;
  }

  /** Rebuild the ribbon from the current points; `dt` drives inactive fade. */
  build(dt: number): void {
    if (this.active) {
      this.fade = 1;
    } else {
      this.fade = Math.max(0, this.fade - dt / FADE_TIME);
    }

    if (this.count < 2 || this.fade <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const src = this.src;
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const cr = this.color.r;
    const cg = this.color.g;
    const cb = this.color.b;
    const half = this.width * 0.5;
    const last = this.count - 1;

    for (let j = 0; j < SEG; j++) {
      const jj = j <= last ? j : last; // collapse unused verts onto the tip
      const o = jj * 3;
      const px = src[o]!;
      const py = src[o + 1]!;
      const pz = src[o + 2]!;

      // Tangent from neighbouring points (in the XY plane).
      const pi = Math.max(jj - 1, 0) * 3;
      const ni = Math.min(jj + 1, last) * 3;
      let dx = src[ni]! - src[pi]!;
      let dy = src[ni + 1]! - src[pi + 1]!;
      const len = Math.hypot(dx, dy);
      if (len > 1e-5) {
        dx /= len;
        dy /= len;
      } else {
        dx = 1;
        dy = 0;
      }
      // Perpendicular offset, screen-plane ribbon.
      const ox = -dy * half;
      const oy = dx * half;

      const v = j * 6;
      pos[v] = px + ox;
      pos[v + 1] = py + oy;
      pos[v + 2] = pz;
      pos[v + 3] = px - ox;
      pos[v + 4] = py - oy;
      pos[v + 5] = pz;

      // Alpha (via additive brightness): full at the head, 0 at the tail.
      const t = jj / last;
      const a = t * t * this.fade;
      const r = cr * a;
      const g = cg * a;
      const b = cb * a;
      col[v] = r;
      col[v + 1] = g;
      col[v + 2] = b;
      col[v + 3] = r;
      col[v + 4] = g;
      col[v + 5] = b;
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

export class Trails {
  private readonly pool: Trail[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const t = new Trail();
      this.pool.push(t);
      scene.add(t.mesh);
    }
  }

  /**
   * Reserve a trail with the given color and ribbon width. If the pool is
   * exhausted the oldest trail is recycled. The returned handle drives it.
   */
  acquire(color: number, width: number): TrailHandle {
    let trail = this.pool.find((t) => !t.inUse);
    if (!trail) trail = this.pool[0]!;
    trail.reset();
    trail.color.setHex(color, THREE.SRGBColorSpace);
    trail.width = width;
    trail.active = true;
    trail.inUse = true;
    return {
      push: (x, y, z) => trail!.push(x, y, z),
      setActive: (active) => {
        trail!.active = active;
      },
      release: () => trail!.reset(),
    };
  }

  /** Rebuild every live trail. Call once per frame. */
  update(dt: number): void {
    for (const t of this.pool) {
      if (t.inUse) t.build(dt);
    }
  }
}
