import * as THREE from 'three';
import type { ActiveHitbox } from '../combat/types';
import type { SimRngSet } from '../core/rng';
import type { AttackDef, BlastZone, Faction, Facing, ProjectileDef, Vec2 } from '../data/types';
import type { StageColliders } from '../physics/collision';
import { Body } from '../physics/Body';
import type { Particles } from '../render/Particles';
import type { Trails } from '../render/Trails';

let nextEntityId = 1;

/** Netplay: match start resets ids so entity identity is reproducible. */
export function resetEntityIds(): void {
  nextEntityId = 1;
}

export interface WorldCtx {
  particles: Particles;
  trails: Trails;
  /** Deterministic per-system RNG streams — sim randomness ONLY (see core/rng.ts). */
  rng: SimRngSet;
  stage: {
    colliders: StageColliders;
    blast: BlastZone;
    respawnPoint: Vec2;
  };
  playerPos: Vec2;
  requestHitbox(h: ActiveHitbox): void;
  fireProjectile(
    def: ProjectileDef,
    attackDef: AttackDef,
    x: number,
    y: number,
    facing: Facing,
    faction: Faction,
    teamId: number,
    power: number,
  ): void;
}

export abstract class Entity {
  readonly id = nextEntityId++;
  readonly body: Body;
  readonly group: THREE.Group;
  alive = true;

  protected constructor(body: Body, group: THREE.Group) {
    this.body = body;
    this.group = group;
  }

  abstract update(ctx: WorldCtx, dt: number): void;
}
