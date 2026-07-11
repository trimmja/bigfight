import { simPhase } from '../../net/simPhase';
import type { AttackDef, ProjectileDef } from '../../data/types';
import type { WorldCtx } from '../Entity';
import { Boss, type BossDefeatedCallback, type BossDropCallback, type BossRequestMinionCallback } from '../Boss';

/**
 * THE MOLTEN KING — the campaign's final boss, tuned to be the hardest fight
 * in the game: a full attack cycle (punch → lava volley → meteor eruption),
 * magma-slime summons, an enrage at half health (faster telegraphs, bigger
 * volleys, angry eyes), and a charging RAMPAGE that only unlocks below 40%.
 * Everything still telegraphs clearly — hard, never unfair (Ryder's rule).
 */

type GolemPhase =
  | 'stalk'
  | 'punchTelegraph'
  | 'punchActive'
  | 'volleyTelegraph'
  | 'volleyActive'
  | 'eruptTelegraph'
  | 'eruptActive'
  | 'rampageTelegraph'
  | 'rampageActive'
  | 'recover';

const PUNCH_ATTACK: AttackDef = {
  id: 'lavaGolemPunch',
  damage: 20,
  baseKb: 12,
  kbGrowth: 0.09,
  angleDeg: 50,
  windup: 0,
  active: 0.22,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'slam',
};

const RAMPAGE_ATTACK: AttackDef = {
  id: 'lavaGolemRampage',
  damage: 16,
  baseKb: 10,
  kbGrowth: 0.07,
  angleDeg: 40,
  windup: 0,
  active: 0.2,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'lunge',
};

const SHOCKWAVE_ATTACK: AttackDef = {
  id: 'lavaGolemShockwave',
  damage: 11,
  baseKb: 7.5,
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
  id: 'lavaGolemShockwaveProjectile',
  speed: 10,
  angleDeg: 0,
  gravityScale: 0,
  lifetime: 1.7,
  radius: 0.46,
  visual: 'shockwave',
  color: 0xff8a3c,
};

const VOLLEY_ATTACK: AttackDef = {
  id: 'lavaGolemVolley',
  damage: 12,
  baseKb: 8,
  kbGrowth: 0.06,
  angleDeg: 60,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'cast',
};

const VOLLEY_BLOB: ProjectileDef = {
  id: 'lavaGolemVolleyBlob',
  speed: 11,
  angleDeg: 52,
  gravityScale: 1,
  lifetime: 3.4,
  radius: 0.36,
  visual: 'orb',
  color: 0xff6a2e,
  explodeRadius: 2.1,
  trailColor: 0xffa03c,
};

const METEOR_ATTACK: AttackDef = {
  id: 'lavaGolemMeteor',
  damage: 14,
  baseKb: 9,
  kbGrowth: 0.07,
  angleDeg: 75,
  windup: 0,
  active: 0.08,
  recover: 0,
  hitbox: { x: 0, y: 0, w: 0, h: 0 },
  sfx: 'hitHeavy',
  poseId: 'slam',
};

const METEOR: ProjectileDef = {
  id: 'lavaGolemMeteorRock',
  speed: 17,
  angleDeg: 0, // per-shot angle set via facing/velocity math below
  gravityScale: 1,
  lifetime: 4,
  radius: 0.4,
  visual: 'rocket',
  color: 0xff5a2e,
  explodeRadius: 2.3,
  trailColor: 0xffd94a,
};

const PHASE_IDS: Record<GolemPhase, number> = {
  stalk: 0,
  punchTelegraph: 1,
  punchActive: 2,
  volleyTelegraph: 3,
  volleyActive: 4,
  eruptTelegraph: 5,
  eruptActive: 6,
  rampageTelegraph: 7,
  rampageActive: 8,
  recover: 9,
};

const PHASE_NAMES: readonly GolemPhase[] = [
  'stalk',
  'punchTelegraph',
  'punchActive',
  'volleyTelegraph',
  'volleyActive',
  'eruptTelegraph',
  'eruptActive',
  'rampageTelegraph',
  'rampageActive',
  'recover',
];

const STALK_MIN = 0.6;
const STALK_MAX = 1.7;
const PUNCH_TELEGRAPH = 0.55;
const PUNCH_ACTIVE = 0.26;
const VOLLEY_TELEGRAPH = 0.6;
const VOLLEY_ACTIVE = 0.5;
const ERUPT_TELEGRAPH = 0.85;
const ERUPT_ACTIVE = 0.4;
const RAMPAGE_TELEGRAPH = 0.7;
const RAMPAGE_ACTIVE = 1.25;
const RAMPAGE_SPEED = 10.5;
const RECOVER = 1.1;
const SUMMON_INTERVAL = 12;
/** Attack cycle after each stalk: punch if close, else volley; erupt every 3rd. */

