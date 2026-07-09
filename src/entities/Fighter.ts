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
import type { CharacterDef, Faction, Facing, FighterStateName, Vec2 } from '../data/types';
import { Body } from '../physics/Body';
import { FighterRig } from '../rigs/FighterRig';
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
}

const HURTBOX_PAD_X = 0.02;
const ATTACK_CHAIN_RESET = 0.4;
const ATTACK_STOP_ACCEL = FRICTION_GROUND * 2.4;
const POSE_DAMPING = 24;

export class Fighter extends Entity {
  readonly def: CharacterDef;
  readonly faction: Faction;
  readonly rig: FighterRig;
  readonly hurtbox: Hurtbox;
  readonly intents: FighterIntent = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    attackPressed: false,
  };

  damage = 0;
  damageScale = 1;
  kbImmune = false;
  facing: Facing = 1;
  state: FighterStateName = 'idle';
  stateTime = 0;
  jumpsUsed = 0;
  hitstopTimer = 0;
  invulnTimer = 0;
  comboIndex = 0;
  comboQueued = false;
  currentAttack: CharacterDef['combo'][number] | null = null;
  attackPhaseTime = 0;

  private readonly hurtRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly activeRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly alreadyHit = new Set<object>();
  private readonly activeHitbox: ActiveHitbox;
  private trail: TrailHandle | null = null;
  private comboResetTimer = 0;
  private wasGroundedForStep = false;
  private hitFlashTimer = 0;

  constructor(def: CharacterDef, faction: Faction) {
    const body = new Body(0.42 * def.proportions.bulk, def.proportions.height);
    const rig = new FighterRig({ palette: def.palette, proportions: def.proportions });
    super(body, rig.root);
    this.def = def;
    this.faction = faction;
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
      alreadyHit: this.alreadyHit,
      worldRect: () => this.readAttackBox(),
    };
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

  update(ctx: WorldCtx, dt: number): void {
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
      case 'weaponAbility':
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

  koReset(pos: Vec2): void {
    this.damage = 0;
    this.damageScale = 1;
    this.kbImmune = false;
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
    this.comboQueued = false;
    this.damageScale = 1;
    this.kbImmune = false;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.noclip = true;
    this.trail?.setActive(false);
  }

  dispose(): void {
    this.trail?.release();
    this.trail = null;
    this.rig.dispose();
  }

  private updateGrounded(ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    this.body.fastFalling = false;
    this.handleFacing();
    if (this.tryStartJump()) return;
    if (this.tryStartAttack()) return;
    this.applyGroundMove(dt);
    this.state = Math.abs(this.body.vel.x) > 0.2 || Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
    this.trail?.setActive(false);
    this.keepInsideStageHint(ctx);
  }

  private updateAir(_ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    if (this.tryStartJump()) return;
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
      this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
    } else {
      this.applyAirMove(dt, AIR_CONTROL);
    }

    const activeStart = attack.windup;
    const activeEnd = attack.windup + attack.active;
    const total = activeEnd + attack.recover;
    const activeOrLater = this.attackPhaseTime >= activeStart;
    if (this.intents.attackPressed && activeOrLater && this.comboIndex < 2) {
      this.comboQueued = true;
    }
    if (this.attackPhaseTime >= activeStart && this.attackPhaseTime < activeEnd) {
      this.activeHitbox.def = attack;
      ctx.requestHitbox(this.activeHitbox);
    }
    if (this.attackPhaseTime >= total) {
      if (this.comboQueued && this.comboIndex < 2) {
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
    const nextIndex = this.comboResetTimer > 0 ? clamp(this.comboIndex + 1, 0, 2) : 0;
    this.startAttack(nextIndex);
    return true;
  }

  private startAttack(index: number): void {
    const attack = this.def.combo[index];
    if (attack === undefined) return;
    this.comboIndex = index;
    this.comboQueued = false;
    this.currentAttack = attack;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'attack';
    this.comboResetTimer = 0;
    this.alreadyHit.clear();
  }

  private endAttack(): void {
    this.currentAttack = null;
    this.comboQueued = false;
    this.attackPhaseTime = 0;
    this.comboResetTimer = ATTACK_CHAIN_RESET;
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
    const blend = 1 - Math.exp(-POSE_DAMPING * dt);
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
        return poseAttack(this.currentAttack?.poseId ?? 'finisher', this.attackPhase());
      case 'hitstun':
        return poseHit();
      case 'launched':
        return poseTumble(t);
      case 'landing':
        return poseLanding();
      case 'ko':
        return poseKO();
      case 'weaponAbility':
      case 'respawning':
        return poseIdle(t);
    }
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
