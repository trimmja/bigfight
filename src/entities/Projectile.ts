import * as THREE from 'three';
import { GRAVITY, POOL_PROJECTILES } from '../config';
import type { ActiveHitbox, FighterLike, HitResult, Hurtbox, Rect } from '../combat/types';
import { events } from '../core/events';
import { degToRad } from '../core/math';
import { atan2, cos, hypot, sin } from '../core/simmath';
import { simPhase } from '../net/simPhase';
import { Pool } from '../core/pool';
import type { AttackDef, Faction, Facing, ProjectileDef } from '../data/types';
import { aabbOverlap } from '../physics/collision';
import { attachGlow } from '../render/GlowSprites';
import { makeToonMaterial } from '../render/toon';
import type { WorldCtx } from './Entity';
import type { Fighter } from './Fighter';

type ProjectileVisual = ProjectileDef['visual'];
type ProjectileHitbox = ActiveHitbox & {
  onResolvedHit: () => void;
  stopAfterHit: boolean;
};

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const CONE = new THREE.ConeGeometry(1, 1, 20);
const TORUS = new THREE.TorusGeometry(1, 0.08, 8, 30);
const ARC = new THREE.TorusGeometry(1, 0.09, 8, 24, Math.PI);

const VISUALS: readonly ProjectileVisual[] = [
  'bullet',
  'laser',
  'rocket',
  'bomb',
  'mine',
  'orb',
  'bolt',
  'wave',
  'feather',
  'shockwave',
  'slash',
  'flame',
];
const STICKY_TRIGGER_RADIUS = 1.2;
const STICKY_TRIGGER_RADIUS_SQ = STICKY_TRIGGER_RADIUS * STICKY_TRIGGER_RADIUS;
const EPSILON = 0.0001;

class ProjectileSlot implements FighterLike {
  readonly group = new THREE.Group();
  readonly body = {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    halfW: 0.2,
    height: 0.4,
  };
  readonly hurtbox: Hurtbox;

  faction: Faction = 'player';
  teamId = 1;
  /** Firing player's match slot (-1 = not a player) — KO attribution. */
  slotIndex = -1;
  facing: Facing = 1;
  power = 1;
  weight = 100;
  damage = 0;
  hitstopTimer = 0;

  private readonly rect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly alreadyHit = new Set<object>();
  private readonly hitbox: ProjectileHitbox;
  private readonly attackDef: AttackDef = {
    id: 'projectile',
    damage: 0,
    baseKb: 0,
    kbGrowth: 0,
    angleDeg: 0,
    windup: 0,
    active: 0,
    recover: 0,
    hitbox: { x: 0, y: 0, w: 0, h: 0 },
    sfx: 'shoot',
    poseId: 'shoot',
  };
  private readonly materials: THREE.Material[] = [];
  private readonly primaryMat: THREE.MeshToonMaterial;
  private readonly darkMat: THREE.MeshToonMaterial;
  private readonly whiteMat: THREE.MeshToonMaterial;
  private readonly redMat: THREE.MeshToonMaterial;
  private readonly visuals: Record<ProjectileVisual, THREE.Group>;

  private visual: ProjectileVisual = 'bullet';
  private radius = 0.2;
  private gravityScale = 0;
  private lifetime = 0;
  private age = 0;
  private homingDeg = 0;
  private hp = 0;
  private explodeRadius = 0;
  private sticky = false;
  private piercing = false;
  private trailColor = 0;
  private pullRadius = 0;
  private pullStrength = 0;
  private tickInterval = 0;
  private tickTimer = 0;
  private stuck = false;
  private exploding = false;
  private explosionSubmitted = false;
  private hitConfirmed = false;
  private smokeTimer = 0;
  private glow: THREE.Sprite | null = null;

