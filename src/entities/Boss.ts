import * as THREE from 'three';
import type { ActiveHitbox, HitResult, Rect } from '../combat/types';
import { events } from '../core/events';
import { clamp } from '../core/math';
import { hypot } from '../core/simmath';
import { simPhase } from '../net/simPhase';
import { bossById } from '../data/enemies';
import type { AttackDef, BossDef, BossId, CharacterDef, Vec2 } from '../data/types';
import { buildBossRig, type BossRig } from '../rigs/bossBuilders';
import { poseAttack, poseFall, poseHit, poseJump, poseLanding } from '../rigs/poses';
import type { WorldCtx } from './Entity';
import { Fighter } from './Fighter';

export type BossMinionRef = { readonly alive: boolean };
export type BossDropCallback = (def: BossDef, x: number, y: number) => void;
export type BossRequestMinionCallback = (enemyId: string, pos: Vec2) => BossMinionRef | null;
export type BossDefeatedCallback = (boss: Boss) => void;

type MutableRigCarrier = { rig: unknown; group: THREE.Group };
type PoseMode = 'attack' | 'hit' | 'jump' | 'fall' | 'landing';
type MinionSlot = { enemyId: string; ref: BossMinionRef };

const DUMMY_HITBOX = { x: 0, y: 0, w: 0, h: 0 };
const DUMMY_ATTACK: AttackDef = {
  id: 'bossDummy',
  damage: 0,
  baseKb: 0,
  kbGrowth: 0,
  angleDeg: 0,
  windup: 0,
  active: 0,
  recover: 0,
  hitbox: DUMMY_HITBOX,
  sfx: 'hitHeavy',
  poseId: 'slam',
};

export abstract class Boss extends Fighter {
  readonly bossId: BossId;
  readonly bossDef: BossDef;

  protected readonly bossRig: BossRig;

  private readonly bossHitRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly bossHitAlready = new Set<object>();
  private readonly bossHitbox: ActiveHitbox = {
    attacker: this,
    def: DUMMY_ATTACK,
    faction: 'enemy',
    teamId: 0,
    alreadyHit: this.bossHitAlready,
    worldRect: () => this.bossHitRect,
  };
  private readonly minions: MinionSlot[] = [];
  private readonly minionSpawnPos: Vec2 = { x: 0, y: 0 };

  private requestedPoseMode: PoseMode | null = null;
  private requestedPoseId = 'slam';
  private requestedPosePhase = 0;
  private requestedPoseBlend = 1;
  private intangible = false;
  private desiredOpacity = 1;
  private defeated = false;
  private currentCtx: WorldCtx | null = null;
  private pendingDefeat = false;
  private lastHpFrac = 1;
  private preserveVelocityFrame = false;
  private preservedVelX = 0;
  private preservedVelY = 0;
  /** Multi-player fairness: round-robin cursor for rotation-targeting bosses. */
  private targetRotation = 0;

  protected constructor(
    bossId: BossId,
    private readonly dropCallback: BossDropCallback,
    private readonly minionCallback: BossRequestMinionCallback,
    private readonly defeatedCallback: BossDefeatedCallback,
  ) {
    const def = bossById(bossId);
    super(toCharacterDef(def), 'enemy');
    this.bossId = bossId;
    this.bossDef = def;

    const rig = buildBossRig(bossId, def) as BossRig;
    this.rig.dispose();
    (this as unknown as MutableRigCarrier).rig = rig;
    (this as unknown as MutableRigCarrier).group = rig.root;
    this.bossRig = rig;
  }

  get hpFrac(): number {
    return clamp(1 - this.damage / this.bossDef.defeatThreshold, 0, 1);
  }

  override update(ctx: WorldCtx, dt: number): void {
    if (!this.alive) return;
    this.currentCtx = ctx;
    this.requestedPoseMode = null;
    this.intangible = false;
    this.desiredOpacity = 1;
    this.preserveVelocityFrame = false;
    this.clearIntents();

    if (this.pendingDefeat || this.damage >= this.bossDef.defeatThreshold) {
      this.defeat(ctx);
      return;
    }

    if (!this.isPausedByHitstopOrHitstun()) this.pattern(ctx, dt);
    super.update(ctx, dt);
    if (this.preserveVelocityFrame) {
      this.body.vel.x = this.preservedVelX;
      this.body.vel.y = this.preservedVelY;
    }

    if (this.state === 'launched') {
      this.state = 'hitstun';
      this.stateTime = Math.min(this.stateTime, 0);
    }
    this.hurtbox.enabled = this.alive && !this.isInvulnerable && !this.intangible;
    if (!simPhase.resimulating) {
      this.bossRig.setGhostOpacity(this.desiredOpacity);
      this.applyRequestedPose();
    }
  }

