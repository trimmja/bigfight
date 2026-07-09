import * as THREE from 'three';
import { MobBrain } from '../ai/MobBrain';
import type { HitResult } from '../combat/types';
import type { CharacterDef, EnemyDef, Vec2 } from '../data/types';
import { buildEnemyRig } from '../rigs/enemyBuilders';
import type { WorldCtx } from './Entity';
import { Fighter } from './Fighter';

type MutableRigCarrier = { rig: unknown; group: THREE.Group };

export class Mob extends Fighter {
  readonly enemyDef: EnemyDef;
  readonly brain: MobBrain;

  constructor(def: EnemyDef) {
    super(toCharacterDef(def), 'enemy');
    this.enemyDef = def;

    const mobRig = buildEnemyRig(def);
    this.rig.dispose();
    (this as unknown as MutableRigCarrier).rig = mobRig;
    (this as unknown as MutableRigCarrier).group = mobRig.root;

    this.brain = new MobBrain(this);
    this.applyMobBodyFlags();
  }

  get brainState(): string {
    return this.brain.state;
  }

  get isBlocking(): boolean {
    return this.brain.isBlocking;
  }

  setTarget(target: Fighter): void {
    this.brain.setTarget(target);
  }

  override update(ctx: WorldCtx, dt: number): void {
    this.brain.update(ctx, dt);
    super.update(ctx, dt);
    this.brain.afterFighterUpdate(dt);
  }

  override koReset(pos: Vec2): void {
    super.koReset(pos);
    this.damage = 0;
    this.damageScale = 1;
    this.kbImmune = false;
    this.brain.reset();
    this.applyMobBodyFlags();
  }

  override onHit(result: HitResult): void {
    this.brain.releaseAttackToken();
    this.damageScale = 1;
    this.kbImmune = false;
    super.onHit(result);
  }

  override beginKo(): void {
    this.brain.releaseAttackToken();
    this.damageScale = 1;
    this.kbImmune = false;
    super.beginKo();
  }

  private applyMobBodyFlags(): void {
    const canFly = this.enemyDef.brain.canFly === true;
    this.body.gravityScale = canFly ? 0 : this.enemyDef.gravityScale;
    this.body.noclip = this.enemyDef.builder === 'ghost';
  }
}

function toCharacterDef(def: EnemyDef): CharacterDef {
  return {
    id: def.id,
    name: def.name,
    tagline: 'Enemy',
    archetype: 'monster',
    speed: def.brain.moveSpeed,
    power: 1,
    weight: def.weight,
    jumpVel: 12,
    jumps: 1,
    combo: [def.attack, def.attack, def.attack],
    palette: def.palette,
    proportions: def.proportions,
    unlock: { type: 'starter' },
  };
}