  constructor() {
    this.primaryMat = this.makeToon(0xffe94a);
    this.darkMat = this.makeToon(0x2a2d3a);
    this.whiteMat = this.makeToon(0xffffff);
    this.redMat = this.makeToon(0xff3048);
    this.visuals = this.buildVisuals();
    this.hurtbox = {
      owner: this,
      faction: this.faction,
      enabled: false,
      rect: () => this.readRect(),
    };
    this.hitbox = {
      attacker: this,
      def: this.attackDef,
      faction: this.faction,
      teamId: this.teamId,
      alreadyHit: this.alreadyHit,
      worldRect: () => this.readRect(),
      onResolvedHit: () => {
        // Only non-piercing projectiles stop on a confirmed hit — piercing
        // shots fly on, and field projectiles (black hole) keep grinding.
        if (!this.piercing) this.hitConfirmed = true;
      },
      stopAfterHit: true,
    };
    this.group.visible = false;
  }

  get isInvulnerable(): boolean {
    return false;
  }

  get diY(): number {
    return 0;
  }

  fire(
    def: ProjectileDef,
    x: number,
    y: number,
    facing: Facing,
    faction: Faction,
    teamId: number,
    attackerPower: number,
    attackDef: AttackDef,
    ownerSlot = -1,
  ): void {
    this.copyAttack(attackDef);
    this.faction = faction;
    this.teamId = teamId;
    this.slotIndex = ownerSlot;
    this.facing = facing;
    this.power = attackerPower;
    this.radius = def.radius;
    this.gravityScale = def.gravityScale;
    this.lifetime = def.lifetime;
    this.age = 0;
    this.homingDeg = def.homing ?? 0;
    this.hp = def.hp ?? 0;
    this.explodeRadius = def.explodeRadius ?? 0;
    this.sticky = def.sticky === true;
    this.piercing = def.piercing === true;
    this.trailColor = def.trailColor ?? 0;
    this.pullRadius = def.pull?.radius ?? 0;
    this.pullStrength = def.pull?.strength ?? 0;
    this.tickInterval = def.field?.tickInterval ?? 0;
    this.tickTimer = 0;
    // Fields never despawn on contact — they damage in ticks.
    if (this.tickInterval > 0) this.piercing = true;
    this.stuck = false;
    this.exploding = false;
    this.explosionSubmitted = false;
    this.hitConfirmed = false;
    this.smokeTimer = 0;
    this.damage = 0;
    this.hitstopTimer = 0;
    this.body.pos.x = x;
    this.body.pos.y = y;
    this.body.halfW = def.radius;
    this.body.height = def.radius * 2;
    const angle = degToRad(def.angleDeg);
    this.body.vel.x = cos(angle) * def.speed * facing;
    this.body.vel.y = sin(angle) * def.speed;
    this.alreadyHit.clear();
    this.hurtbox.faction = faction;
    this.hurtbox.enabled = this.hp > 0;
    this.hitbox.faction = faction;
    this.hitbox.teamId = teamId;
    this.hitbox.stopAfterHit = !this.piercing;
    this.visual = def.visual;
    this.primaryMat.color.setHex(def.color, THREE.SRGBColorSpace);
    this.setVisual(def.visual, def.color);
    this.syncVisual(0);
    this.group.visible = true;
    events.emit('shoot', { kind: def.visual, pos: { x, y } });
  }

  update(ctx: WorldCtx, dt: number, targets: readonly Fighter[]): boolean {
    if (!this.group.visible) return false;
    if (this.exploding && this.explosionSubmitted) return false;
    if (this.hitConfirmed) {
      this.beginImpact(ctx);
      return true;
    }
    if (this.hp <= 0 && this.hurtbox.enabled) {
      this.beginImpact(ctx);
      return true;
    }
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      if (!simPhase.resimulating) this.syncVisual(dt);
      return true;
    }

    this.age += dt;
    if (this.age >= this.lifetime) {
      this.beginImpact(ctx);
      return true;
    }

