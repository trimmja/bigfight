import * as THREE from 'three';
import type { AttackDef, ProjectileDef } from '../../data/types';
import { makeToonMaterial } from '../../render/toon';
import { Boss, type BossDefeatedCallback, type BossDropCallback, type BossRequestMinionCallback } from '../Boss';
import type { WorldCtx } from '../Entity';

type GhostPhase = 'hover' | 'volley' | 'beamWarn' | 'beamFire' | 'descend' | 'vulnerable' | 'rise';

const WARNING_BOX = new THREE.BoxGeometry(1, 1, 1);

const ORB_ATTACK: AttackDef = {
  id: 'giantGhostLaserOrb',
  damage: 12,
  baseKb: 9,
  kbGrowth: 0.06,
  angleDeg: 45,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'magic',
  poseId: 'cast',
};

const BEAM_ATTACK: AttackDef = {
  id: 'giantGhostSweepingBeam',
  damage: 14,
  baseKb: 9,
  kbGrowth: 0.06,
  angleDeg: 25,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'shoot',
  poseId: 'shoot',
};

const ORBS: readonly ProjectileDef[] = [
  orbDef(-18),
  orbDef(-8),
  orbDef(0),
  orbDef(8),
  orbDef(18),
  orbDef(28),
];

const BEAM: ProjectileDef = {
  id: 'giantGhostSweepingBeamProjectile',
  speed: 30,
  angleDeg: 0,
  gravityScale: 0,
  lifetime: 2.1,
  radius: 0.46,
  visual: 'laser',
  color: 0xff3048,
  piercing: true,
};

const HOVER_TIME = 1.05;
const VOLLEY_GAP = 0.32;
const BEAM_WARN = 0.8;
const BEAM_FIRE_TIME = 0.16;
const TRANSITION_TIME = 0.72;
const VULNERABLE_TIME = 4;

export class GiantGhost extends Boss {
  private phase: GhostPhase = 'hover';
  private phaseTimer = HOVER_TIME;
  private phaseDuration = HOVER_TIME;
  private hoverTime = 0;
  private volleyCount = 3;
  private volleyIndex = 0;
  private volleyCycle = 0;
  private shotTimer = 0;
  private beamLaneY = 3;
  private beamDir: 1 | -1 = 1;
  private readonly warningMaterial = makeToonMaterial(0xff3048);
  private readonly warningLine = new THREE.Mesh(WARNING_BOX, this.warningMaterial);

  constructor(
    drops: BossDropCallback,
    requestMinion: BossRequestMinionCallback,
    defeated: BossDefeatedCallback,
  ) {
    super('giantGhost', drops, requestMinion, defeated);
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
    this.hoverTime += dt;
    this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    this.warningLine.visible = false;

    switch (this.phase) {
      case 'hover':
        this.updateHover(ctx, dt);
        if (this.phaseTimer === 0) this.enterVolley();
        break;
      case 'volley':
        this.updateHover(ctx, dt);
        this.updateVolley(ctx, dt);
        break;
      case 'beamWarn':
        this.updateHover(ctx, dt);
        this.updateWarningLine(ctx);
        this.requestAttackPose('cast', this.phaseProgress());
        if (this.phaseTimer === 0) this.enterBeamFire(ctx);
        break;
      case 'beamFire':
        this.updateHover(ctx, dt);
        this.requestAttackPose('shoot', 0.5 + this.phaseProgress() * 0.3);
        if (this.phaseTimer === 0) this.enterDescend();
        break;
      case 'descend':
        this.updateDescend(ctx, dt);
        if (this.phaseTimer === 0) this.enterVulnerable();
        break;
      case 'vulnerable':
        this.updateVulnerable(dt);
        if (this.phaseTimer === 0) this.enterRise();
        break;
      case 'rise':
        this.updateHover(ctx, dt);
        if (this.phaseTimer === 0) this.enterHover();
        break;
    }
  }

  private updateHover(ctx: WorldCtx, dt: number): void {
    this.body.noclip = true;
    this.body.gravityScale = 0;
    this.setIntangible(true, 0.58);
    this.setAngry(this.isBelowHp(0.5));
    const range = Math.min(8, Math.max(4, (ctx.stage.blast.right - ctx.stage.blast.left) * 0.16));
    const targetX = Math.sin(this.hoverTime * 0.58) * range;
    const upperY = Math.min(
      ctx.stage.blast.top - this.body.height - 1.2,
      8.1 + Math.sin(this.hoverTime * 1.16) * 1.35,
    );
    this.steerTo(targetX, upperY, 5.1, 20, dt);
    this.requestAttackPose('cast', 0.18 + Math.sin(this.hoverTime * 2.2) * 0.04);
  }

  private updateVolley(ctx: WorldCtx, dt: number): void {
    this.shotTimer = Math.max(0, this.shotTimer - dt);
    if (this.shotTimer > 0) return;
    this.fireOrb(ctx, this.volleyIndex);
    this.volleyIndex += 1;
    this.shotTimer = VOLLEY_GAP;
    if (this.volleyIndex < this.volleyCount) return;
    if (this.isBelowHp(0.5)) this.enterBeamWarn(ctx);
    else this.enterDescend();
  }