  /**
   * Ring-out rule (Ryder's design): knocking the boss off the stage costs it
   * 8% of its health, then it falls back in from the sky.
   */
  ringOutPenalty(x: number, y: number): void {
    if (this.defeated || !this.alive) return;
    this.damage += this.bossDef.defeatThreshold * 0.08;
    this.notifyHpChanged();
    this.body.pos.x = x;
    this.body.pos.y = y;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.state = 'fall';
    this.stateTime = 0;
    this.invulnTimer = 1.2; // brief mercy window during the fall-in
    if (!simPhase.resimulating) this.bossRig.flashColor(0xffffff, 0.3);
    if (this.damage >= this.bossDef.defeatThreshold) this.pendingDefeat = true;
  }

  override onHit(result: HitResult): void {
    if (this.defeated) return;
    const hitstun = Math.min(result.hitstun, 0.35);
    super.onHit({
      damage: result.damage,
      kb: Math.min(result.kb, 10),
      angleRad: result.angleRad,
      hitstun,
      launched: false,
    });
    this.clampKnockback();
    this.state = 'hitstun';
    this.stateTime = -hitstun;
    this.notifyHpChanged();
    if (this.damage >= this.bossDef.defeatThreshold) {
      const ctx = this.currentCtx;
      if (ctx) this.defeat(ctx);
      else this.pendingDefeat = true;
    }
  }

  override beginKo(): void {
    super.beginKo();
    this.defeated = true;
  }

  protected abstract pattern(ctx: WorldCtx, dt: number): void;

  // --- multi-player target policies (all collapse to the lone player solo) ---

  /** Nearest-per-decision targeting (grounded chasers: SkeletonKing). */
  protected nearestPlayerPos(ctx: WorldCtx): Vec2 {
    return ctx.nearestAlivePlayer(this.body.pos.x, this.body.pos.y)?.body.pos ?? this.body.pos;
  }

  /** Advance the round-robin cursor — call once per attack CYCLE, not per frame. */
  protected advanceTargetRotation(): void {
    this.targetRotation += 1;
  }

  /**
   * Round-robin targeting (pressure spreads across players: GiantGhost
   * volleys/descents, GiantEagle swoop lanes) — no camping one kid.
   */
  protected rotationPlayerPos(ctx: WorldCtx): Vec2 {
    const players = ctx.players;
    let alive = 0;
    for (let i = 0; i < players.length; i += 1) if (players[i]!.alive) alive += 1;
    if (alive === 0) return this.body.pos;
    let pick = this.targetRotation % alive;
    for (let i = 0; i < players.length; i += 1) {
      const player = players[i]!;
      if (!player.alive) continue;
      if (pick === 0) return player.body.pos;
      pick -= 1;
    }
    return this.body.pos;
  }

  override digestInto(out: number[]): void {
    super.digestInto(out);
    out.push(
      this.intangible ? 1 : 0,
      this.defeated ? 1 : 0,
      this.pendingDefeat ? 1 : 0,
      this.lastHpFrac,
      this.preserveVelocityFrame ? 1 : 0,
      this.preservedVelX,
      this.preservedVelY,
      this.minions.length,
      this.targetRotation,
    );
  }

  protected telegraphFlash(color: number, seconds: number): void {
    if (!simPhase.resimulating) this.bossRig.flashColor(color, seconds);
  }

  protected setIntangible(on: boolean, opacity = 0.56): void {
    this.intangible = on;
    this.desiredOpacity = on ? opacity : 1;
  }

  protected setAngry(on: boolean): void {
    this.bossRig.setAngry?.(on);
  }

  protected requestAttackPose(poseId: string, phase: number, blend = 1): void {
    this.requestedPoseMode = 'attack';
    this.requestedPoseId = poseId;
    this.requestedPosePhase = clamp(phase, 0, 1);
    this.requestedPoseBlend = blend;
  }

  protected requestPose(mode: Exclude<PoseMode, 'attack'>, blend = 1): void {
    this.requestedPoseMode = mode;
    this.requestedPoseBlend = blend;
  }

  protected beginBossHit(): void {
    this.bossHitAlready.clear();
  }

  protected submitBossHitbox(
    ctx: WorldCtx,
    attack: AttackDef,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ): void {
    this.bossHitRect.minX = centerX - width * 0.5;
    this.bossHitRect.maxX = centerX + width * 0.5;
    this.bossHitRect.minY = centerY - height * 0.5;
    this.bossHitRect.maxY = centerY + height * 0.5;
    this.bossHitbox.def = attack;
    ctx.requestHitbox(this.bossHitbox);
  }

