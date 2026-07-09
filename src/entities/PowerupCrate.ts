import * as THREE from 'three';
import { GRAVITY, POWERUP_DROP_CHANCE, POWERUP_DROP_INTERVAL } from '../config';
import { events } from '../core/events';
import type { PowerupDef, PowerupId } from '../data/types';
import { powerupById } from '../data/powerups';
import { aabbOverlap } from '../physics/collision';
import { makeToonMaterial } from '../render/toon';
import type { WorldCtx } from './Entity';
import type { Player } from './Player';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const MAX_CRATES = 4;
const CRATE_RADIUS = 0.38;
const CRATE_COLLECT_RADIUS = 0.74;
const GROUNDED_DESPAWN = 10;

class PowerupSlot {
  readonly group = new THREE.Group();

  id: PowerupId = 'healOrb';
  active = false;
  x = 0;
  y = 0;
  vy = 0;

  private readonly materials: THREE.Material[] = [];
  private readonly crateMat: THREE.MeshToonMaterial;
  private readonly bandMat: THREE.MeshToonMaterial;
  private readonly colorMat: THREE.MeshToonMaterial;
  private readonly glowMat: THREE.MeshToonMaterial;
  private grounded = false;
  private groundedTimer = 0;
  private age = 0;

  constructor() {
    this.crateMat = this.makeToon(0xffd36b);
    this.bandMat = this.makeToon(0xffffff);
    this.colorMat = this.makeToon(0x58ff7d);
    this.glowMat = this.makeToon(0x58ff7d);
    this.glowMat.transparent = true;
    this.glowMat.opacity = 0.34;
    this.glowMat.depthWrite = false;

    const crate = new THREE.Mesh(BOX, this.crateMat);
    crate.scale.set(0.42, 0.42, 0.42);
    this.group.add(crate);

    const bandA = new THREE.Mesh(BOX, this.bandMat);
    bandA.scale.set(0.46, 0.09, 0.46);
    this.group.add(bandA);

    const bandB = new THREE.Mesh(BOX, this.bandMat);
    bandB.scale.set(0.09, 0.46, 0.46);
    this.group.add(bandB);

    const core = new THREE.Mesh(SPHERE, this.colorMat);
    core.scale.setScalar(0.18);
    core.position.y = 0.02;
    this.group.add(core);

    const glow = new THREE.Mesh(SPHERE, this.glowMat);
    glow.scale.setScalar(0.64);
    this.group.add(glow);

    const chute = new THREE.Mesh(CYLINDER, this.bandMat);
    chute.scale.set(0.34, 0.035, 0.34);
    chute.position.y = 0.52;
    this.group.add(chute);

    this.group.visible = false;
  }

  spawn(def: PowerupDef, x: number, y: number): void {
    this.id = def.id;
    this.active = true;
    this.x = x;
    this.y = y;
    this.vy = -1.5;
    this.grounded = false;
    this.groundedTimer = 0;
    this.age = 0;
    this.colorMat.color.setHex(def.color, THREE.SRGBColorSpace);
    this.glowMat.color.setHex(def.color, THREE.SRGBColorSpace);
    this.glowMat.emissive.setHex(def.color);
    this.group.visible = true;
    this.syncVisual();
  }

  update(ctx: WorldCtx, dt: number, player: Player): boolean {
    if (!this.active) return false;
    this.age += dt;
    if (!this.grounded) {
      const prevY = this.y;
      this.vy += GRAVITY * 0.22 * dt;
      if (this.vy < -4.5) this.vy = -4.5;
      this.y += this.vy * dt;
      this.checkGround(ctx, prevY);
    } else {
      this.groundedTimer += dt;
      this.vy = 0;
      if (this.groundedTimer >= GROUNDED_DESPAWN) return false;
    }

    if (this.touches(player)) {
      const def = powerupById(this.id);
      events.emit('powerup', { id: this.id, pos: { x: this.x, y: this.y } });
      ctx.particles.burst(this.x, this.y, def.color, 34, 7);
      player.applyPowerup(def);
      return false;
    }

    this.syncVisual();
    return true;
  }

