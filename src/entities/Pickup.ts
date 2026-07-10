import * as THREE from 'three';
import { GOLD_DROP_VARIANCE, PICKUP_MAGNET_RADIUS, POOL_PICKUPS } from '../config';
import { events } from '../core/events';
import { Pool } from '../core/pool';
import type { SimRng } from '../core/rng';
import { exp, hypot } from '../core/simmath';
import { simPhase } from '../net/simPhase';
import type { EnemyDef, MaterialId } from '../data/types';
import { Body } from '../physics/Body';
import { makeToonMaterial } from '../render/toon';
import type { WorldCtx } from './Entity';
import { Entity } from './Entity';
import type { Fighter } from './Fighter';

type PickupKind = 'gold' | 'material';
type PickupMaterials = {
  coin: THREE.MeshToonMaterial;
  gems: Record<MaterialId, THREE.MeshToonMaterial>;
};

const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const OCTAHEDRON = new THREE.OctahedronGeometry(1, 0);
const MATERIAL_IDS: readonly MaterialId[] = [
  'boneShard',
  'slimeGoo',
  'ghostEssence',
  'feather',
  'energyCore',
];
const MATERIAL_COLORS: Record<MaterialId, number> = {
  boneShard: 0xfff6df,
  slimeGoo: 0x55dc64,
  ghostEssence: 0xbfe8ff,
  feather: 0xff9b30,
  energyCore: 0xff5adf,
};
const MAGNET_RADIUS_SQ = PICKUP_MAGNET_RADIUS * PICKUP_MAGNET_RADIUS;
const COLLECT_RADIUS_SQ = 0.34 * 0.34;
const MAGNET_ACCEL = 90;
const MAGNET_MAX_SPEED = 30;
const POP_X = 3.2;
const POP_Y_MIN = 5.6;
const POP_Y_MAX = 8.2;

export class Pickup extends Entity {
  kind: PickupKind = 'gold';
  goldValue = 0;
  materialId: MaterialId | null = null;

  private readonly coin: THREE.Mesh;
  private readonly gem: THREE.Mesh;
  private bouncesRemaining = 1;
  private wasGrounded = false;
  private magnetized = false;
  /** Once magnetized, locked to ONE player until collected (no mid-flight jitter). */
  private magnetTarget: Fighter | null = null;

  constructor(private readonly materials: PickupMaterials) {
    const body = new Body(0.18, 0.34);
    const group = new THREE.Group();
    super(body, group);

    this.coin = new THREE.Mesh(CYLINDER, materials.coin);
    this.coin.scale.set(0.18, 0.055, 0.18);
    this.coin.rotation.x = Math.PI / 2;
    group.add(this.coin);

    this.gem = new THREE.Mesh(OCTAHEDRON, materials.gems.boneShard);
    this.gem.scale.setScalar(0.2);
    group.add(this.gem);

    this.deactivate();
  }

  spawnGold(value: number, x: number, y: number, vx: number, vy: number): void {
    this.kind = 'gold';
    this.goldValue = value;
    this.materialId = null;
    this.coin.visible = true;
    this.gem.visible = false;
    this.activate(x, y, vx, vy);
  }

  spawnMaterial(material: MaterialId, x: number, y: number, vx: number, vy: number): void {
    this.kind = 'material';
    this.goldValue = 0;
    this.materialId = material;
    this.coin.visible = false;
    this.gem.visible = true;
    this.gem.material = this.materials.gems[material];
    this.activate(x, y, vx, vy);
  }

  update(_ctx: WorldCtx, dt: number): void {
    if (!this.alive) return;
    if (!simPhase.resimulating) this.syncVisual(dt);
  }

  updatePickup(dt: number, players: readonly Fighter[]): boolean {
    if (!this.alive) return false;

    if (!this.magnetized && this.body.grounded && !this.wasGrounded && this.bouncesRemaining > 0) {
      this.body.vel.y = 3.8;
      this.body.vel.x *= 0.55;
      this.body.grounded = false;
      this.bouncesRemaining -= 1;
    }

    // Fly to the locked target while it's alive; otherwise the nearest player.
    let player = this.magnetTarget?.alive === true ? this.magnetTarget : null;
    if (!player) {
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < players.length; i += 1) {
        const candidate = players[i]!;
        if (!candidate.alive) continue;
        const cdx = candidate.body.pos.x - this.body.pos.x;
        const cdy = candidate.body.pos.y - this.body.pos.y;
        const d = cdx * cdx + cdy * cdy;
        if (d < bestDist) {
          bestDist = d;
          player = candidate;
        }
      }
    }
    if (!player) {
      this.wasGrounded = this.body.grounded;
      if (!simPhase.resimulating) this.syncVisual(dt);
      return false;
    }

