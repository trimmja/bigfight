import * as THREE from 'three';
import { hypot } from '../../core/simmath';
import { simPhase } from '../../net/simPhase';
import type { AttackDef, ProjectileDef } from '../../data/types';
import { makeToonMaterial } from '../../render/toon';
import { Boss, type BossDefeatedCallback, type BossDropCallback, type BossRequestMinionCallback } from '../Boss';
import type { WorldCtx } from '../Entity';

type EaglePhase = 'perch' | 'fan' | 'screech' | 'swoopWarn' | 'swoop' | 'rest';

const WARNING_BOX = new THREE.BoxGeometry(1, 1, 1);

const FEATHER_ATTACK: AttackDef = {
  id: 'giantEagleFeather',
  damage: 8,
  baseKb: 5.5,
  kbGrowth: 0.05,
  angleDeg: 30,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'shoot',
  poseId: 'shoot',
};

const SWOOP_ATTACK: AttackDef = {
  id: 'giantEagleCrossStageSwoop',
  damage: 14,
  baseKb: 9,
  kbGrowth: 0.06,
  angleDeg: 60,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'swoop',
};

const FEATHERS: readonly ProjectileDef[] = [
  featherDef(-24),
  featherDef(-10),
  featherDef(4),
  featherDef(18),
  featherDef(32),
];

const PHASE_IDS: Record<EaglePhase, number> = {
  perch: 0,
  fan: 1,
  screech: 2,
  swoopWarn: 3,
  swoop: 4,
  rest: 5,
};

const PERCH_WAIT = 0.95;
const FAN_GAP = 0.55;
const SCREECH_TIME = 0.55;
const SWOOP_WARN = 0.7;
const SWOOP_WARN_PAIR = 0.45;
const SWOOP_MAX = 1.35;
const REST_TIME = 3;

export class GiantEagle extends Boss {
  private phase: EaglePhase = 'perch';
  private phaseTimer = PERCH_WAIT;
  private phaseDuration = PERCH_WAIT;
  private fanIndex = 0;
  private shotTimer = 0;
  private perchSide: 1 | -1 = 1;
  private targetSide: 1 | -1 = -1;
  private chainRemaining = 1;
  private swoopLaneY = 2.4;
  private swoopFeetY = 0.5;
  private leftX = -7;
  private leftY = 4.2;
  private rightX = 7;
  private rightY = 4.2;
  private perchesReady = false;
  private readonly warningMaterial = makeToonMaterial(0xff3048);
  private readonly warningLine = new THREE.Mesh(WARNING_BOX, this.warningMaterial);

  constructor(
    drops: BossDropCallback,
    requestMinion: BossRequestMinionCallback,
    defeated: BossDefeatedCallback,
  ) {
    super('giantEagle', drops, requestMinion, defeated);
    this.body.gravityScale = 0;
    this.body.noclip = true;
    this.warningMaterial.transparent = true;
    this.warningMaterial.opacity = 0.34;
    this.warningMaterial.depthWrite = false;
    this.warningLine.visible = false;
    this.warningLine.renderOrder = 8;
    this.group.add(this.warningLine);
  }

  override dispose(): void {
    this.warningLine.removeFromParent();
    this.warningMaterial.dispose();
    super.dispose();
  }

  protected override pattern(ctx: WorldCtx, dt: number): void {
    this.ensurePerches(ctx);
    this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    if (!simPhase.resimulating) this.warningLine.visible = false;

    switch (this.phase) {
      case 'perch':
        this.updatePerch(dt, 7.5);
        if (this.phaseTimer === 0 && this.distanceToPerchSq() < 0.75 * 0.75) this.enterFan();
        break;
      case 'fan':
        this.updatePerch(dt, 5.5);
        this.updateFan(ctx, dt);
        break;
      case 'screech':
        this.updatePerch(dt, 5.5);
        this.requestAttackPose('cast', 0.45 + this.phaseProgress() * 0.18);
        if (this.phaseTimer === 0) this.enterSwoopWarn(ctx, SWOOP_WARN);
        break;
      case 'swoopWarn':
        this.updateWarningLine(ctx);
        this.updatePerch(dt, 5.5);
        this.requestAttackPose('swoop', this.phaseProgress() * 0.28);
        if (this.phaseTimer === 0) this.enterSwoop();
        break;
      case 'swoop':
        this.updateSwoop(ctx, dt);
        break;
      case 'rest':
        this.updatePerch(dt, 7);
        this.requestPose('landing');
        if (this.phaseTimer === 0) this.enterFan();
        break;
    }
  }

