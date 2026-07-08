import type { StageDef } from '../data/types';

/** Axis-aligned solid rectangle collider. */
export interface SolidRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** One-way platform represented by its horizontal span and top Y. */
export interface OneWayPlat {
  minX: number;
  maxX: number;
  y: number;
}

/** Runtime collision data derived from a stage definition. */
export interface StageColliders {
  solids: SolidRect[];
  oneWays: OneWayPlat[];
}

/** Builds solid and one-way collision primitives from frozen stage data. */
export function buildColliders(stage: StageDef): StageColliders {
  const solids: SolidRect[] = [];
  const oneWays: OneWayPlat[] = [];

  for (const platform of stage.platforms) {
    const halfW = platform.w * 0.5;
    const minX = platform.x - halfW;
    const maxX = platform.x + halfW;

    if (platform.oneWay) {
      oneWays.push({ minX, maxX, y: platform.y });
    } else {
      solids.push({ minX, maxX, minY: platform.y - 1, maxY: platform.y });
    }
  }

  if (stage.walls) {
    for (const wall of stage.walls) {
      solids.push({
        minX: wall.x - 0.4,
        maxX: wall.x + 0.4,
        minY: wall.y,
        maxY: wall.y + wall.h,
      });
    }
  }

  return { solids, oneWays };
}

/** Returns true when two AABBs overlap with positive area. */
export function aabbOverlap(
  aMinX: number,
  aMaxX: number,
  aMinY: number,
  aMaxY: number,
  bMinX: number,
  bMaxX: number,
  bMinY: number,
  bMaxY: number,
): boolean {
  return aMinX < bMaxX && aMaxX > bMinX && aMinY < bMaxY && aMaxY > bMinY;
}
