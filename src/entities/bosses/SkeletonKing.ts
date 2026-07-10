import type { AttackDef, ProjectileDef } from '../../data/types';
import type { WorldCtx } from '../Entity';
import { Boss, type BossDefeatedCallback, type BossDropCallback, type BossRequestMinionCallback } from '../Boss';

type SkeletonPhase =
  | 'stalk'
  | 'slamTelegraph'
  | 'slamActive'
  | 'sweepTelegraph'
  | 'sweepActive'
  | 'jumpTelegraph'
  | 'jumpAir'
  | 'jumpLand'
  | 'recover';

const SLAM_ATTACK: AttackDef = {
  id: 'skeletonKingOverheadSlam',
  damage: 18,
  baseKb: 11,
  kbGrowth: 0.08,
  angleDeg: 55,
  windup: 0,
  active: 0.2,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'slam',
};

const SWEEP_ATTACK: AttackDef = {
  id: 'skeletonKingSweep',
  damage: 8,
  baseKb: 6,
  kbGrowth: 0.06,
  angleDeg: 25,
  windup: 0,
  active: 0.18,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'slash',
  poseId: 'slash',
};

const LANDING_ATTACK: AttackDef = {
  id: 'skeletonKingJumpLanding',
  damage: 12,
  baseKb: 8,
  kbGrowth: 0.05,
  angleDeg: 75,
  windup: 0,
  active: 0.18,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'slam',
};

const SHOCKWAVE_ATTACK: AttackDef = {
  id: 'skeletonKingShockwave',
  damage: 10,
  baseKb: 7,
  kbGrowth: 0.05,
  angleDeg: 70,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'slam',
};

const SHOCKWAVE: ProjectileDef = {
  id: 'skeletonKingShockwaveProjectile',
  speed: 9,
  angleDeg: 0,
  gravityScale: 0,
  lifetime: 1.6,
  radius: 0.42,
  visual: 'shockwave',
  color: 0xfff6df,
};

const STALK_MIN = 0.85;
const STALK_MAX = 2.2;
const SLAM_TELEGRAPH = 0.7;
const SLAM_ACTIVE = 0.28;
const SWEEP_TELEGRAPH = 0.24;
const SWEEP_ACTIVE = 0.32;
const JUMP_TELEGRAPH = 0.58;
const JUMP_LAND_ACTIVE = 0.24;
const RECOVER = 1.5;
const SUMMON_INTERVAL = 15;

export class SkeletonKing extends Boss {
  private phase: SkeletonPhase = 'stalk';
  private phaseTimer = STALK_MAX;
  private phaseDuration = STALK_MAX;
  private summonTimer = SUMMON_INTERVAL;
  private jumpTargetX = 0;
  private jumpAge = 0;
  private shockwavesFired = false;

  constructor(
    drops: BossDropCallback,
    requestMinion: BossRequestMinionCallback,
    defeated: BossDefeatedCallback,
  ) {
    super('skeletonKing', drops, requestMinion, defeated);
    this.body.gravityScale = 1;
  }

  protected override pattern(ctx: WorldCtx, dt: number): void {
    this.updateSummons(dt);
    this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    const dx = ctx.playerPos.x - this.body.pos.x;
    if (Math.abs(dx) > 0.08) this.facing = dx >= 0 ? 1 : -1;

    switch (this.phase) {
      case 'stalk':
        this.updateStalk(dx);
        break;
      case 'slamTelegraph':
        this.body.vel.x *= 0.82;
        this.requestAttackPose('slam', this.phaseProgress() * 0.32);
        if (this.phaseTimer === 0) this.enterSlamActive(ctx);
        break;
      case 'slamActive':
        this.requestAttackPose('slam', 0.35 + this.phaseProgress() * 0.36);
        this.submitBossHitbox(
          ctx,
          SLAM_ATTACK,
          this.body.pos.x + this.facing * (this.body.halfW + 1.25),
          this.body.pos.y + this.body.height * 0.36,
          3.3,
          2.65,
        );
        if (this.phaseTimer === 0) this.enterSweepTelegraph();
        break;
      case 'sweepTelegraph':
        this.body.vel.x *= 0.86;
        this.requestAttackPose('slash', this.phaseProgress() * 0.28);
        if (this.phaseTimer === 0) this.enterSweepActive(ctx);
        break;
      case 'sweepActive':
        this.requestAttackPose('slash', 0.3 + this.phaseProgress() * 0.46);
        this.submitBossHitbox(
          ctx,
          SWEEP_ATTACK,
          this.body.pos.x + this.facing * (this.body.halfW + 1.2),
          this.body.pos.y + this.body.height * 0.34,
          4.4,
          1.45,
        );
        if (this.phaseTimer === 0) {
          if (this.isBelowHp(0.5)) this.enterJumpTelegraph(ctx.playerPos.x);
          else this.enterRecover();
        }
        break;
      case 'jumpTelegraph':
        this.body.vel.x *= 0.78;
        this.requestAttackPose('slam', this.phaseProgress() * 0.25);
        if (this.phaseTimer === 0) this.enterJumpAir();
        break;
      case 'jumpAir':
        this.jumpAge += dt;
        this.requestPose(this.body.vel.y >= 0 ? 'jump' : 'fall');
        this.preserveVelocity();
        if (this.jumpAge > 0.2 && this.body.grounded) this.enterJumpLand(ctx);
        break;
      case 'jumpLand':
        this.requestAttackPose('slam', 0.45 + this.phaseProgress() * 0.42);
        this.submitBossHitbox(
          ctx,
          LANDING_ATTACK,
          this.body.pos.x,
          this.body.pos.y + this.body.height * 0.22,
          3.4,
          1.8,
        );
        if (this.phaseTimer === 0) this.enterRecover();
        break;
      case 'recover':
        this.body.vel.x *= 0.86;
        this.requestPose('hit');
        if (this.phaseTimer === 0) this.enterStalk();
        break;
    }
  }