    const targetX = player.body.pos.x;
    const targetY = player.body.pos.y + player.body.height * 0.55;
    const itemY = this.body.pos.y + this.body.height * 0.5;
    let dx = targetX - this.body.pos.x;
    let dy = targetY - itemY;
    const distSq = dx * dx + dy * dy;

    const dist = Math.sqrt(Math.max(0.0001, distSq));
    const speed = hypot(this.body.vel.x, this.body.vel.y);
    // Collect on contact — or when we'd tunnel PAST the player this step
    // (fast magnetized pickups used to overshoot and orbit forever).
    if (distSq <= COLLECT_RADIUS_SQ || (this.magnetized && dist <= speed * dt * 1.5)) {
      if (!simPhase.resimulating) this.syncVisual(dt);
      return true;
    }

    if (this.magnetized || distSq <= MAGNET_RADIUS_SQ) {
      this.magnetized = true;
      this.magnetTarget = player;
      this.body.noclip = true;
      this.body.gravityScale = 0;
      dx /= dist;
      dy /= dist;
      // Steer velocity AT the player (blend toward the ideal heading) instead
      // of accelerating — pure acceleration preserves tangential velocity,
      // which is exactly an orbit.
      const targetSpeed = Math.min(MAGNET_MAX_SPEED, 6 + speed + MAGNET_ACCEL * dt);
      const k = 1 - exp(-14 * dt);
      this.body.vel.x += (dx * targetSpeed - this.body.vel.x) * k;
      this.body.vel.y += (dy * targetSpeed - this.body.vel.y) * k;
    }

    this.wasGrounded = this.body.grounded;
    if (!simPhase.resimulating) this.syncVisual(dt);
    return false;
  }

  forceMagnetize(): void {
    this.magnetized = true;
    this.body.noclip = true;
    this.body.gravityScale = 0;
  }

  /** Sim-relevant scalars for replay digests / net snapshots. */
  digestInto(out: number[]): void {
    out.push(
      this.body.pos.x,
      this.body.pos.y,
      this.body.vel.x,
      this.body.vel.y,
      this.kind === 'gold' ? 0 : 1,
      this.goldValue,
      this.bouncesRemaining,
      this.magnetized ? 1 : 0,
      this.wasGrounded ? 1 : 0,
      this.magnetTarget ? this.magnetTarget.id : -1,
    );
  }

  deactivate(): void {
    this.alive = false;
    this.group.visible = false;
    this.body.pos.x = 0;
    this.body.pos.y = -999;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.noclip = true;
    this.body.gravityScale = 0;
    this.body.grounded = false;
    this.wasGrounded = false;
    this.magnetized = false;
    this.magnetTarget = null;
  }

  private activate(x: number, y: number, vx: number, vy: number): void {
    this.alive = true;
    this.group.visible = true;
    this.body.pos.x = x;
    this.body.pos.y = y;
    this.body.vel.x = vx;
    this.body.vel.y = vy;
    this.body.noclip = false;
    this.body.gravityScale = 0.85;
    this.body.grounded = false;
    this.bouncesRemaining = 1;
    this.wasGrounded = false;
    this.magnetized = false;
    this.group.position.set(x, y + this.body.height * 0.5, 0.18);
  }

  private syncVisual(dt: number): void {
    this.group.position.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.5, 0.18);
    this.group.rotation.y += dt * (this.kind === 'gold' ? 10 : 6);
    this.gem.rotation.x += dt * 3.5;
  }
}

export class PickupManager {
  private readonly materials: PickupMaterials;
  private readonly pool: Pool<Pickup>;
  private readonly active: Pickup[] = [];
  private readonly all: readonly Pickup[];

  constructor(
    private readonly scene: THREE.Scene,
    /** Sim rng (`drops` stream): gold variance + pop velocities are sim state. */
    private readonly rng: SimRng,
    /**
     * DIRECT sim-credit callback — the ONLY path that mutates match totals.
     * (The `loot` event still fires for audio/UI but is suppressed during
     * rollback resim; a suppressed event must never carry sim mutations.)
     */
    private readonly onLoot: (gold: number, material?: MaterialId) => void,
  ) {
    this.materials = {
      coin: makeToonMaterial(0xffd23e),
      gems: {
        boneShard: makeToonMaterial(MATERIAL_COLORS.boneShard),
        slimeGoo: makeToonMaterial(MATERIAL_COLORS.slimeGoo),
        ghostEssence: makeToonMaterial(MATERIAL_COLORS.ghostEssence),
        feather: makeToonMaterial(MATERIAL_COLORS.feather),
        energyCore: makeToonMaterial(MATERIAL_COLORS.energyCore),
      },
    };
    this.pool = new Pool(
      () => {
        const pickup = new Pickup(this.materials);
        this.scene.add(pickup.group);
        return pickup;
      },
      POOL_PICKUPS,
      (pickup) => pickup.deactivate(),
    );
    this.all = this.pool.all;
  }