  private updatePerch(dt: number, speed: number): void {
    this.body.noclip = false;
    this.body.gravityScale = 0;
    this.setIntangible(false);
    const targetX = this.perchSide === -1 ? this.leftX : this.rightX;
    const targetY = this.perchSide === -1 ? this.leftY : this.rightY;
    this.facing = this.perchSide === -1 ? 1 : -1;
    this.steerTo(targetX, targetY, speed, 28, dt);
  }

  private updateFan(ctx: WorldCtx, dt: number): void {
    this.shotTimer = Math.max(0, this.shotTimer - dt);
    this.requestAttackPose('shoot', 0.3 + (this.fanIndex % 2) * 0.14);
    if (this.shotTimer > 0) return;
    this.fireFeatherFan(ctx);
    this.fanIndex += 1;
    if (this.fanIndex < 2) {
      this.shotTimer = FAN_GAP;
      return;
    }
    this.enterScreech(ctx);
  }

  private fireFeatherFan(ctx: WorldCtx): void {
    const facing = this.perchSide === -1 ? 1 : -1;
    this.facing = facing;
    const x = this.body.pos.x + facing * (this.body.halfW + 0.45);
    const y = this.body.pos.y + this.body.height * 0.56;
    for (let i = 0; i < FEATHERS.length; i += 1) {
      ctx.fireProjectile(FEATHERS[i]!, FEATHER_ATTACK, x, y, facing, 'enemy', this.teamId, this.power);
    }
    if (!simPhase.resimulating) ctx.particles.directional(x, y, facing, 0.15, 0xffd94a, 18, 5.5);
  }

  private updateSwoop(ctx: WorldCtx, dt: number): void {
    this.body.noclip = true;
    this.body.gravityScale = 0;
    this.setIntangible(false);
    const dir = this.targetSide;
    this.facing = dir;
    this.body.vel.x = dir * 22;
    this.body.vel.y = moveToward(this.body.vel.y, (this.swoopFeetY - this.body.pos.y) * 8, 34 * dt);
    this.preserveVelocity();
    this.requestAttackPose('swoop', 0.28 + this.phaseProgress() * 0.58);
    this.submitBossHitbox(
      ctx,
      SWOOP_ATTACK,
      this.body.pos.x + dir * 0.2,
      this.body.pos.y + this.body.height * 0.48,
      3.5,
      2.35,
    );

    const reached = dir === 1
      ? this.body.pos.x >= this.rightX
      : this.body.pos.x <= this.leftX;
    if (!reached && this.phaseTimer > 0) return;

    this.perchSide = this.targetSide;
    this.body.pos.x = this.perchSide === -1 ? this.leftX : this.rightX;
    this.body.pos.y = this.swoopFeetY;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.chainRemaining -= 1;
    if (this.chainRemaining > 0) this.enterSwoopWarn(ctx, SWOOP_WARN_PAIR);
    else this.enterRest();
  }

  private enterFan(): void {
    this.phase = 'fan';
    this.phaseDuration = 1.2;
    this.phaseTimer = 1.2;
    this.fanIndex = 0;
    this.shotTimer = 0.08;
  }

  private enterScreech(ctx: WorldCtx): void {
    this.phase = 'screech';
    this.phaseDuration = SCREECH_TIME;
    this.phaseTimer = SCREECH_TIME;
    this.chainRemaining = this.isBelowHp(0.4) ? 2 : 1;
    this.telegraphFlash(0xffd94a, SCREECH_TIME);
    this.shake(0.78);
    if (!simPhase.resimulating) {
      ctx.particles.burst(this.body.pos.x, this.body.pos.y + this.body.height * 0.58, 0xffd94a, 34, 8);
    }
    for (let i = 0; i < 3; i += 1) {
      const side = i - 1;
      this.requestMinion('miniEagle', 4, this.body.pos.x + side * 0.9, this.body.pos.y + this.body.height * 0.52);
    }
  }