  private updateStalk(dx: number): void {
    const absDx = Math.abs(dx);
    this.intents.moveX = absDx > 1.9 ? Math.sign(dx) : 0;
    if (this.body.grounded && absDx > 0.1) this.facing = dx >= 0 ? 1 : -1;
    if (this.phaseTimer <= STALK_MAX - STALK_MIN && (absDx < 2.7 || this.phaseTimer === 0)) {
      this.enterSlamTelegraph();
    }
  }

  private updateSummons(dt: number): void {
    this.summonTimer = Math.max(0, this.summonTimer - dt);
    if (this.summonTimer > 0) return;
    this.summonTimer = SUMMON_INTERVAL;
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      this.requestMinion(
        'skeleton',
        3,
        this.body.pos.x + side * (1.6 + i * 0.35),
        this.body.pos.y + 0.35,
      );
    }
  }

  private enterStalk(): void {
    this.phase = 'stalk';
    this.phaseDuration = STALK_MAX;
    this.phaseTimer = STALK_MAX;
  }

  private enterSlamTelegraph(): void {
    const duration = this.telegraphDuration(SLAM_TELEGRAPH);
    this.phase = 'slamTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.telegraphFlash(0xffffff, duration);
  }

  private enterSlamActive(ctx: WorldCtx): void {
    this.phase = 'slamActive';
    this.phaseDuration = SLAM_ACTIVE;
    this.phaseTimer = SLAM_ACTIVE;
    this.beginBossHit();
    this.shake(0.65);
    ctx.particles.directional(
      this.body.pos.x + this.facing * 1.4,
      this.body.pos.y + 0.25,
      this.facing,
      0.45,
      0xffffff,
      24,
      7,
    );
  }

  private enterSweepTelegraph(): void {
    const duration = this.telegraphDuration(SWEEP_TELEGRAPH);
    this.phase = 'sweepTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.telegraphFlash(0xffd23e, duration);
  }

  private enterSweepActive(ctx: WorldCtx): void {
    this.phase = 'sweepActive';
    this.phaseDuration = SWEEP_ACTIVE;
    this.phaseTimer = SWEEP_ACTIVE;
    this.beginBossHit();
    ctx.particles.directional(
      this.body.pos.x + this.facing * 1.2,
      this.body.pos.y + this.body.height * 0.38,
      this.facing,
      0.1,
      0xffd23e,
      18,
      6,
    );
  }

  private enterJumpTelegraph(targetX: number): void {
    const duration = this.telegraphDuration(JUMP_TELEGRAPH);
    this.phase = 'jumpTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.jumpTargetX = targetX;
    this.telegraphFlash(0xfff6df, duration);
  }

  private enterJumpAir(): void {
    this.phase = 'jumpAir';
    this.phaseDuration = 1.4;
    this.phaseTimer = 1.4;
    this.jumpAge = 0;
    const dx = this.jumpTargetX - this.body.pos.x;
    this.body.vel.x = clampNumber(dx * 1.35, -9, 9);
    this.body.vel.y = 14.5;
    this.body.grounded = false;
    this.state = 'jump';
    this.preserveVelocity();
  }

  private enterJumpLand(ctx: WorldCtx): void {
    this.phase = 'jumpLand';
    this.phaseDuration = JUMP_LAND_ACTIVE;
    this.phaseTimer = JUMP_LAND_ACTIVE;
    this.body.vel.x = 0;
    this.beginBossHit();
    this.fireShockwaves(ctx);
    this.shake(1.0);
  }

  private fireShockwaves(ctx: WorldCtx): void {
    if (this.shockwavesFired) return;
    this.shockwavesFired = true;
    const y = this.body.pos.y + 0.32;
    ctx.fireProjectile(SHOCKWAVE, SHOCKWAVE_ATTACK, this.body.pos.x - 0.55, y, -1, 'enemy', this.teamId, this.power);
    ctx.fireProjectile(SHOCKWAVE, SHOCKWAVE_ATTACK, this.body.pos.x + 0.55, y, 1, 'enemy', this.teamId, this.power);
  }

  private enterRecover(): void {
    this.phase = 'recover';
    this.phaseDuration = RECOVER;
    this.phaseTimer = RECOVER;
    this.shockwavesFired = false;
  }

  private phaseProgress(): number {
    return 1 - this.phaseTimer / Math.max(0.0001, this.phaseDuration);
  }

  private telegraphDuration(base: number): number {
    return this.isBelowHp(0.5) ? base * 0.75 : base;
  }
}

function clampNumber(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