  spawnDrops(def: EnemyDef, x: number, y: number): void {
    const variance = 1 + (this.rng.next() * 2 - 1) * GOLD_DROP_VARIANCE;
    const gold = Math.max(1, Math.round(def.gold * variance));
    this.spawnGold(gold, x, y);
    for (let i = 0; i < MATERIAL_IDS.length; i += 1) {
      const material = MATERIAL_IDS[i]!;
      const count = def.drops[material] ?? 0;
      for (let n = 0; n < count; n += 1) this.spawnMaterial(material, x, y);
    }
  }

  spawnGold(value: number, x: number, y: number): void {
    const pickup = this.pool.obtain();
    if (!pickup) {
      // Pool exhausted — loot must never be lost: bank it instantly.
      this.onLoot(value);
      events.emit('loot', { gold: value });
      return;
    }
    const vx = (this.rng.next() * 2 - 1) * POP_X;
    const vy = POP_Y_MIN + this.rng.next() * (POP_Y_MAX - POP_Y_MIN);
    pickup.spawnGold(value, x, y, vx, vy);
    this.active.push(pickup);
  }

  spawnMaterial(material: MaterialId, x: number, y: number): void {
    const pickup = this.pool.obtain();
    if (!pickup) {
      this.onLoot(0, material);
      events.emit('loot', { gold: 0, material });
      return;
    }
    const vx = (this.rng.next() * 2 - 1) * POP_X;
    const vy = POP_Y_MIN + this.rng.next() * (POP_Y_MAX - POP_Y_MIN);
    pickup.spawnMaterial(material, x, y, vx, vy);
    this.active.push(pickup);
  }

  collectBodies(out: Body[]): void {
    for (let i = 0; i < this.active.length; i += 1) {
      const pickup = this.active[i]!;
      if (pickup.alive) out.push(pickup.body);
    }
  }

  /** Force-magnetize every live pickup (wave/level clear vacuum — no loot left behind). */
  vacuumAll(): void {
    for (let i = 0; i < this.active.length; i += 1) {
      const pickup = this.active[i]!;
      if (pickup.alive) pickup.forceMagnetize();
    }
  }

  update(ctx: WorldCtx, dt: number, players: readonly Fighter[]): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const pickup = this.active[i]!;
      pickup.update(ctx, dt);
      if (!pickup.updatePickup(dt, players)) continue;
      if (pickup.kind === 'gold') {
        this.onLoot(pickup.goldValue);
        events.emit('loot', { gold: pickup.goldValue });
      } else if (pickup.materialId) {
        this.onLoot(0, pickup.materialId);
        events.emit('loot', { gold: 0, material: pickup.materialId });
      }
      this.releaseAt(i);
    }
  }

  /**
   * Instantly credit every live pickup as collected loot (with its little
   * pickup chime). Called when the level result is tallied so coins still
   * flying toward the player are never lost.
   */
  bankAll(): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const pickup = this.active[i]!;
      if (!pickup.alive) {
        this.releaseAt(i);
        continue;
      }
      if (pickup.kind === 'gold') {
        this.onLoot(pickup.goldValue);
        events.emit('loot', { gold: pickup.goldValue });
      } else if (pickup.materialId) {
        this.onLoot(0, pickup.materialId);
        events.emit('loot', { gold: 0, material: pickup.materialId });
      }
      this.releaseAt(i);
    }
  }

  releaseAll(): void {
    this.active.length = 0;
    this.pool.releaseAll();
  }

  digestInto(out: number[]): void {
    out.push(this.active.length);
    for (let i = 0; i < this.active.length; i += 1) {
      const pickup = this.active[i]!;
      if (pickup.alive) pickup.digestInto(out);
    }
  }

  dispose(): void {
    this.releaseAll();
    for (let i = 0; i < this.all.length; i += 1) {
      this.scene.remove(this.all[i]!.group);
    }
    this.materials.coin.dispose();
    for (let i = 0; i < MATERIAL_IDS.length; i += 1) {
      this.materials.gems[MATERIAL_IDS[i]!].dispose();
    }
  }

  private releaseAt(index: number): void {
    const pickup = this.active[index]!;
    const last = this.active.pop();
    if (last && index < this.active.length) this.active[index] = last;
    this.pool.release(pickup);
  }
}