  deactivate(): void {
    this.active = false;
    this.group.visible = false;
    this.x = 0;
    this.y = -999;
    this.vy = 0;
    this.grounded = false;
    this.groundedTimer = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (let i = 0; i < this.materials.length; i += 1) this.materials[i]!.dispose();
  }

  private checkGround(ctx: WorldCtx, prevY: number): void {
    const minX = this.x - CRATE_RADIUS;
    const maxX = this.x + CRATE_RADIUS;
    const minY = this.y - CRATE_RADIUS;
    const maxY = this.y + CRATE_RADIUS;
    const solids = ctx.stage.colliders.solids;
    for (let i = 0; i < solids.length; i += 1) {
      const s = solids[i]!;
      if (!aabbOverlap(minX, maxX, minY, maxY, s.minX, s.maxX, s.minY, s.maxY)) continue;
      if (prevY - CRATE_RADIUS >= s.maxY) {
        this.y = s.maxY + CRATE_RADIUS;
        this.grounded = true;
        return;
      }
    }
    const oneWays = ctx.stage.colliders.oneWays;
    const prevBottom = prevY - CRATE_RADIUS;
    const bottom = this.y - CRATE_RADIUS;
    for (let i = 0; i < oneWays.length; i += 1) {
      const p = oneWays[i]!;
      if (maxX <= p.minX || minX >= p.maxX) continue;
      if (prevBottom >= p.y && bottom <= p.y) {
        this.y = p.y + CRATE_RADIUS;
        this.grounded = true;
        return;
      }
    }
  }

  private touches(player: Player): boolean {
    if (!player.alive) return false;
    const dx = Math.abs(player.body.pos.x - this.x);
    const playerY = player.body.pos.y + player.body.height * 0.5;
    const dy = Math.abs(playerY - this.y);
    return dx <= player.body.halfW + CRATE_COLLECT_RADIUS && dy <= player.body.height * 0.5 + CRATE_COLLECT_RADIUS;
  }

  private syncVisual(): void {
    this.group.position.set(this.x, this.y, 0.42);
    this.group.rotation.y += 0.05;
    this.group.rotation.z = Math.sin(this.age * 3) * 0.08;
  }

  private makeToon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push(material);
    return material;
  }
}

export class PowerupSpawner {
  private readonly slots: PowerupSlot[] = [];
  private dropTimer = POWERUP_DROP_INTERVAL * 0.55;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly unlockedIds: readonly PowerupId[],
  ) {
    for (let i = 0; i < MAX_CRATES; i += 1) {
      const slot = new PowerupSlot();
      this.slots.push(slot);
      this.scene.add(slot.group);
    }
  }

  update(ctx: WorldCtx, dt: number, player: Player): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i]!;
      if (!slot.active) continue;
      if (slot.update(ctx, dt, player)) continue;
      slot.deactivate();
    }

    if (this.unlockedIds.length === 0) return;
    this.dropTimer = Math.max(0, this.dropTimer - dt);
    if (this.dropTimer > 0) return;
    this.dropTimer = POWERUP_DROP_INTERVAL;
    if (Math.random() > POWERUP_DROP_CHANCE) return;
    this.spawn(ctx);
  }

  dispose(): void {
    for (let i = 0; i < this.slots.length; i += 1) this.slots[i]!.dispose();
    this.slots.length = 0;
  }

  private spawn(ctx: WorldCtx): void {
    let slot: PowerupSlot | null = null;
    for (let i = 0; i < this.slots.length; i += 1) {
      const candidate = this.slots[i]!;
      if (candidate.active) continue;
      slot = candidate;
      break;
    }
    if (!slot) return;
    const id = this.unlockedIds[Math.floor(Math.random() * this.unlockedIds.length)];
    if (!id) return;
    const blast = ctx.stage.blast;
    const margin = 1.5;
    const x = blast.left + margin + Math.random() * Math.max(1, blast.right - blast.left - margin * 2);
    const y = blast.top - 1;
    slot.spawn(powerupById(id), x, y);
  }
}
