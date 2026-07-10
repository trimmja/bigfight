import * as THREE from 'three';
import { atan2, sin } from '../core/simmath';
import type { AttackDef, ProjectileDef, SidekickDef } from '../data/types';
import { Body } from '../physics/Body';
import { attachGlow } from '../render/GlowSprites';
import { makeToonMaterial } from '../render/toon';
import { Entity, type WorldCtx } from './Entity';
import type { Fighter } from './Fighter';
import type { Player } from './Player';
import type { ProjectileManager } from './Projectile';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const CONE = new THREE.ConeGeometry(1, 1, 18);

const FIRE_RANGE = 14;
const FIRE_RANGE_SQ = FIRE_RANGE * FIRE_RANGE;
const SPRING = 42;
const DAMPING = 12;

type RigParts = {
  rotor?: THREE.Object3D;
  wingL?: THREE.Object3D;
  wingR?: THREE.Object3D;
  bobRoot: THREE.Group;
};

export class Sidekick extends Entity {
  private readonly materials: THREE.Material[] = [];
  private readonly attack: AttackDef;
  private readonly aimProjectile: ProjectileDef;
  private readonly rigParts: RigParts;
  private fireTimer = 0.45;
  private animTime = 0;
  private recoil = 0;

  constructor(
    private readonly def: SidekickDef,
    private readonly owner: Player,
    private readonly projectiles: ProjectileManager,
    private readonly getTargets: () => readonly Fighter[],
  ) {
    const body = new Body(0.24, 0.5);
    body.noclip = true;
    body.gravityScale = 0;
    const group = new THREE.Group();
    super(body, group);
    this.attack = {
      id: `${def.id}Attack`,
      damage: def.attack.damage,
      baseKb: def.attack.baseKb,
      kbGrowth: def.attack.kbGrowth,
      angleDeg: def.attack.angleDeg,
      windup: 0,
      active: 0.08,
      recover: 0,
      hitbox: { x: 0, y: 0, w: 0, h: 0 },
      sfx: 'shoot',
      poseId: 'shoot',
      projectile: def.projectile,
    };
    this.aimProjectile = { ...def.projectile };
    this.rigParts = this.buildRig(def);
    this.group.visible = false;
  }

  update(ctx: WorldCtx, dt: number): void {
    this.animTime += dt;
    if (!this.owner.alive) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.updateHover(dt);
    this.updateAnimation(dt);
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    if (this.fireTimer > 0) return;
    const target = this.findTarget();
    if (!target) return;
    this.fireAt(ctx, target);
    this.fireTimer = this.def.fireInterval;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (let i = 0; i < this.materials.length; i += 1) this.materials[i]!.dispose();
  }

  private updateHover(dt: number): void {
    const owner = this.owner;
    const behind = -owner.facing;
    // simmath.sin: hover position feeds projectile spawn points — sim state.
    const bob = sin(this.animTime * 3.2) * 0.16 + this.recoil;
    const targetX = owner.body.pos.x + behind * 1.18;
    const targetY = owner.body.pos.y + owner.body.height * 0.8 + 0.55 + bob;
    const dx = targetX - this.body.pos.x;
    const dy = targetY - this.body.pos.y;
    this.body.vel.x += dx * SPRING * dt;
    this.body.vel.y += dy * SPRING * dt;
    this.body.vel.x -= this.body.vel.x * DAMPING * dt;
    this.body.vel.y -= this.body.vel.y * DAMPING * dt;
    this.body.pos.x += this.body.vel.x * dt;
    this.body.pos.y += this.body.vel.y * dt;
    this.recoil = Math.max(0, this.recoil - dt * 1.8);
    this.group.position.set(this.body.pos.x, this.body.pos.y, 0.45);
    this.group.scale.x = owner.facing;
  }

  private updateAnimation(dt: number): void {
    const rotor = this.rigParts.rotor;
    if (rotor) rotor.rotation.y += dt * 24;
    const wingL = this.rigParts.wingL;
    const wingR = this.rigParts.wingR;
    if (wingL && wingR) {
      const flap = Math.sin(this.animTime * 12) * 0.55; // det-ok: view-only
      wingL.rotation.x = -0.35 + flap;
      wingR.rotation.x = 0.35 - flap;
    }
    this.rigParts.bobRoot.rotation.z = Math.sin(this.animTime * 2.4) * 0.08; // det-ok: view-only
  }

