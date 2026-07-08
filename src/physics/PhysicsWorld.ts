import { FASTFALL_MULT, GRAVITY, MAX_FALL } from '../config';
import type { Body } from './Body';
import type { StageColliders } from './collision';
import { aabbOverlap } from './collision';

let scratchPreMinY = 0;
let scratchPreMaxY = 0;
let scratchMoveX = 0;
let scratchMoveY = 0;

/** Fixed-step AABB physics integrator for stage solids and one-way platforms. */
export class PhysicsWorld {
  /** Advances all bodies by one fixed step and resolves stage collision. */
  step(bodies: Body[], colliders: StageColliders, dt: number): void {
    for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
      const body = bodies[bodyIndex];
      if (body === undefined) continue;

      body.grounded = false;

      if (body.noclip) {
        body.pos.x += body.vel.x * dt;
        body.pos.y += body.vel.y * dt;
        continue;
      }

      scratchPreMinY = body.minY;
      scratchPreMaxY = body.maxY;

      body.vel.y += GRAVITY
        * body.gravityScale
        * (body.fastFalling && body.vel.y < 0 ? FASTFALL_MULT : 1)
        * dt;
      if (body.vel.y < MAX_FALL) body.vel.y = MAX_FALL;

      scratchMoveX = body.vel.x;
      scratchMoveY = body.vel.y;

      body.pos.x += body.vel.x * dt;
      for (let solidIndex = 0; solidIndex < colliders.solids.length; solidIndex += 1) {
        const solid = colliders.solids[solidIndex];
        if (solid === undefined) continue;
        if (!aabbOverlap(
          body.minX,
          body.maxX,
          body.minY,
          body.maxY,
          solid.minX,
          solid.maxX,
          solid.minY,
          solid.maxY,
        )) {
          continue;
        }

        if (scratchMoveX > 0) {
          body.pos.x = solid.minX - body.halfW;
          body.vel.x = 0;
        } else if (scratchMoveX < 0) {
          body.pos.x = solid.maxX + body.halfW;
          body.vel.x = 0;
        }
      }

      body.pos.y += body.vel.y * dt;
      for (let solidIndex = 0; solidIndex < colliders.solids.length; solidIndex += 1) {
        const solid = colliders.solids[solidIndex];
        if (solid === undefined) continue;
        if (!aabbOverlap(
          body.minX,
          body.maxX,
          body.minY,
          body.maxY,
          solid.minX,
          solid.maxX,
          solid.minY,
          solid.maxY,
        )) {
          continue;
        }

        if (scratchMoveY <= 0 && scratchPreMinY >= solid.maxY) {
          body.pos.y = solid.maxY;
          body.vel.y = 0;
          body.grounded = true;
        } else if (scratchMoveY > 0 && scratchPreMaxY <= solid.minY) {
          body.pos.y = solid.minY - body.height;
          body.vel.y = 0;
        }
      }

      if (scratchMoveY <= 0 && body.dropThroughTimer <= 0) {
        for (let platIndex = 0; platIndex < colliders.oneWays.length; platIndex += 1) {
          const platform = colliders.oneWays[platIndex];
          if (platform === undefined) continue;
          if (
            body.maxX > platform.minX
            && body.minX < platform.maxX
            && scratchPreMinY >= platform.y
            && body.minY <= platform.y
            && body.maxY >= platform.y
          ) {
            body.pos.y = platform.y;
            body.vel.y = 0;
            body.grounded = true;
          }
        }
      }

      if (body.dropThroughTimer > 0) {
        body.dropThroughTimer -= dt;
        if (body.dropThroughTimer < 0) body.dropThroughTimer = 0;
      }
    }
  }
}