    if (this.stuck) {
      if (this.tickInterval > 0) {
        // Field projectile (black hole): parked and ACTIVE — keeps pulling,
        // and re-arms its hitbox every tick so trapped enemies take repeated
        // damage instead of one hit.
        this.applyPull(dt, targets);
        this.tickTimer -= dt;
        if (this.tickTimer <= 0) {
          this.tickTimer = this.tickInterval;
          this.alreadyHit.clear();
        }
        // Suction visual: sparks streaming into the core.
        this.smokeTimer -= dt;
        if (this.smokeTimer <= 0 && this.trailColor > 0 && !simPhase.resimulating) {
          this.smokeTimer = 0.05;
          const a = Math.random() * Math.PI * 2; // det-ok: particle placement only
          const r = this.pullRadius > 0 ? this.pullRadius * 0.7 : 2;
          ctx.particles.directional(
            this.body.pos.x + Math.cos(a) * r, // det-ok: view-only
            this.body.pos.y + this.body.height * 0.5 + Math.sin(a) * r * 0.5, // det-ok: view-only
            -Math.cos(a), // det-ok: view-only
            -Math.sin(a) * 0.5, // det-ok: view-only
            this.trailColor,
            2,
            r * 2.2,
          );
        }
      } else {
        this.checkStickyTrigger(ctx, targets);
      }
      if (!simPhase.resimulating) this.syncVisual(dt);
      return true;
    }

    this.updateHoming(dt, targets);
    this.applyPull(dt, targets);
    this.body.vel.y += GRAVITY * this.gravityScale * dt;
    const prevX = this.body.pos.x;
    const prevY = this.body.pos.y;
    this.body.pos.x += this.body.vel.x * dt;
    this.body.pos.y += this.body.vel.y * dt;

    if (this.hitSurface(ctx, prevX, prevY)) {
      if (this.sticky) {
        this.armSticky();
      } else {
        this.beginImpact(ctx);
      }
    }