  protected requestMinion(enemyId: string, cap: number, x: number, y: number): boolean {
    let live = 0;
    let reusable = -1;
    for (let i = 0; i < this.minions.length; i += 1) {
      const slot = this.minions[i]!;
      if (slot.enemyId !== enemyId) continue;
      if (slot.ref.alive) {
        live += 1;
      } else if (reusable < 0) {
        reusable = i;
      }
    }
    if (live >= cap) return false;

    this.minionSpawnPos.x = x;
    this.minionSpawnPos.y = y;
    const ref = this.minionCallback(enemyId, this.minionSpawnPos);
    if (!ref) return false;

    if (reusable >= 0) {
      this.minions[reusable] = { enemyId, ref };
    } else {
      this.minions.push({ enemyId, ref });
    }
    return true;
  }

  protected isBelowHp(frac: number): boolean {
    return this.hpFrac <= frac;
  }

  protected shake(amount: number): void {
    events.emit('screenShake', { amount });
  }

  protected preserveVelocity(): void {
    this.preserveVelocityFrame = true;
    this.preservedVelX = this.body.vel.x;
    this.preservedVelY = this.body.vel.y;
  }

  protected clearIntents(): void {
    this.intents.moveX = 0;
    this.intents.moveY = 0;
    this.intents.jumpPressed = false;
    this.intents.attackPressed = false;
    this.intents.weaponPressed = false;
  }

  private isPausedByHitstopOrHitstun(): boolean {
    return this.hitstopTimer > 0 || (this.state === 'hitstun' && this.stateTime < 0);
  }

  private applyRequestedPose(): void {
    const mode = this.requestedPoseMode;
    if (!mode) return;
    switch (mode) {
      case 'attack':
        this.bossRig.setPose(poseAttack(this.requestedPoseId, this.requestedPosePhase), this.requestedPoseBlend);
        break;
      case 'hit':
        this.bossRig.setPose(poseHit(), this.requestedPoseBlend);
        break;
      case 'jump':
        this.bossRig.setPose(poseJump(), this.requestedPoseBlend);
        break;
      case 'fall':
        this.bossRig.setPose(poseFall(), this.requestedPoseBlend);
        break;
      case 'landing':
        this.bossRig.setPose(poseLanding(), this.requestedPoseBlend);
        break;
    }
  }

  private clampKnockback(): void {
    const max = 4.8;
    const speed = hypot(this.body.vel.x, this.body.vel.y);
    if (speed <= max || speed <= 0.0001) return;
    const s = max / speed;
    this.body.vel.x *= s;
    this.body.vel.y *= s;
  }

  private notifyHpChanged(): void {
    const frac = this.hpFrac;
    if (Math.abs(frac - this.lastHpFrac) < 0.0001) return;
    this.lastHpFrac = frac;
    events.emit('bossHp', { frac });
  }

  private defeat(ctx: WorldCtx): void {
    if (this.defeated) return;
    this.defeated = true;
    this.pendingDefeat = false;
    const x = this.body.pos.x;
    const y = this.body.pos.y + this.body.height * 0.5;
    events.emit('bossHp', { frac: 0 });
    events.emit('bossDefeated', { name: this.bossDef.name });
    events.emit('screenShake', { amount: 1.6 });
    if (!simPhase.resimulating) {
      ctx.particles.koExplosion(x, y, this.bossDef.palette.accent);
      ctx.particles.burst(x, y, 0xffffff, 42, 10);
    }
    this.dropCallback(this.bossDef, x, y);
    super.beginKo();
    this.defeatedCallback(this);
  }
}

function toCharacterDef(def: BossDef): CharacterDef {
  return {
    id: def.id,
    name: def.name,
    tagline: def.title,
    archetype: 'monster',
    speed: speedFor(def.id),
    power: 1,
    weight: def.weight,
    jumpVel: 13,
    jumps: 1,
    combo: [DUMMY_ATTACK, DUMMY_ATTACK, DUMMY_ATTACK],
    palette: def.palette,
    proportions: {
      height: 1.8 * def.scale,
      bulk: bulkFor(def.id),
      headSize: 1.25,
    },
    unlock: { type: 'starter' },
  };
}

function speedFor(id: BossId): number {
  switch (id) {
    case 'skeletonKing':
      return 2.2;
    case 'giantGhost':
      return 3.4;
    case 'giantEagle':
      return 6.2;
  }
}

function bulkFor(id: BossId): number {
  switch (id) {
    case 'skeletonKing':
      return 2.5;
    case 'giantGhost':
      return 2.9;
    case 'giantEagle':
      return 3.1;
  }
}
