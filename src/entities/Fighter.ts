import * as THREE from 'three';
import { LAUNCH_THRESHOLD } from '../config';
import {
  AIR_CONTROL,
  DROP_THROUGH_TIME,
  FRICTION_GROUND,
  LANDING_LAG,
  TUMBLE_AIR_CONTROL,
} from '../config';
import type { ActiveHitbox, HitResult, Hurtbox, Rect } from '../combat/types';
import { events } from '../core/events';
import { clamp } from '../core/math';
import type { AttackDef, CharacterDef, Faction, Facing, FighterStateName, Vec2, WeaponDef } from '../data/types';
import { Body } from '../physics/Body';
import { FighterRig, type Rig } from '../rigs/FighterRig';
import {
  poseAttack,
  poseFall,
  poseHit,
  poseIdle,
  poseJump,
  poseKO,
  poseLanding,
  poseRun,
  poseTumble,
} from '../rigs/poses';
import type { TrailHandle } from '../render/Trails';
import { Entity, type WorldCtx } from './Entity';

export interface FighterIntent {
  moveX: number;
  moveY: number;
  jumpPressed: boolean;
  attackPressed: boolean;
  weaponPressed: boolean;
}

const HURTBOX_PAD_X = 0.02;
const ATTACK_CHAIN_RESET = 0.4;
const ATTACK_STOP_ACCEL = FRICTION_GROUND * 2.4;
const POSE_DAMPING = 24;

