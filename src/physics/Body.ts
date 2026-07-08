import type { Vec2 } from '../data/types';

/** Mutable AABB physics body whose origin is the fighter's feet center. */
export class Body {
  /** Feet-center world position. */
  pos: Vec2 = { x: 0, y: 0 };
  /** Velocity in world units per second. */
  vel: Vec2 = { x: 0, y: 0 };
  /** Half-width of the body's AABB. */
  halfW: number;
  /** Full height of the body's AABB. */
  height: number;
  /** True only when this body landed or rested on a top face this step. */
  grounded = false;
  /** Multiplier applied to gravity. */
  gravityScale = 1;
  /** Applies the fast-fall gravity multiplier while descending. */
  fastFalling = false;
  /** Seconds remaining before one-way platforms can catch this body again. */
  dropThroughTimer = 0;
  /** When true, the body drifts through all colliders without gravity. */
  noclip = false;

  /** Creates an AABB body with a feet-center origin. */
  constructor(halfW: number, height: number) {
    this.halfW = halfW;
    this.height = height;
  }

  /** Left side of the AABB. */
  get minX(): number {
    return this.pos.x - this.halfW;
  }

  /** Right side of the AABB. */
  get maxX(): number {
    return this.pos.x + this.halfW;
  }

  /** Bottom side of the AABB, equal to the feet-center Y. */
  get minY(): number {
    return this.pos.y;
  }

  /** Top side of the AABB. */
  get maxY(): number {
    return this.pos.y + this.height;
  }
}