  private enterSwoopWarn(ctx: WorldCtx, duration: number): void {
    this.phase = 'swoopWarn';
    this.advanceTargetRotation(); // each swoop hunts the next player's lane
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.targetSide = this.perchSide === 1 ? -1 : 1;
    if (this.chainRemaining <= 0) this.chainRemaining = 1;
    this.swoopLaneY = clampNumber(this.rotationPlayerPos(ctx).y + 1.15, 1.3, 7.8);
    this.swoopFeetY = Math.max(0.35, this.swoopLaneY - this.body.height * 0.48);
    this.telegraphFlash(0xff3048, duration);
  }

  private enterSwoop(): void {
    this.phase = 'swoop';
    this.phaseDuration = SWOOP_MAX;
    this.phaseTimer = SWOOP_MAX;
    this.beginBossHit();
    this.body.pos.y = this.swoopFeetY;
    this.body.grounded = false;
    this.shake(0.45);
  }

  private enterRest(): void {
    this.phase = 'rest';
    this.phaseDuration = REST_TIME;
    this.phaseTimer = REST_TIME;
    this.chainRemaining = 0;
    this.telegraphFlash(0xffffff, 0.12);
  }

  private updateWarningLine(ctx: WorldCtx): void {
    if (simPhase.resimulating) return;
    const width = ctx.stage.blast.right - ctx.stage.blast.left + 12;
    this.warningLine.visible = true;
    this.warningLine.position.set(0, this.swoopLaneY - this.body.pos.y, 0.44);
    this.warningLine.scale.set(width, 0.14, 0.08);
  }

  private ensurePerches(ctx: WorldCtx): void {
    if (this.perchesReady) return;
    this.perchesReady = true;
    const colliders = ctx.stage.colliders;
    let foundLeft = false;
    let foundRight = false;
    for (let i = 0; i < colliders.oneWays.length; i += 1) {
      const platform = colliders.oneWays[i]!;
      const center = (platform.minX + platform.maxX) * 0.5;
      if (center < 0 && (!foundLeft || platform.y > this.leftY)) {
        this.leftX = center;
        this.leftY = platform.y + 0.18;
        foundLeft = true;
      } else if (center >= 0 && (!foundRight || platform.y > this.rightY)) {
        this.rightX = center;
        this.rightY = platform.y + 0.18;
        foundRight = true;
      }
    }
    if (foundLeft && foundRight) return;

    const main = colliders.solids[0];
    if (!main) return;
    if (!foundLeft) {
      this.leftX = main.minX + 2.2;
      this.leftY = main.maxY + 0.18;
    }
    if (!foundRight) {
      this.rightX = main.maxX - 2.2;
      this.rightY = main.maxY + 0.18;
    }
  }

  private distanceToPerchSq(): number {
    const targetX = this.perchSide === -1 ? this.leftX : this.rightX;
    const targetY = this.perchSide === -1 ? this.leftY : this.rightY;
    const dx = targetX - this.body.pos.x;
    const dy = targetY - this.body.pos.y;
    return dx * dx + dy * dy;
  }

  private steerTo(targetX: number, targetY: number, speed: number, accel: number, dt: number): void {
    let dx = targetX - this.body.pos.x;
    let dy = targetY - this.body.pos.y;
    const len = hypot(dx, dy);
    if (len > 0.001) {
      dx /= len;
      dy /= len;
    } else {
      dx = 0;
      dy = 0;
    }
    this.body.vel.x = moveToward(this.body.vel.x, dx * speed, accel * dt);
    this.body.vel.y = moveToward(this.body.vel.y, dy * speed, accel * dt);
    this.preserveVelocity();
  }

  private phaseProgress(): number {
    return 1 - this.phaseTimer / Math.max(0.0001, this.phaseDuration);
  }

  override digestInto(out: number[]): void {
    super.digestInto(out);
    out.push(
      PHASE_IDS[this.phase],
      this.phaseTimer,
      this.phaseDuration,
      this.fanIndex,
      this.shotTimer,
      this.perchSide,
      this.targetSide,
      this.chainRemaining,
      this.swoopLaneY,
      this.swoopFeetY,
      this.leftX,
      this.leftY,
      this.rightX,
      this.rightY,
      this.perchesReady ? 1 : 0,
    );
  }
}

function featherDef(angleDeg: number): ProjectileDef {
  return {
    id: `giantEagleFeather${angleDeg}`,
    speed: 12,
    angleDeg,
    gravityScale: 0.15,
    lifetime: 3,
    radius: 0.22,
    visual: 'feather',
    color: 0xffd94a,
  };
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}

function clampNumber(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