  private findTarget(): Fighter | null {
    const targets = this.getTargets();
    let best: Fighter | null = null;
    let bestDist = FIRE_RANGE_SQ;
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i]!;
      if (!target.alive || target.teamId === this.owner.teamId) continue;
      const dx = target.body.pos.x - this.body.pos.x;
      const dy = target.body.pos.y + target.body.height * 0.5 - this.body.pos.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = target;
      }
    }
    return best;
  }

  private fireAt(ctx: WorldCtx, target: Fighter): void {
    const dx = target.body.pos.x - this.body.pos.x;
    const dy = target.body.pos.y + target.body.height * 0.55 - this.body.pos.y;
    const facing = dx >= 0 ? 1 : -1;
    this.aimProjectile.angleDeg = Math.max(0, Math.min(80, atan2(dy, Math.max(0.05, Math.abs(dx))) * 180 / Math.PI));
    this.attack.angleDeg = this.def.attack.angleDeg;
    this.projectiles.fire(
      this.aimProjectile,
      this.body.pos.x + facing * 0.28,
      this.body.pos.y,
      facing,
      this.owner.faction,
      this.owner.teamId,
      1,
      this.attack,
      this.owner.slotIndex,
    );
    ctx.particles.directional(this.body.pos.x, this.body.pos.y, -facing, 0.2, this.def.palette.glow, 8, 3.5);
    this.recoil = 0.24;
  }

  private buildRig(def: SidekickDef): RigParts {
    const bobRoot = new THREE.Group();
    this.group.add(bobRoot);
    switch (def.builder) {
      case 'drone':
        return this.buildDrone(bobRoot, def);
      case 'dragon':
        return this.buildDragon(bobRoot, def);
      case 'ghostBuddy':
        return this.buildGhost(bobRoot, def);
    }
  }

  private buildDrone(root: THREE.Group, def: SidekickDef): RigParts {
    const body = this.makeToon(def.palette.core);
    const glow = this.makeToon(def.palette.glow);
    const white = this.makeToon(0xffffff);
    const dark = this.makeToon(0x252836);
    addBox(root, body, 0.34, 0.28, 0.3, 0, 0, 0);
    addSphere(root, glow, 0.12, 0.12, 0.12, 0.18, 0.08, -0.17);
    addSphere(root, glow, 0.12, 0.12, 0.12, 0.18, 0.08, 0.17);
    addSphere(root, white, 0.085, 0.075, 0.05, 0.23, 0.04, -0.08);
    addSphere(root, white, 0.085, 0.075, 0.05, 0.23, 0.04, 0.08);
    addSphere(root, dark, 0.035, 0.035, 0.025, 0.28, 0.04, -0.08);
    addSphere(root, dark, 0.035, 0.035, 0.025, 0.28, 0.04, 0.08);
    const rotor = addCylinder(root, glow, 0.28, 0.03, -0.02, 0.28, 0);
    rotor.rotation.x = Math.PI / 2;
    attachGlow(root, def.palette.glow, 0.7, 0.38);
    return { bobRoot: root, rotor };
  }

  private buildDragon(root: THREE.Group, def: SidekickDef): RigParts {
    const body = this.makeToon(def.palette.core);
    const wing = this.makeToon(def.palette.glow);
    const accent = this.makeToon(def.palette.accent);
    const white = this.makeToon(0xffffff);
    const dark = this.makeToon(0x252836);
    addSphere(root, body, 0.28, 0.22, 0.24, 0, 0, 0);
    const snout = addCone(root, accent, 0.11, 0.24, 0.28, 0.04, 0);
    snout.rotation.z = -Math.PI / 2;
    const wingL = addCone(root, wing, 0.18, 0.36, -0.05, 0.04, -0.28, 0.8);
    const wingR = addCone(root, wing, 0.18, 0.36, -0.05, 0.04, 0.28, -0.8);
    addCone(root, accent, 0.08, 0.2, -0.24, -0.02, 0, Math.PI / 2);
    addSphere(root, white, 0.07, 0.07, 0.04, 0.2, 0.12, -0.08);
    addSphere(root, white, 0.07, 0.07, 0.04, 0.2, 0.12, 0.08);
    addSphere(root, dark, 0.028, 0.028, 0.02, 0.25, 0.12, -0.08);
    addSphere(root, dark, 0.028, 0.028, 0.02, 0.25, 0.12, 0.08);
    return { bobRoot: root, wingL, wingR };
  }

  private buildGhost(root: THREE.Group, def: SidekickDef): RigParts {
    const body = this.makeToon(def.palette.core);
    body.transparent = true;
    body.opacity = 0.84;
    body.depthWrite = false;
    const accent = this.makeToon(def.palette.glow);
    accent.transparent = true;
    accent.opacity = 0.76;
    accent.depthWrite = false;
    const white = this.makeToon(0xffffff);
    const dark = this.makeToon(0x252836);
    addSphere(root, body, 0.26, 0.26, 0.22, 0, 0.05, 0);
    const skirt = addCone(root, accent, 0.25, 0.32, 0, -0.16, 0, Math.PI);
    skirt.scale.z = 0.9;
    for (let i = 0; i < 3; i += 1) {
      addSphere(root, body, 0.08, 0.08, 0.07, -0.08 + i * 0.08, -0.32, (i - 1) * 0.12);
    }
    addSphere(root, white, 0.065, 0.07, 0.035, 0.18, 0.1, -0.07);
    addSphere(root, white, 0.065, 0.07, 0.035, 0.18, 0.1, 0.07);
    addSphere(root, dark, 0.026, 0.032, 0.018, 0.23, 0.1, -0.07);
    addSphere(root, dark, 0.026, 0.032, 0.018, 0.23, 0.1, 0.07);
    attachGlow(root, def.palette.glow, 0.8, 0.5);
    return { bobRoot: root };
  }

  private makeToon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push(material);
    return material;
  }
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addSphere(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(SPHERE, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CYLINDER, material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addCone(
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CONE, material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotZ;
  parent.add(mesh);
  return mesh;
}
