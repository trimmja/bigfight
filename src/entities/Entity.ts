import * as THREE from 'three';
import type { ActiveHitbox } from '../combat/types';
import type { BlastZone, Vec2 } from '../data/types';
import type { StageColliders } from '../physics/collision';
import { Body } from '../physics/Body';
import type { Particles } from '../render/Particles';
import type { Trails } from '../render/Trails';

let nextEntityId = 1;

export interface WorldCtx {
  particles: Particles;
  trails: Trails;
  stage: {
    colliders: StageColliders;
    blast: BlastZone;
    respawnPoint: Vec2;
  };
  playerPos: Vec2;
  requestHitbox(h: ActiveHitbox): void;
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