  private fireOrb(ctx: WorldCtx, index: number): void {
    const dx = ctx.playerPos.x - this.body.pos.x;
    const facing = dx >= 0 ? 1 : -1;
    this.facing = facing;
    const def = ORBS[index % ORBS.length]!;
    const spreadY = (index - (this.volleyCount - 1) * 0.5) * 0.16;
    ctx.fireProjectile(
      def,
      ORB_ATTACK,
      this.body.pos.x + facing * (this.body.halfW + 0.45),
      this.body.pos.y + this.body.height * 0.56 + spreadY,
      facing,
      'enemy',
      this.power,
    );
    this.telegraphFlash(0x7adfff, 0.08);
  }

  private updateDescend(ctx: WorldCtx, dt: number): void {
    this.body.noclip = true;
    this.body.gravityScale = 0;
    this.setIntangible(true, 0.66);
    this.setAngry(false);
    const side = this.body.pos.x < ctx.playerPos.x ? -1 : 1;
    const targetX = ctx.playerPos.x + side * 2.2;
    const targetY = clampNumber(ctx.playerPos.y + 0.18, 0.45, 5.1);
    this.steerTo(targetX, targetY, 7.5, 28, dt);
    this.requestPose('fall');
  }

  private updateVulnerable(dt: number): void {
    this.body.noclip = false;
    this.body.gravityScale = 0;
    this.setIntangible(false);
    this.setAngry(false);
    this.body.vel.x = moveToward(this.body.vel.x, 0, 16 * dt);
    this.body.vel.y = moveToward(this.body.vel.y, 0, 16 * dt);
    this.preserveVelocity();
    this.requestPose('landing');
  }

  private updateWarningLine(ctx: WorldCtx): void {
    const width = ctx.stage.blast.right - ctx.stage.blast.left + 12;
    this.warningLine.visible = true;
    this.warningLine.position.set(0, this.beamLaneY - this.body.pos.y, 0.44);
    this.warningLine.scale.set(width, 0.12, 0.08);
  }

  private enterHover(): void {
    this.phase = 'hover';
    this.phaseDuration = HOVER_TIME;
    this.phaseTimer = HOVER_TIME;
  }

  private enterVolley(): void {
    this.phase = 'volley';
    this.phaseDuration = 1;
    this.phaseTimer = 1;
    this.volleyCount = this.isBelowHp(0.5) ? 6 : 3 + (this.volleyCycle % 3);
    this.volleyIndex = 0;
    this.volleyCycle += 1;
    this.shotTimer = 0.05;
    this.telegraphFlash(0x7adfff, 0.18);
  }

  private enterBeamWarn(ctx: WorldCtx): void {
    this.phase = 'beamWarn';
    this.phaseDuration = BEAM_WARN;
    this.phaseTimer = BEAM_WARN;
    this.beamLaneY = clampNumber(ctx.playerPos.y + 1.15, 1.25, 8.4);
    this.beamDir = this.beamDir === 1 ? -1 : 1;
    this.telegraphFlash(0xff3048, BEAM_WARN);
  }

  private enterBeamFire(ctx: WorldCtx): void {
    this.phase = 'beamFire';
    this.phaseDuration = BEAM_FIRE_TIME;
    this.phaseTimer = BEAM_FIRE_TIME;
    const startX = this.beamDir === 1 ? ctx.stage.blast.left + 1.2 : ctx.stage.blast.right - 1.2;
    ctx.fireProjectile(BEAM, BEAM_ATTACK, startX, this.beamLaneY, this.beamDir, 'enemy', this.power);
    this.shake(0.45);
  }

  private enterDescend(): void {
    this.phase = 'descend';
    this.phaseDuration = TRANSITION_TIME;
    this.phaseTimer = TRANSITION_TIME;
    this.telegraphFlash(0xffffff, 0.18);
  }

  private enterVulnerable(): void {
    this.phase = 'vulnerable';
    this.phaseDuration = VULNERABLE_TIME;
    this.phaseTimer = VULNERABLE_TIME;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.telegraphFlash(0xffffff, 0.12);
  }

  private enterRise(): void {
    this.phase = 'rise';
    this.phaseDuration = TRANSITION_TIME;
    this.phaseTimer = TRANSITION_TIME;
  }

  private steerTo(targetX: number, targetY: number, speed: number, accel: number, dt: number): void {
    let dx = targetX - this.body.pos.x;
    let dy = targetY - this.body.pos.y;
    const len = Math.hypot(dx, dy);
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
}

function orbDef(angleDeg: number): ProjectileDef {
  return {
    id: `giantGhostLaserOrb${angleDeg}`,
    speed: 4.5,
    angleDeg,
    gravityScale: 0,
    lifetime: 8,
    radius: 0.5,
    visual: 'orb',
    color: 0x7adfff,
    hp: 2,
    homing: 40,
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