export class LavaGolem extends Boss {
  private phase: GolemPhase = 'stalk';
  private phaseTimer = STALK_MAX;
  private phaseDuration = STALK_MAX;
  private summonTimer = SUMMON_INTERVAL;
  private cycleCount = 0;
  private volleyShotsFired = 0;
  private meteorsFired = false;
  private rampageDir: 1 | -1 = 1;
  private rampageUsed = false;

  constructor(
    drops: BossDropCallback,
    requestMinion: BossRequestMinionCallback,
    defeated: BossDefeatedCallback,
  ) {
    super('lavaGolem', drops, requestMinion, defeated);
    this.body.gravityScale = 1;
  }

  protected override pattern(ctx: WorldCtx, dt: number): void {
    this.setAngry(this.isBelowHp(0.5));
    this.updateSummons(dt);
    this.phaseTimer = Math.max(0, this.phaseTimer - dt);
    const targetPos = this.nearestPlayerPos(ctx);
    const dx = targetPos.x - this.body.pos.x;
    if (this.phase !== 'rampageActive' && Math.abs(dx) > 0.08) this.facing = dx >= 0 ? 1 : -1;

    switch (this.phase) {
      case 'stalk':
        this.updateStalk(dx);
        break;
      case 'punchTelegraph':
        this.body.vel.x *= 0.8;
        this.requestAttackPose('slam', this.phaseProgress() * 0.32);
        if (this.phaseTimer === 0) this.enterPunchActive(ctx);
        break;
      case 'punchActive':
        this.requestAttackPose('slam', 0.35 + this.phaseProgress() * 0.4);
        this.submitBossHitbox(
          ctx,
          PUNCH_ATTACK,
          this.body.pos.x + this.facing * (this.body.halfW + 1.35),
          this.body.pos.y + this.body.height * 0.34,
          3.6,
          2.8,
        );
        if (this.phaseTimer === 0) this.enterRecover();
        break;
      case 'volleyTelegraph':
        this.body.vel.x *= 0.84;
        this.requestAttackPose('cast', this.phaseProgress() * 0.3);
        if (this.phaseTimer === 0) this.enterVolleyActive();
        break;
      case 'volleyActive':
        this.requestAttackPose('cast', 0.32 + this.phaseProgress() * 0.5);
        this.updateVolley(ctx);
        if (this.phaseTimer === 0) this.enterRecover();
        break;
      case 'eruptTelegraph':
        this.body.vel.x *= 0.8;
        this.requestAttackPose('slam', this.phaseProgress() * 0.3);
        if (this.phaseTimer === 0) this.enterEruptActive(ctx);
        break;
      case 'eruptActive':
        this.requestAttackPose('slam', 0.4 + this.phaseProgress() * 0.45);
        if (this.phaseTimer === 0) this.enterRecover();
        break;
      case 'rampageTelegraph':
        this.body.vel.x *= 0.75;
        this.requestAttackPose('lunge', this.phaseProgress() * 0.3);
        if (this.phaseTimer === 0) this.enterRampageActive();
        break;
      case 'rampageActive':
        this.facing = this.rampageDir;
        this.body.vel.x = this.rampageDir * RAMPAGE_SPEED;
        this.preserveVelocity();
        this.requestAttackPose('lunge', 0.4 + this.phaseProgress() * 0.4);
        this.submitBossHitbox(
          ctx,
          RAMPAGE_ATTACK,
          this.body.pos.x + this.rampageDir * (this.body.halfW + 0.6),
          this.body.pos.y + this.body.height * 0.4,
          2.6,
          3.2,
        );
        if (!simPhase.resimulating && this.phaseTimer > 0.05) {
          ctx.particles.directional(this.body.pos.x, this.body.pos.y + 0.3, -this.rampageDir as 1 | -1, 0.2, 0xff8a3c, 4, 5);
        }
        // Stop at the arena edge so he never charges into the blast zone.
        if (this.phaseTimer === 0 || this.hitArenaEdge(ctx)) this.enterRecover();
        break;
      case 'recover':
        this.body.vel.x *= 0.84;
        this.requestPose('hit');
        if (this.phaseTimer === 0) this.enterStalk();
        break;
    }
  }

