import { ATTACK_TOKENS } from '../config';
import type { WorldCtx } from '../entities/Entity';
import type { Fighter } from '../entities/Fighter';
import type { Mob } from '../entities/Mob';

export type MobBrainState = 'idle' | 'approach' | 'windup' | 'attack' | 'recover';

let activeAttackTokens = 0;

export function resetMobAttackTokens(): void {
  activeAttackTokens = 0;
}

const RETREAT_MIN = 0.45;
const RETREAT_MAX = 0.75;
const CAPTAIN_BLOCK_RANGE = 2.5;
const CAPTAIN_BLOCK_TIME = 0.8;
const HOP_COOLDOWN = 0.72;
const HOP_VEL_Y = 8.8;
const FLY_ACCEL = 18;
const FLY_ATTACK_SPEED_MULT = 1.35;
const STEEL_BLUE = 0xaebdd2;

export class MobBrain {
  state: MobBrainState = 'idle';
  isBlocking = false;

  private target: Fighter | null = null;
  private stateTimer = 0;
  private attackCooldown = 0;
  private hasAttackToken = false;
  private retreatDir: 1 | -1 = 1;
  private retreatTime = 0;
  private blockTimer = 0;
  private blockCheckCooldown = 0;
  private hopCooldown = Math.random() * HOP_COOLDOWN;
  private attackPulseSent = false;
  private attackStarted = false;

  constructor(private readonly mob: Mob) {}

  setTarget(target: Fighter): void {
    this.target = target;
  }

  reset(): void {
    this.releaseAttackToken();
    this.state = 'idle';
    this.stateTimer = 0;
    this.attackCooldown = 0;
    this.retreatTime = 0;
    this.blockTimer = 0;
    this.blockCheckCooldown = 0;
    this.hopCooldown = Math.random() * HOP_COOLDOWN;
    this.attackPulseSent = false;
    this.attackStarted = false;
    this.setBlocking(false);
  }

  update(ctx: WorldCtx, dt: number): void {
    const mob = this.mob;
    const def = mob.enemyDef;
    const target = this.target;
    const targetPos = target?.body.pos ?? ctx.playerPos;
    const targetAlive = target?.alive ?? true;
    const dx = targetPos.x - mob.body.pos.x;
    const dy = targetPos.y - mob.body.pos.y;
    const distSq = dx * dx + dy * dy;
    const attackRange = def.brain.attackRange;

    mob.intents.moveX = 0;
    mob.intents.moveY = 0;
    mob.intents.jumpPressed = false;
    mob.intents.attackPressed = false;

    if (!targetAlive || mob.state === 'hitstun' || mob.state === 'launched' || mob.state === 'ko') {
      this.releaseAttackToken();
      this.state = 'idle';
      this.setBlocking(false);
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.hopCooldown > 0) this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.updateBlocking(dt, dx, distSq);
    this.stateTimer += dt;

    if (Math.abs(dx) > 0.08) mob.facing = dx >= 0 ? 1 : -1;

    switch (this.state) {
      case 'idle':
        this.updateIdle(def.brain.aggroRange, distSq);
        break;
      case 'approach':
        this.updateApproach(dt, dx, dy, attackRange, distSq);
        break;
      case 'windup':
        this.updateWindup();
        break;
      case 'attack':
        this.updateAttack();
        break;
      case 'recover':
        this.updateRecover(dx, dt);
        break;
    }
  }

  afterFighterUpdate(dt: number): void {
    const def = this.mob.enemyDef;
    if (!def.brain.canFly) return;

    const target = this.target;
    const targetPos = target?.body.pos;
    if (!targetPos) return;

    if (this.state === 'attack' && def.builder === 'miniEagle') {
      this.steerFlyingToward(targetPos.x, targetPos.y + 0.45, def.brain.moveSpeed * FLY_ATTACK_SPEED_MULT, dt);
      return;
    }

    if (this.state === 'attack' && def.builder === 'ghost') {
      this.steerFlyingToward(targetPos.x, targetPos.y + 0.65, def.brain.moveSpeed * 1.15, dt);
      return;
    }

    if (this.state === 'windup') {
      this.mob.body.vel.x = dampNumber(this.mob.body.vel.x, 0, 12, dt);
      this.mob.body.vel.y = dampNumber(this.mob.body.vel.y, 0, 12, dt);
      return;
    }

    const side = this.mob.body.pos.x < targetPos.x ? -1 : 1;
    const hoverX = targetPos.x + side * (def.builder === 'ghost' ? 1.25 : 2.2);
    const hoverY = targetPos.y + (def.builder === 'ghost' ? 2.15 : 2.9);
    this.steerFlyingToward(hoverX, hoverY, def.brain.moveSpeed, dt);
  }

  releaseAttackToken(): void {
    if (!this.hasAttackToken) return;
    this.hasAttackToken = false;
    activeAttackTokens = Math.max(0, activeAttackTokens - 1);
  }

  private updateIdle(aggroRange: number, distSq: number): void {
    if (distSq <= aggroRange * aggroRange) this.enterState('approach');
  }

  private updateApproach(dt: number, dx: number, dy: number, attackRange: number, distSq: number): void {
    const def = this.mob.enemyDef;
    const inRange = distSq <= attackRange * attackRange;

    if (def.brain.hops) {
      this.updateHopMove(dx);
      if (inRange && !this.mob.body.grounded && Math.abs(this.mob.body.vel.y) < 2 && this.attackCooldown <= 0) {
        this.tryEnterWindup();
      }
      return;
    }

    if (def.brain.canFly) {
      this.mob.intents.moveX = 0;
      if (inRange && this.attackCooldown <= 0) this.tryEnterWindup();
      return;
    }

    if (inRange && Math.abs(dy) < 2.2 && this.attackCooldown <= 0) {
      this.tryEnterWindup();
      return;
    }

    this.mob.intents.moveX = Math.abs(dx) > 0.15 ? Math.sign(dx) : 0;
    if (dy > 2.1 && this.mob.body.grounded) this.mob.intents.jumpPressed = true;
    if (dt > 0) this.mob.intents.moveY = 0;
  }