    const wantsTrail =
      !simPhase.resimulating &&
      (this.visual === 'rocket' || this.visual === 'flame' || this.visual === 'shockwave' || this.trailColor > 0);
    if (wantsTrail) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = this.visual === 'rocket' ? 0.055 : 0.04;
        // rocket: white smoke; flame: embers; shockwave: crackle sparks;
        // otherwise the data-driven trailColor (frost, void, electricity…).
        const trailColor =
          this.trailColor > 0
            ? this.trailColor
            : this.visual === 'rocket' ? 0xffffff : this.visual === 'flame' ? 0xffa03c : 0xfff27a;
        ctx.particles.directional(
          this.body.pos.x - Math.sign(this.body.vel.x || this.facing) * this.radius * 0.8,
          this.body.pos.y,
          -Math.sign(this.body.vel.x || this.facing),
          this.visual === 'shockwave' ? 0.9 : 0.2,
          trailColor,
          4,
          this.visual === 'flame' ? 2.4 : 1.6,
        );
      }
    }

    if (!simPhase.resimulating) this.syncVisual(dt);
    return true;
  }

  submitHitbox(ctx: WorldCtx): void {
    if (!this.group.visible) return;
    if (this.exploding) {
      if (this.explodeRadius <= 0 || this.explosionSubmitted) return;
      this.hitbox.def = this.attackDef;
      this.hitbox.stopAfterHit = false;
      ctx.requestHitbox(this.hitbox);
      this.explosionSubmitted = true;
      return;
    }
    // Parked mines stay dormant until triggered — but parked FIELDS (black
    // hole) keep their damaging aura live.
    if (this.stuck && this.tickInterval <= 0) return;
    this.hitbox.def = this.attackDef;
    this.hitbox.stopAfterHit = !this.piercing;
    ctx.requestHitbox(this.hitbox);
  }

  canBeDamaged(): boolean {
    return this.group.visible && this.hp > 0 && !this.exploding;
  }

  onHit(result: HitResult): void {
    if (this.hp <= 0) return;
    this.hp -= result.damage;
    this.damage = 0;
    if (this.hp <= 0) this.hitConfirmed = true;
  }

  onDealtHit(_result: HitResult): void {}

  /** Sim-relevant scalars for replay digests / net snapshots. */
  digestInto(out: number[]): void {
    out.push(
      this.body.pos.x,
      this.body.pos.y,
      this.body.vel.x,
      this.body.vel.y,
      this.teamId,
      this.facing,
      this.age,
      this.lifetime,
      this.hp,
      this.radius,
      this.stuck ? 1 : 0,
      this.exploding ? 1 : 0,
      this.explosionSubmitted ? 1 : 0,
      this.hitConfirmed ? 1 : 0,
      this.tickTimer,
      this.hitstopTimer,
      this.attackDef.damage,
    );
  }

  deactivate(): void {
    this.group.visible = false;
    this.hurtbox.enabled = false;
    this.alreadyHit.clear();
    this.hp = 0;
    this.damage = 0;
    this.hitstopTimer = 0;
    this.body.pos.x = 0;
    this.body.pos.y = -999;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.stuck = false;
    this.exploding = false;
    this.explosionSubmitted = false;
    this.hitConfirmed = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (let i = 0; i < this.materials.length; i += 1) this.materials[i]!.dispose();
  }

  private beginImpact(ctx: WorldCtx): void {
    this.hitConfirmed = false;
    this.hurtbox.enabled = false;
    if (this.explodeRadius > 0) {
      this.exploding = true;
      this.explosionSubmitted = false;
      this.radius = this.explodeRadius;
      this.body.halfW = this.explodeRadius;
      this.body.height = this.explodeRadius * 2;
      this.alreadyHit.clear();
      if (!simPhase.resimulating) this.showExplosionVisual();
      events.emit('explosion', {
        pos: { x: this.body.pos.x, y: this.body.pos.y },
        radius: this.explodeRadius,
      });
      if (!simPhase.resimulating) {
        ctx.particles.burst(this.body.pos.x, this.body.pos.y, this.primaryMat.color.getHex(), 32, 8);
      }
      return;
    }
    this.exploding = true;
    this.explosionSubmitted = true;
  }

  private armSticky(): void {
    this.stuck = true;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.group.rotation.z = 0;
  }

  private checkStickyTrigger(ctx: WorldCtx, targets: readonly Fighter[]): void {
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i]!;
      if (!target.alive || target.teamId === this.teamId) continue;
      const dx = target.body.pos.x - this.body.pos.x;
      const dy = target.body.pos.y + target.body.height * 0.5 - this.body.pos.y;
      if (dx * dx + dy * dy <= STICKY_TRIGGER_RADIUS_SQ) {
        this.beginImpact(ctx);
        return;
      }
    }
  }

  private updateHoming(dt: number, targets: readonly Fighter[]): void {
    if (this.homingDeg <= 0) return;
    let best: Fighter | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i]!;
      if (!target.alive || target.teamId === this.teamId) continue;
      const dx = target.body.pos.x - this.body.pos.x;
      const dy = target.body.pos.y + target.body.height * 0.55 - this.body.pos.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = target;
      }
    }
    if (!best) return;
    const speed = Math.max(EPSILON, hypot(this.body.vel.x, this.body.vel.y));
    const targetAngle = atan2(
      best.body.pos.y + best.body.height * 0.55 - this.body.pos.y,
      best.body.pos.x - this.body.pos.x,
    );
    const currentAngle = atan2(this.body.vel.y, this.body.vel.x);
    const turn = degToRad(this.homingDeg) * dt;
    const nextAngle = currentAngle + clampAngle(targetAngle - currentAngle, -turn, turn);
    this.body.vel.x = cos(nextAngle) * speed;
    this.body.vel.y = sin(nextAngle) * speed;
  }

  private hitSurface(ctx: WorldCtx, prevX: number, prevY: number): boolean {
    const minX = this.body.pos.x - this.radius;
    const maxX = this.body.pos.x + this.radius;
    const minY = this.body.pos.y - this.radius;
    const maxY = this.body.pos.y + this.radius;
    const solids = ctx.stage.colliders.solids;
    for (let i = 0; i < solids.length; i += 1) {
      const s = solids[i]!;
      if (aabbOverlap(minX, maxX, minY, maxY, s.minX, s.maxX, s.minY, s.maxY)) {
        this.body.pos.x = prevX;
        this.body.pos.y = prevY;
        return true;
      }
    }
    if (this.body.vel.y > 0) return false;
    const prevBottom = prevY - this.radius;
    const bottom = this.body.pos.y - this.radius;
    const oneWays = ctx.stage.colliders.oneWays;
    for (let i = 0; i < oneWays.length; i += 1) {
      const p = oneWays[i]!;
      if (maxX <= p.minX || minX >= p.maxX) continue;
      if (prevBottom >= p.y && bottom <= p.y) {
        this.body.pos.y = p.y + this.radius;
        return true;
      }
    }
    return false;
  }

  private syncVisual(dt: number): void {
    this.group.position.set(this.body.pos.x, this.body.pos.y, 0.32);
    if (!this.stuck && !this.exploding) {
      this.group.rotation.z = Math.atan2(this.body.vel.y, this.body.vel.x); // det-ok: view-only
    }
    if (this.visual === 'mine') {
      const blink = Math.sin(this.age * 14) > 0 ? 1 : 0.35; // det-ok: view-only
      this.redMat.color.setRGB(1, 0.12 * blink, 0.18 * blink, THREE.SRGBColorSpace);
    } else if (this.visual === 'shockwave' || this.exploding) {
      const t = this.exploding ? 1 : Math.min(1, this.age / Math.max(EPSILON, this.lifetime));
      const s = this.exploding ? this.explodeRadius : 0.3 + t * 1.4;
      this.group.scale.set(s, Math.max(0.12, this.radius * 0.55), s);
    } else {
      const bob = this.sticky && this.stuck ? Math.sin(this.age * 8) * 0.03 : 0; // det-ok: view-only
      this.group.scale.set(1, 1 + bob, 1);
    }
    if (this.glow) {
      this.glow.material.rotation += dt * 2.2;
    }
  }

  private readRect(): Rect {
    const r = this.exploding ? this.explodeRadius : this.radius;
    this.rect.minX = this.body.pos.x - r;
    this.rect.maxX = this.body.pos.x + r;
    this.rect.minY = this.body.pos.y - r;
    this.rect.maxY = this.body.pos.y + r;
    return this.rect;
  }

  private copyAttack(src: AttackDef): void {
    this.attackDef.id = src.id;
    this.attackDef.damage = src.damage;
    this.attackDef.baseKb = src.baseKb;
    this.attackDef.kbGrowth = src.kbGrowth;
    this.attackDef.angleDeg = src.angleDeg;
    this.attackDef.windup = 0;
    this.attackDef.active = 0.08;
    this.attackDef.recover = 0;
    this.attackDef.hitbox = src.hitbox;
    this.attackDef.sfx = src.sfx;
    this.attackDef.poseId = src.poseId;
    this.attackDef.projectile = src.projectile;
    this.attackDef.freezeTime = src.freezeTime;
  }

  /** Black-hole suction: drag opposing fighters toward the orb while it lives. */
  private applyPull(dt: number, targets: readonly Fighter[]): void {
    if (this.pullRadius <= 0) return;
    const r2 = this.pullRadius * this.pullRadius;
    for (let i = 0; i < targets.length; i += 1) {
      const fighter = targets[i]!;
      if (!fighter.alive || fighter.teamId === this.teamId || fighter.hitstopTimer > 0) continue;
      const dx = this.body.pos.x - fighter.body.pos.x;
      const dy = this.body.pos.y + this.body.height * 0.5 - (fighter.body.pos.y + fighter.body.height * 0.5);
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < 0.01) continue;
      const dist = Math.sqrt(d2);
      // Stronger near the core, weight-resisted (bosses barely budge).
      const falloff = 1 - dist / this.pullRadius;
      const accel = this.pullStrength * falloff * (100 / fighter.weight);
      fighter.body.vel.x += (dx / dist) * accel * dt;
      fighter.body.vel.y += (dy / dist) * accel * dt * 0.55;
    }
  }

  private setVisual(visual: ProjectileVisual, color: number): void {
    for (let i = 0; i < VISUALS.length; i += 1) {
      this.visuals[VISUALS[i]!].visible = VISUALS[i] === visual;
    }
    if (this.glow) {
      this.group.remove(this.glow);
      this.glow = null;
    }
    if (visual === 'orb' || visual === 'bolt' || visual === 'shockwave') {
      this.glow = attachGlow(this.group, color, this.radius * (visual === 'shockwave' ? 3.5 : 4), 0.65);
    }
    this.group.scale.set(1, 1, 1);
  }

  private showExplosionVisual(): void {
    this.setVisual('shockwave', this.primaryMat.color.getHex());
    this.visual = 'shockwave';
    this.group.rotation.z = 0;
    this.syncVisual(0);
  }

  private buildVisuals(): Record<ProjectileVisual, THREE.Group> {
    const visuals = {} as Record<ProjectileVisual, THREE.Group>;
    for (let i = 0; i < VISUALS.length; i += 1) {
      const key = VISUALS[i]!;
      const group = new THREE.Group();
      group.visible = false;
      visuals[key] = group;
      this.group.add(group);
    }

    const bullet = new THREE.Mesh(CAPSULE, this.primaryMat);
    bullet.scale.set(0.16, 0.24, 0.16);
    bullet.rotation.z = Math.PI / 2;
    visuals.bullet.add(bullet);

    const laser = new THREE.Mesh(BOX, this.primaryMat);
    laser.scale.set(1.1, 0.08, 0.08);
    visuals.laser.add(laser);

    const rocketBody = new THREE.Mesh(CYLINDER, this.primaryMat);
    rocketBody.scale.set(0.18, 0.45, 0.18);
    rocketBody.rotation.z = Math.PI / 2;
    const rocketNose = new THREE.Mesh(CONE, this.darkMat);
    rocketNose.scale.set(0.2, 0.28, 0.2);
    rocketNose.rotation.z = -Math.PI / 2;
    rocketNose.position.x = 0.42;
    const rocketFin = new THREE.Mesh(BOX, this.whiteMat);
    rocketFin.scale.set(0.12, 0.08, 0.32);
    rocketFin.position.x = -0.35;
    visuals.rocket.add(rocketBody, rocketNose, rocketFin);

    const bomb = new THREE.Mesh(SPHERE, this.primaryMat);
    bomb.scale.setScalar(0.28);
    const band = new THREE.Mesh(CYLINDER, this.whiteMat);
    band.scale.set(0.3, 0.035, 0.3);
    band.rotation.z = Math.PI / 2;
    visuals.bomb.add(bomb, band);

    const mine = new THREE.Mesh(CYLINDER, this.darkMat);
    mine.scale.set(0.34, 0.08, 0.34);
    mine.rotation.x = Math.PI / 2;
    const light = new THREE.Mesh(SPHERE, this.redMat);
    light.scale.setScalar(0.08);
    light.position.y = 0.08;
    visuals.mine.add(mine, light);

    const orb = new THREE.Mesh(SPHERE, this.primaryMat);
    orb.scale.setScalar(0.32);
    visuals.orb.add(orb);

    for (let i = 0; i < 4; i += 1) {
      const segment = new THREE.Mesh(BOX, this.primaryMat);
      segment.scale.set(0.12, 0.42, 0.12);
      segment.position.set((i % 2 === 0 ? -0.08 : 0.08), (i - 1.5) * 0.2, 0);
      segment.rotation.z = i % 2 === 0 ? 0.45 : -0.45;
      visuals.bolt.add(segment);
    }

    const wave = new THREE.Mesh(ARC, this.primaryMat);
    wave.scale.set(0.45, 0.16, 0.22);
    wave.rotation.z = Math.PI;
    visuals.wave.add(wave);

    const feather = new THREE.Mesh(CONE, this.primaryMat);
    feather.scale.set(0.12, 0.5, 0.04);
    feather.rotation.z = -Math.PI / 2;
    const spine = new THREE.Mesh(BOX, this.whiteMat);
    spine.scale.set(0.54, 0.025, 0.025);
    visuals.feather.add(feather, spine);

    const ring = new THREE.Mesh(TORUS, this.primaryMat);
    ring.rotation.x = Math.PI / 2;
    visuals.shockwave.add(ring);

    // Sword slash: a tall crescent trailing edge, white-hot inner arc.
    const slashOuter = new THREE.Mesh(ARC, this.primaryMat);
    slashOuter.scale.set(0.5, 0.9, 0.16);
    slashOuter.rotation.z = -Math.PI / 2;
    const slashInner = new THREE.Mesh(ARC, this.whiteMat);
    slashInner.scale.set(0.36, 0.66, 0.1);
    slashInner.rotation.z = -Math.PI / 2;
    slashInner.position.x = 0.04;
    visuals.slash.add(slashOuter, slashInner);

    // Rolling flame: chunky fire cones with a white-hot core.
    const flameBody = new THREE.Mesh(CONE, this.primaryMat);
    flameBody.scale.set(0.42, 0.62, 0.42);
    flameBody.rotation.z = -Math.PI / 2;
    const flameCore = new THREE.Mesh(CONE, this.whiteMat);
    flameCore.scale.set(0.22, 0.4, 0.22);
    flameCore.rotation.z = -Math.PI / 2;
    flameCore.position.x = 0.12;
    const flameTail = new THREE.Mesh(SPHERE, this.primaryMat);
    flameTail.scale.set(0.3, 0.34, 0.3);
    flameTail.position.x = -0.28;
    visuals.flame.add(flameBody, flameCore, flameTail);

    return visuals;
  }

  private makeToon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push(material);
    return material;
  }
}

