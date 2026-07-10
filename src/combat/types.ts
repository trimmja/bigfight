import type { AttackDef, Faction, Facing, Vec2 } from '../data/types';

export interface CombatBody {
  pos: Vec2;
  vel: Vec2;
  halfW: number;
  height: number;
}

export interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Hurtbox {
  owner: unknown;
  faction: Faction;
  enabled: boolean;
  /** Returns the current world AABB; implementations derive it from live Body state. */
  rect(): Rect;
}

export interface HitResult {
  damage: number;
  kb: number;
  angleRad: number;
  hitstun: number;
  launched: boolean;
}

export interface FighterLike {
  readonly body: CombatBody;
  readonly hurtbox: Hurtbox;
  readonly faction: Faction;
  /**
   * THE combat gate (faction stays for cosmetics/SFX). Same team never hits.
   * solo/co-op: mobs 0, humans 1 (⇔ legacy faction gate); FFA: unique 1-4;
   * 2v2: shared team id.
   */
  teamId: number;
  readonly facing: Facing;
  readonly power: number;
  readonly weight: number;
  readonly isInvulnerable: boolean;
  readonly diY: number;
  damage: number;
  hitstopTimer: number;
  onHit(result: HitResult): void;
  onDealtHit(result: HitResult): void;
}

export interface ActiveHitbox {
  attacker: FighterLike;
  def: AttackDef;
  faction: Faction;
  /** Mirrors attacker.teamId — the resolve gate compares victim vs this. */
  teamId: number;
  alreadyHit: Set<object>;
  worldRect(): Rect;
}