export class Fighter extends Entity {
  readonly def: CharacterDef;
  readonly faction: Faction;
  /** Combat gate (see combat/types.ts). Set once at match setup via setTeam. */
  teamId: number;
  readonly rig: Rig;
  readonly hurtbox: Hurtbox;
  readonly intents: FighterIntent = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    attackPressed: false,
    weaponPressed: false,
  };

  damage = 0;
  damageScale = 1;
  kbImmune = false;
  attackMult = 1;
  shieldHits = 0;
  facing: Facing = 1;
  state: FighterStateName = 'idle';
  stateTime = 0;
  jumpsUsed = 0;
  hitstopTimer = 0;
  invulnTimer = 0;
  comboIndex = 0;
  comboQueued = false;
  currentAttack: AttackDef | null = null;
  attackPhaseTime = 0;
  weaponCooldown = 0;

  private readonly hurtRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly activeRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly alreadyHit = new Set<object>();
  private readonly activeHitbox: ActiveHitbox;
  private readonly projectileAttackScratch: AttackDef = {
    id: 'projectileScratch',
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
  /** Hammer powerup: keep running while auto-swinging. */
  autoSwingMove = false;

  private trail: TrailHandle | null = null;
  private equippedWeapon: WeaponDef | null = null;
  private weaponModel: THREE.Group | null = null;
  private modelOverride: THREE.Group | null = null;
  private currentAttackIsWeapon = false;
  private projectileFired = false;
  private slashWaveFired = false;
  private comboResetTimer = 0;
  private wasGroundedForStep = false;
  private hitFlashTimer = 0;
  private freezeTimer = 0;

  constructor(def: CharacterDef, faction: Faction, customRig?: Rig) {
    const body = new Body(0.42 * def.proportions.bulk, def.proportions.height);
    const rig = customRig ?? new FighterRig({ palette: def.palette, proportions: def.proportions });
    super(body, rig.root);
    this.def = def;
    this.faction = faction;
    this.teamId = faction === 'player' ? 1 : 0;
    this.rig = rig;
    this.hurtbox = {
      owner: this,
      faction,
      enabled: true,
      rect: () => this.readHurtbox(),
    };
    this.activeHitbox = {
      attacker: this,
      def: def.combo[0],
      faction,
      teamId: this.teamId,
      alreadyHit: this.alreadyHit,
      worldRect: () => this.readAttackBox(),
    };
  }

  /** Assign the combat team (FFA slots / 2v2 teams). Call at match setup only. */
  setTeam(teamId: number): void {
    this.teamId = teamId;
    this.activeHitbox.teamId = teamId;
  }

  get power(): number {
    return this.def.power;
  }

  get weight(): number {
    return this.def.weight;
  }

  get isInvulnerable(): boolean {
    return this.invulnTimer > 0;
  }

  get diY(): number {
    return clamp(this.intents.moveY, -1, 1);
  }

  get weaponDef(): WeaponDef | null {
    return this.equippedWeapon;
  }

  get weaponCooldownFrac(): number {
    const cooldown = this.equippedWeapon?.cooldown ?? 0;
    return cooldown > 0 ? clamp(this.weaponCooldown / cooldown, 0, 1) : 0;
  }

  update(ctx: WorldCtx, dt: number): void {
    if (this.weaponCooldown > 0) this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    this.wasGroundedForStep = this.body.grounded;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.hurtbox.enabled = !this.isInvulnerable;

    if (this.comboResetTimer > 0) {
      this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
      if (this.comboResetTimer === 0) this.comboIndex = 0;
    }
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      this.body.fastFalling = false;
      this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
      this.state = 'hitstun';
      this.stateTime = -this.freezeTimer;
      if (this.freezeTimer > 0) {
        this.updateVisuals(ctx, dt);
        return;
      }
      this.state = this.body.grounded ? 'idle' : 'fall';
      this.stateTime = 0;
    }

    switch (this.state) {
      case 'idle':
      case 'run':
        this.updateGrounded(ctx, dt);
        break;
      case 'jump':
      case 'fall':
        this.updateAir(ctx, dt);
        break;
      case 'attack':
      case 'weaponAbility':
        this.updateAttack(ctx, dt);
        break;
      case 'hitstun':
        this.updateHitstun(dt);
        break;
      case 'launched':
        this.updateLaunched(ctx, dt);
        break;
      case 'landing':
        this.updateLanding(dt);
        break;
      case 'ko':
      case 'respawning':
        this.stateTime += dt;
        break;
    }

    this.updateVisuals(ctx, dt);
  }

  afterPhysics(ctx: WorldCtx): void {
    if (this.hitstopTimer > 0) return;

    const landed = !this.wasGroundedForStep && this.body.grounded;
    if (landed) {
      this.jumpsUsed = 0;
      this.body.fastFalling = false;
      ctx.particles.burst(this.body.pos.x, this.body.pos.y + 0.08, this.def.palette.glow, 8, 3.5);
      if (this.state === 'launched') {
        this.state = 'landing';
        this.stateTime = 0;
        this.trail?.setActive(false);
      } else if (this.state === 'jump' || this.state === 'fall') {
        this.state = Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
        this.stateTime = 0;
      }
    }

    if (
      !this.body.grounded &&
      this.body.vel.y < 0 &&
      (this.state === 'jump' || this.state === 'idle' || this.state === 'run')
    ) {
      this.state = 'fall';
      this.stateTime = 0;
    }
  }

  onHit(result: HitResult): void {
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.comboResetTimer = 0;
    this.body.fastFalling = false;
    this.state = result.launched ? 'launched' : 'hitstun';
    this.stateTime = -result.hitstun;
    this.rig.flashColor(0xffffff, 0.06);
    this.hitFlashTimer = 0.06;
    if (result.kb <= LAUNCH_THRESHOLD) {
      this.trail?.setActive(false);
    }
  }

  onDealtHit(_result: HitResult): void {
    this.rig.flashColor(this.def.palette.accent, 0.035);
  }

  onShieldBlocked(): void {
    this.rig.flashColor(0x8ff6ff, 0.08);
  }

  applyFreeze(seconds: number): void {
    if (seconds <= 0) return;
    events.emit('shoot', {
      kind: 'freeze',
      pos: { x: this.body.pos.x, y: this.body.pos.y + this.body.height * 0.5 },
    });
    this.freezeTimer = Math.max(this.freezeTimer, seconds);
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.body.fastFalling = false;
    this.body.vel.x *= 0.15;
    if (this.body.vel.y > 1) this.body.vel.y = 1;
    this.state = 'hitstun';
    this.stateTime = -this.freezeTimer;
    this.rig.flashColor(0x9df3ff, seconds);
  }

  equipWeapon(weapon: WeaponDef, model: THREE.Group): void {
    if (this.weaponModel) {
      this.rig.weaponSocket.remove(this.weaponModel);
      disposeWeaponModel(this.weaponModel);
    }
    this.equippedWeapon = weapon;
    this.weaponModel = model;
    if (!this.modelOverride) this.rig.weaponSocket.add(model);
    this.weaponCooldown = Math.min(this.weaponCooldown, weapon.cooldown);
  }

  /**
   * Visually swap the held model WITHOUT touching the equipped weapon
   * (giant-hammer powerup). Pass null to restore the real weapon's model.
   */
  setWeaponModelOverride(model: THREE.Group | null): void {
    if (this.modelOverride) {
      this.rig.weaponSocket.remove(this.modelOverride);
      this.modelOverride = null;
      if (this.weaponModel) this.rig.weaponSocket.add(this.weaponModel);
    }
    if (model) {
      if (this.weaponModel) this.rig.weaponSocket.remove(this.weaponModel);
      this.modelOverride = model;
      this.rig.weaponSocket.add(model);
    }
  }

  /** Trigger an attack outside the combo system (hammer-mode auto swings). */
  startCustomAttack(def: AttackDef): void {
    this.currentAttack = def;
    this.currentAttackIsWeapon = true;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'attack';
    this.alreadyHit.clear();
  }

  private handleFacing2(): void {
    if (this.intents.moveX > 0.15) this.facing = 1;
    if (this.intents.moveX < -0.15) this.facing = -1;
  }

  koReset(pos: Vec2): void {
    this.damage = 0;
    this.damageScale = 1;
    this.kbImmune = false;
    this.shieldHits = 0;
    this.freezeTimer = 0;
    this.alive = true;
    this.group.visible = true;
    this.body.pos.x = pos.x;
    this.body.pos.y = pos.y;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.fastFalling = false;
    this.body.dropThroughTimer = 0;
    this.body.noclip = false;
    this.state = 'idle';
    this.stateTime = 0;
    this.jumpsUsed = 0;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.comboIndex = 0;
    this.comboResetTimer = 0;
    this.trail?.setActive(false);
    this.hurtbox.enabled = true;
    this.syncGroupToBody();
  }

  beginKo(): void {
    this.alive = false;
    this.group.visible = false;
    this.hurtbox.enabled = false;
    this.state = 'ko';
    this.stateTime = 0;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.damageScale = 1;
    this.kbImmune = false;
    this.shieldHits = 0;
    this.freezeTimer = 0;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.noclip = true;
    this.trail?.setActive(false);
  }

  dispose(): void {
    this.trail?.release();
    this.trail = null;
    if (this.weaponModel) {
      this.rig.weaponSocket.remove(this.weaponModel);
      disposeWeaponModel(this.weaponModel);
      this.weaponModel = null;
    }
    this.rig.dispose();
  }

  private updateGrounded(ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    this.body.fastFalling = false;
    this.handleFacing();
    if (this.tryStartJump()) return;
    if (this.tryStartWeaponAbility()) return;
    if (this.tryStartAttack()) return;
    this.applyGroundMove(dt);
    this.state = Math.abs(this.body.vel.x) > 0.2 || Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
    this.trail?.setActive(false);
    this.keepInsideStageHint(ctx);
  }

  private updateAir(_ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    if (this.tryStartJump()) return;
    if (this.tryStartWeaponAbility()) return;
    if (this.tryStartAttack()) return;
    this.applyAirMove(dt, AIR_CONTROL);
    if (this.intents.moveY < -0.5 && this.body.vel.y < 0) this.body.fastFalling = true;
    this.state = this.body.vel.y >= 0 ? 'jump' : 'fall';
  }

  private updateAttack(ctx: WorldCtx, dt: number): void {
    const attack = this.currentAttack;
    if (!attack) {
      this.endAttack();
      return;
    }

    this.stateTime += dt;
    this.attackPhaseTime += dt;
    if (this.body.grounded) {
      // Hammer mode: keep running while swinging (Smash-style rampage).
      if (this.autoSwingMove) {
        this.handleFacing2();
        this.applyGroundMove(dt);
      } else {
        this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
      }
    } else {
      this.applyAirMove(dt, AIR_CONTROL);
    }

    const activeStart = attack.windup;
    const activeEnd = attack.windup + attack.active;
    const total = activeEnd + attack.recover;
    const activeOrLater = this.attackPhaseTime >= activeStart;
    if (!this.currentAttackIsWeapon && this.intents.attackPressed && activeOrLater && this.comboIndex < 2) {
      this.comboQueued = true;
    }
    if (attack.projectile && activeOrLater && !this.projectileFired) {
      this.fireProjectileAttack(ctx, attack);
      this.projectileFired = true;
    } else if (!attack.projectile && this.attackPhaseTime >= activeStart && this.attackPhaseTime < activeEnd) {
      this.activeHitbox.def = attack;
      ctx.requestHitbox(this.activeHitbox);
    }
    // Melee weapon signature effect (slash wave / hammer lightning): fired
    // once at the active frame alongside the blade hitbox — the wave carries
    // its own weaker AttackDef, so point-blank hits harder than the wave.
    const wave = this.currentAttackIsWeapon ? this.equippedWeapon?.slashWave : undefined;
    if (wave && activeOrLater && !this.slashWaveFired) {
      this.slashWaveFired = true;
      const spawnY = this.body.pos.y + this.body.height * 0.55;
      const spawnOff = this.body.halfW + wave.projectile.radius + 0.3;
      ctx.fireProjectile(
        wave.projectile,
        wave.attack,
        this.body.pos.x + this.facing * spawnOff,
        spawnY,
        this.facing,
        this.faction,
        this.teamId,
        this.power,
      );
      if (wave.bothDirections) {
        ctx.fireProjectile(
          wave.projectile,
          wave.attack,
          this.body.pos.x - this.facing * spawnOff,
          spawnY,
          (this.facing * -1) as Facing,
          this.faction,
          this.teamId,
          this.power,
        );
      }
      // (ProjectileManager.fire emits the 'shoot' sfx event per wave.)
    }
    if (this.attackPhaseTime >= total) {
      if (!this.currentAttackIsWeapon && this.comboQueued && this.comboIndex < 2) {
        this.startAttack(this.comboIndex + 1);
      } else {
        this.endAttack();
      }
    }
  }

  private updateHitstun(dt: number): void {
    this.stateTime += dt;
    if (this.stateTime >= 0) {
      this.state = this.body.grounded ? 'idle' : 'fall';
      this.stateTime = 0;
    }
  }

  private updateLaunched(ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    this.ensureTrail(ctx);
    this.trail?.push(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, 0.08);
    this.applyAirMove(dt, AIR_CONTROL * TUMBLE_AIR_CONTROL);
  }

  private updateLanding(dt: number): void {
    this.stateTime += dt;
    this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
    if (this.stateTime >= LANDING_LAG) {
      this.state = Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
      this.stateTime = 0;
    }
  }

  private tryStartJump(): boolean {
    if (!this.intents.jumpPressed) return false;
    if (this.body.grounded && this.intents.moveY < -0.5) {
      this.body.dropThroughTimer = DROP_THROUGH_TIME;
      this.body.grounded = false;
      return true;
    }
    if (this.body.grounded) {
      this.body.vel.y = this.def.jumpVel;
      this.body.grounded = false;
      this.jumpsUsed = 1;
      this.state = 'jump';
      this.stateTime = 0;
      events.emit('jump', { isPlayer: this.faction === 'player' });
      return true;
    }
    if (this.jumpsUsed < this.def.jumps) {
      this.body.vel.y = this.def.jumpVel * 0.9;
      this.body.fastFalling = false;
      this.jumpsUsed += 1;
      this.state = 'jump';
      this.stateTime = 0;
      events.emit('jump', { isPlayer: this.faction === 'player' });
      return true;
    }
    return false;
  }

  private tryStartAttack(): boolean {
    if (!this.intents.attackPressed) return false;
    // Spin fighters (Kaze, Shade) use their spin as the air attack directly.
    if (!this.body.grounded && this.def.combo[2].poseId === 'spin') {
      this.startAttack(2);
      return true;
    }
    const nextIndex = this.comboResetTimer > 0 ? clamp(this.comboIndex + 1, 0, 2) : 0;
    this.startAttack(nextIndex);
    return true;
  }

  private tryStartWeaponAbility(): boolean {
    if (!this.intents.weaponPressed || this.weaponCooldown > 0 || !this.equippedWeapon) return false;
    this.startWeaponAbility(this.equippedWeapon);
    return true;
  }

  private startAttack(index: number): void {
    const attack = this.def.combo[index];
    if (attack === undefined) return;
    // Grounded spin gets a little hop (Link-style spin attack) — carries the
    // spin clear of the floor and feels great.
    if (attack.poseId === 'spin' && this.body.grounded) {
      this.body.vel.y = 5.5;
      this.body.grounded = false;
    }
    this.comboIndex = index;
    this.comboQueued = false;
    this.currentAttack = attack;
    this.currentAttackIsWeapon = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'attack';
    this.comboResetTimer = 0;
    this.alreadyHit.clear();
  }

  private startWeaponAbility(weapon: WeaponDef): void {
    this.comboQueued = false;
    this.currentAttack = weapon.ability;
    this.currentAttackIsWeapon = true;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'weaponAbility';
    this.comboResetTimer = 0;
    this.weaponCooldown = weapon.cooldown;
    this.alreadyHit.clear();
  }

  private endAttack(): void {
    const wasWeapon = this.currentAttackIsWeapon;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.attackPhaseTime = 0;
    this.comboResetTimer = wasWeapon ? this.comboResetTimer : ATTACK_CHAIN_RESET;
    this.state = this.body.grounded
      ? Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle'
      : this.body.vel.y >= 0 ? 'jump' : 'fall';
    this.stateTime = 0;
  }

  private applyGroundMove(dt: number): void {
    const target = this.intents.moveX * this.def.speed;
    this.body.vel.x = moveToward(this.body.vel.x, target, FRICTION_GROUND * dt);
  }

  private applyAirMove(dt: number, accel: number): void {
    const target = this.intents.moveX * this.def.speed;
    this.body.vel.x = moveToward(this.body.vel.x, target, accel * dt);
  }

  private handleFacing(): void {
    if ((this.state !== 'idle' && this.state !== 'run') || !this.body.grounded) return;
    if (this.intents.moveX > 0.15) this.facing = 1;
    if (this.intents.moveX < -0.15) this.facing = -1;
  }

  private updateVisuals(ctx: WorldCtx, dt: number): void {
    // Attacks blend twice as fast — punches must SNAP; smoothing is for
    // locomotion.
    const rate = this.state === 'attack' || this.state === 'weaponAbility' ? POSE_DAMPING * 2.2 : POSE_DAMPING;
    const blend = 1 - Math.exp(-rate * dt); // det-ok: view-only pose blending
    const t = this.stateTime;
    const pose = this.selectPose(t);
    this.syncGroupToBody();
    this.rig.setFacing(this.facing);
    this.rig.setGhostOpacity(this.isInvulnerable ? 0.62 : 1);
    this.rig.setPose(pose, blend);
    this.updateShadow(ctx);
    this.rig.update(dt);
  }

  /** Blob shadow: project down to the highest platform top under our feet. */
  private updateShadow(ctx: WorldCtx): void {
    const x = this.body.pos.x;
    const y = this.body.pos.y;
    let ground = -Infinity;
    const solids = ctx.stage.colliders.solids;
    for (let i = 0; i < solids.length; i += 1) {
      const s = solids[i]!;
      if (x >= s.minX && x <= s.maxX && s.maxY <= y + 0.05 && s.maxY > ground) ground = s.maxY;
    }
    const oneWays = ctx.stage.colliders.oneWays;
    for (let i = 0; i < oneWays.length; i += 1) {
      const p = oneWays[i]!;
      if (x >= p.minX && x <= p.maxX && p.y <= y + 0.05 && p.y > ground) ground = p.y;
    }
    if (ground === -Infinity) {
      this.rig.setShadow(null, 0);
      return;
    }
    const airborne = clamp((y - ground) / 6, 0, 1);
    this.rig.setShadow(ground - y, airborne);
  }

  private selectPose(t: number) {
    switch (this.state) {
      case 'idle':
        return poseIdle(t);
      case 'run':
        return poseRun(t, Math.abs(this.body.vel.x) / Math.max(0.0001, this.def.speed));
      case 'jump':
        return poseJump();
      case 'fall':
        return poseFall();
      case 'attack':
      case 'weaponAbility':
        return poseAttack(this.currentAttack?.poseId ?? 'finisher', this.attackPhase());
      case 'hitstun':
        return poseHit();
      case 'launched':
        return poseTumble(t);
      case 'landing':
        return poseLanding();
      case 'ko':
        return poseKO();
      case 'respawning':
        return poseIdle(t);
    }
  }

  private fireProjectileAttack(ctx: WorldCtx, attack: AttackDef): void {
    const projectile = attack.projectile;
    if (!projectile) return;
    const spawnX = this.body.pos.x + this.facing * (this.body.halfW + projectile.radius + 0.2);
    const spawnY = this.body.pos.y + this.body.height * 0.62;
    ctx.fireProjectile(
      projectile,
      this.projectileAttackFor(attack),
      spawnX,
      spawnY,
      this.facing,
      this.faction,
      this.teamId,
      this.power * this.attackMult,
    );
  }

  private projectileAttackFor(attack: AttackDef): AttackDef {
    if (this.attackMult === 1) return attack;
    const out = this.projectileAttackScratch;
    out.id = attack.id;
    out.damage = attack.damage * this.attackMult;
    out.baseKb = attack.baseKb;
    out.kbGrowth = attack.kbGrowth;
    out.angleDeg = attack.angleDeg;
    out.windup = attack.windup;
    out.active = attack.active;
    out.recover = attack.recover;
    out.hitbox = attack.hitbox;
    out.sfx = attack.sfx;
    out.poseId = attack.poseId;
    out.projectile = attack.projectile;
    out.freezeTime = attack.freezeTime;
    return out;
  }

  private attackPhase(): number {
    const attack = this.currentAttack;
    if (!attack) return 0;
    return this.attackPhaseTime / Math.max(0.0001, attack.windup + attack.active + attack.recover);
  }

  private ensureTrail(ctx: WorldCtx): void {
    if (this.trail) {
      this.trail.setActive(true);
      return;
    }
    this.trail = ctx.trails.acquire(this.def.palette.glow, 0.5);
  }

  private syncGroupToBody(): void {
    this.group.position.set(this.body.pos.x, this.body.pos.y, 0);
  }

  private readHurtbox(): Rect {
    this.hurtRect.minX = this.body.minX + HURTBOX_PAD_X;
    this.hurtRect.maxX = this.body.maxX - HURTBOX_PAD_X;
    this.hurtRect.minY = this.body.minY;
    this.hurtRect.maxY = this.body.maxY;
    return this.hurtRect;
  }

  private readAttackBox(): Rect {
    const attack = this.currentAttack ?? this.def.combo[0];
    const hb = attack.hitbox;
    const centerX = this.body.pos.x + hb.x * this.facing;
    const centerY = this.body.pos.y + hb.y;
    const halfW = hb.w * 0.5;
    const halfH = hb.h * 0.5;
    this.activeRect.minX = centerX - halfW;
    this.activeRect.maxX = centerX + halfW;
    this.activeRect.minY = centerY - halfH;
    this.activeRect.maxY = centerY + halfH;
    return this.activeRect;
  }

  private keepInsideStageHint(_ctx: WorldCtx): void {
    // Placeholder hook: entities stay decoupled from stage-specific policy in this slice.
  }
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}

function disposeWeaponModel(model: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material = obj.material;
    if (Array.isArray(material)) {
      for (let i = 0; i < material.length; i += 1) materials.add(material[i]!);
    } else {
      materials.add(material);
    }
  });
  materials.forEach((material) => material.dispose());
}