export class ProjectileManager {
  private readonly pool: Pool<ProjectileSlot>;
  private readonly active: ProjectileSlot[] = [];
  private readonly all: readonly ProjectileSlot[];

  constructor(private readonly scene: THREE.Scene) {
    this.pool = new Pool(
      () => {
        const projectile = new ProjectileSlot();
        this.scene.add(projectile.group);
        return projectile;
      },
      POOL_PROJECTILES,
      (projectile) => projectile.deactivate(),
    );
    this.all = this.pool.all;
  }

  fire(
    def: ProjectileDef,
    x: number,
    y: number,
    facing: Facing,
    faction: Faction,
    teamId: number,
    attackerPower: number,
    attackDef: AttackDef,
    ownerSlot = -1,
  ): void {
    const projectile = this.pool.obtain();
    if (!projectile) return;
    projectile.fire(def, x, y, facing, faction, teamId, attackerPower, attackDef, ownerSlot);
    this.active.push(projectile);
  }

  update(ctx: WorldCtx, dt: number, targets: readonly Fighter[]): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const projectile = this.active[i]!;
      if (projectile.update(ctx, dt, targets)) continue;
      this.releaseAt(i);
    }
  }

  submitHitboxes(ctx: WorldCtx): void {
    for (let i = 0; i < this.active.length; i += 1) {
      this.active[i]!.submitHitbox(ctx);
    }
  }

  collectDestructibleHurtboxes(out: Hurtbox[]): void {
    for (let i = 0; i < this.active.length; i += 1) {
      const projectile = this.active[i]!;
      if (projectile.canBeDamaged()) out.push(projectile.hurtbox);
    }
  }

  collectDestructibleTargets(out: FighterLike[]): void {
    for (let i = 0; i < this.active.length; i += 1) {
      const projectile = this.active[i]!;
      if (projectile.canBeDamaged()) out.push(projectile);
    }
  }

  digestInto(out: number[]): void {
    out.push(this.active.length);
    for (let i = 0; i < this.active.length; i += 1) this.active[i]!.digestInto(out);
  }

  dispose(): void {
    this.active.length = 0;
    this.pool.releaseAll();
    for (let i = 0; i < this.all.length; i += 1) this.all[i]!.dispose();
  }

  private releaseAt(index: number): void {
    const projectile = this.active[index]!;
    const last = this.active.pop();
    if (last && index < this.active.length) this.active[index] = last;
    this.pool.release(projectile);
  }
}

function clampAngle(angle: number, min: number, max: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  if (wrapped < min) return min;
  if (wrapped > max) return max;
  return wrapped;
}