  private updateWindup(): void {
    this.mob.intents.moveX = 0;
    if (this.stateTimer < this.mob.enemyDef.brain.telegraphTime) return;
    this.enterState('attack');
    this.mob.intents.attackPressed = true;
  }

  private updateAttack(): void {
    if (!this.attackPulseSent) {
      this.mob.intents.attackPressed = true;
      this.attackPulseSent = true;
      return;
    }
    if (this.mob.state === 'attack') {
      this.attackStarted = true;
      return;
    }
    if (this.attackStarted || this.stateTimer > 0.18) this.enterRecover();
  }

  private updateRecover(dx: number, dt: number): void {
    if (this.retreatTime > 0) {
      this.retreatTime = Math.max(0, this.retreatTime - dt);
      this.mob.intents.moveX = this.retreatDir;
    }
    if (this.stateTimer < this.mob.enemyDef.brain.attackCooldown) return;
    this.releaseAttackToken();
    this.attackCooldown = 0;
    this.enterState('approach');
    if (Math.abs(dx) > 0.1) this.mob.facing = dx >= 0 ? 1 : -1;
  }

  private updateHopMove(dx: number): void {
    const dir = Math.abs(dx) > 0.1 ? Math.sign(dx) : 0;
    this.mob.intents.moveX = dir;
    if (!this.mob.body.grounded || this.hopCooldown > 0) return;
    this.mob.body.vel.x = dir * this.mob.enemyDef.brain.moveSpeed;
    this.mob.body.vel.y = HOP_VEL_Y;
    this.mob.body.grounded = false;
    this.hopCooldown = HOP_COOLDOWN;
  }

  private updateBlocking(dt: number, dx: number, distSq: number): void {
    const target = this.target;
    const canBlock = this.mob.enemyDef.brain.canBlock === true;
    if (!canBlock || this.state !== 'approach') {
      this.setBlocking(false);
      return;
    }

    if (this.blockTimer > 0) {
      this.blockTimer = Math.max(0, this.blockTimer - dt);
      this.setBlocking(this.blockTimer > 0);
      return;
    }

    if (this.blockCheckCooldown > 0) {
      this.blockCheckCooldown = Math.max(0, this.blockCheckCooldown - dt);
      this.setBlocking(false);
      return;
    }

    this.blockCheckCooldown = 0.18;
    if (
      target?.state === 'attack'
      && distSq <= CAPTAIN_BLOCK_RANGE * CAPTAIN_BLOCK_RANGE
      && Math.sign(dx || this.mob.facing) === this.mob.facing
      && Math.random() < 0.3
    ) {
      this.blockTimer = CAPTAIN_BLOCK_TIME;
      this.mob.rig.flashColor(STEEL_BLUE, CAPTAIN_BLOCK_TIME);
      this.setBlocking(true);
    } else {
      this.setBlocking(false);
    }
  }

  private tryEnterWindup(): void {
    if (!this.acquireAttackToken()) return;
    this.enterState('windup');
    this.mob.rig.flashColor(0xff5a5a, this.mob.enemyDef.brain.telegraphTime);
    this.mob.body.vel.x *= 0.25;
  }

  private acquireAttackToken(): boolean {
    if (this.hasAttackToken) return true;
    if (activeAttackTokens >= ATTACK_TOKENS) return false;
    activeAttackTokens += 1;
    this.hasAttackToken = true;
    return true;
  }

  private enterRecover(): void {
    this.enterState('recover');
    this.attackCooldown = this.mob.enemyDef.brain.attackCooldown;
    if (Math.random() < this.mob.enemyDef.brain.retreatChance) {
      const targetX = this.target?.body.pos.x ?? this.mob.body.pos.x;
      this.retreatDir = this.mob.body.pos.x < targetX ? -1 : 1;
      this.retreatTime = RETREAT_MIN + Math.random() * (RETREAT_MAX - RETREAT_MIN);
    } else {
      this.retreatTime = 0;
    }
  }

  private enterState(state: MobBrainState): void {
    this.state = state;
    this.stateTimer = 0;
    this.attackPulseSent = false;
    this.attackStarted = false;
    if (state !== 'approach') this.setBlocking(false);
  }

  private setBlocking(blocking: boolean): void {
    this.isBlocking = blocking;
    this.mob.damageScale = blocking ? 0.3 : 1;
    this.mob.kbImmune = blocking;
  }

  private steerFlyingToward(targetX: number, targetY: number, speed: number, dt: number): void {
    const body = this.mob.body;
    let dx = targetX - body.pos.x;
    let dy = targetY - (body.pos.y + body.height * 0.5);
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      dx /= len;
      dy /= len;
    } else {
      dx = 0;
      dy = 0;
    }
    const targetVelX = dx * speed;
    const targetVelY = dy * speed;
    body.vel.x = moveToward(body.vel.x, targetVelX, FLY_ACCEL * dt);
    body.vel.y = moveToward(body.vel.y, targetVelY, FLY_ACCEL * dt);
  }
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}

function dampNumber(current: number, target: number, lambda: number, dt: number): number {
  return lerpNumber(current, target, 1 - Math.exp(-lambda * dt));
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