  private updateStalk(dx: number): void {
    const absDx = Math.abs(dx);
    this.intents.moveX = absDx > 2.1 ? Math.sign(dx) : 0;
    if (this.body.grounded && absDx > 0.1) this.facing = dx >= 0 ? 1 : -1;
    if (this.phaseTimer > STALK_MAX - STALK_MIN) return;
    if (absDx >= 2.9 && this.phaseTimer > 0) return;

    // Deterministic attack cycle: every 3rd pick erupts; below 40% HP the
    // rampage joins the rotation; otherwise close → punch, far → volley.
    this.cycleCount += 1;
    if (this.isBelowHp(0.4) && !this.rampageUsed) {
      this.rampageUsed = true;
      this.enterRampageTelegraph();
    } else if (this.cycleCount % 3 === 0) {
      this.enterEruptTelegraph();
    } else if (Math.abs(dx) < 3.2) {
      this.rampageUsed = false;
      this.enterPunchTelegraph();
    } else {
      this.rampageUsed = false;
      this.enterVolleyTelegraph();
    }
  }

  private updateSummons(dt: number): void {
    this.summonTimer = Math.max(0, this.summonTimer - dt);
    if (this.summonTimer > 0) return;
    this.summonTimer = SUMMON_INTERVAL;
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      this.requestMinion(
        'magmaSlime',
        2,
        this.body.pos.x + side * (1.8 + i * 0.4),
        this.body.pos.y + 0.35,
      );
    }
  }

  private updateVolley(ctx: WorldCtx): void {
    // 3 blobs (4 enraged), staggered across the active window, each lobbed
    // at the next player in the rotation so nobody can hide.
    const total = this.isBelowHp(0.5) ? 4 : 3;
    const progress = this.phaseProgress();
    const due = Math.min(total, Math.floor(progress * total) + 1);
    while (this.volleyShotsFired < due) {
      this.volleyShotsFired += 1;
      const target = this.rotationPlayerPos(ctx);
      this.advanceTargetRotation();
      const dir: 1 | -1 = target.x >= this.body.pos.x ? 1 : -1;
      const dist = Math.abs(target.x - this.body.pos.x);
      // Lob speed scales with distance so the arc lands near the target.
      const blob: ProjectileDef = { ...VOLLEY_BLOB, speed: Math.min(15, 7.5 + dist * 0.55) };
      ctx.fireProjectile(
        blob,
        VOLLEY_ATTACK,
        this.body.pos.x + dir * 0.8,
        this.body.pos.y + this.body.height * 0.72,
        dir,
        'enemy',
        this.teamId,
        this.power,
      );
      if (!simPhase.resimulating) {
        ctx.particles.burst(this.body.pos.x + dir * 0.8, this.body.pos.y + this.body.height * 0.72, 0xff8a3c, 10, 5);
      }
    }
  }

  private enterStalk(): void {
    this.phase = 'stalk';
    // Enraged: barely any downtime between attacks.
    const duration = this.isBelowHp(0.5) ? STALK_MAX * 0.65 : STALK_MAX;
    this.phaseDuration = duration;
    this.phaseTimer = duration;
  }

  private enterPunchTelegraph(): void {
    const duration = this.telegraphDuration(PUNCH_TELEGRAPH);
    this.phase = 'punchTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.telegraphFlash(0xffffff, duration);
  }

  private enterPunchActive(ctx: WorldCtx): void {
    this.phase = 'punchActive';
    this.phaseDuration = PUNCH_ACTIVE;
    this.phaseTimer = PUNCH_ACTIVE;
    this.beginBossHit();
    this.shake(0.8);
    if (!simPhase.resimulating) ctx.particles.directional(
      this.body.pos.x + this.facing * 1.6,
      this.body.pos.y + 0.3,
      this.facing,
      0.45,
      0xff8a3c,
      26,
      8,
    );
  }

  private enterVolleyTelegraph(): void {
    const duration = this.telegraphDuration(VOLLEY_TELEGRAPH);
    this.phase = 'volleyTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.telegraphFlash(0xff8a3c, duration);
  }

  private enterVolleyActive(): void {
    this.phase = 'volleyActive';
    this.phaseDuration = VOLLEY_ACTIVE;
    this.phaseTimer = VOLLEY_ACTIVE;
    this.volleyShotsFired = 0;
  }

  private enterEruptTelegraph(): void {
    const duration = this.telegraphDuration(ERUPT_TELEGRAPH);
    this.phase = 'eruptTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.telegraphFlash(0xff3048, duration);
  }

  private enterEruptActive(ctx: WorldCtx): void {
    this.phase = 'eruptActive';
    this.phaseDuration = ERUPT_ACTIVE;
    this.phaseTimer = ERUPT_ACTIVE;
    this.meteorsFired = false;
    this.fireEruption(ctx);
    this.shake(1.4);
  }

  /** Signature move: meteors rain across the whole stage + twin shockwaves. */
  private fireEruption(ctx: WorldCtx): void {
    if (this.meteorsFired) return;
    this.meteorsFired = true;
    const x = this.body.pos.x;
    const y = this.body.pos.y + this.body.height * 0.9;
    const count = this.isBelowHp(0.5) ? 6 : 5;
    for (let i = 0; i < count; i += 1) {
      // Fan of steep lobs: center-out spread so landing spots stripe the stage.
      const t = i / (count - 1) - 0.5;
      const angle = 90 - t * 56; // 62°–118° from horizontal, mirrored by dir
      const dir: 1 | -1 = angle <= 90 ? 1 : -1;
      const meteor: ProjectileDef = {
        ...METEOR,
        angleDeg: dir === 1 ? angle : 180 - angle,
        speed: 15 + Math.abs(t) * 6,
      };
      ctx.fireProjectile(meteor, METEOR_ATTACK, x, y, dir, 'enemy', this.teamId, this.power);
    }
    const waveY = this.body.pos.y + 0.34;
    ctx.fireProjectile(SHOCKWAVE, SHOCKWAVE_ATTACK, x - 0.6, waveY, -1, 'enemy', this.teamId, this.power);
    ctx.fireProjectile(SHOCKWAVE, SHOCKWAVE_ATTACK, x + 0.6, waveY, 1, 'enemy', this.teamId, this.power);
    if (!simPhase.resimulating) {
      ctx.particles.koExplosion(x, y, 0xff6a2e);
      ctx.particles.burst(x, y, 0xffd94a, 30, 9);
    }
  }

  private enterRampageTelegraph(): void {
    const duration = this.telegraphDuration(RAMPAGE_TELEGRAPH);
    this.phase = 'rampageTelegraph';
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.rampageDir = this.facing;
    this.telegraphFlash(0xff3048, duration);
  }

  private enterRampageActive(): void {
    this.phase = 'rampageActive';
    this.phaseDuration = RAMPAGE_ACTIVE;
    this.phaseTimer = RAMPAGE_ACTIVE;
    this.beginBossHit();
    this.shake(0.9);
  }

  /** True once the charge reaches the last 1.5u before the main platform edge. */
  private hitArenaEdge(ctx: WorldCtx): boolean {
    const blast = ctx.stage.blast;
    const margin = 3.4;
    return (
      (this.rampageDir === 1 && this.body.pos.x > blast.right - margin) ||
      (this.rampageDir === -1 && this.body.pos.x < blast.left + margin)
    );
  }

  private enterRecover(): void {
    this.phase = 'recover';
    // Enraged recovery is brutally short — pressure never lets up.
    const duration = this.isBelowHp(0.5) ? RECOVER * 0.7 : RECOVER;
    this.phaseDuration = duration;
    this.phaseTimer = duration;
    this.body.vel.x = 0;
  }

  private phaseProgress(): number {
    return 1 - this.phaseTimer / Math.max(0.0001, this.phaseDuration);
  }

  private telegraphDuration(base: number): number {
    return this.isBelowHp(0.5) ? base * 0.72 : base;
  }

  override digestInto(out: number[]): void {
    super.digestInto(out);
    out.push(
      PHASE_IDS[this.phase],
      this.phaseTimer,
      this.phaseDuration,
      this.summonTimer,
      this.cycleCount,
      this.volleyShotsFired,
      this.meteorsFired ? 1 : 0,
      this.rampageDir,
      this.rampageUsed ? 1 : 0,
    );
  }

  override syncState(io: Parameters<Boss['syncState']>[0], registry: Parameters<Boss['syncState']>[1]): void {
    super.syncState(io, registry);
    this.phase = PHASE_NAMES[io.i32(PHASE_IDS[this.phase])] ?? 'stalk';
    this.phaseTimer = io.f64(this.phaseTimer);
    this.phaseDuration = io.f64(this.phaseDuration);
    this.summonTimer = io.f64(this.summonTimer);
    this.cycleCount = io.i32(this.cycleCount);
    this.volleyShotsFired = io.i32(this.volleyShotsFired);
    this.meteorsFired = io.bool(this.meteorsFired);
    this.rampageDir = io.i32(this.rampageDir) >= 0 ? 1 : -1;
    this.rampageUsed = io.bool(this.rampageUsed);
  }
}
