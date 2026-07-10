import {
  DI_MAX_DEG,
  HITSTUN_MAX,
  HITSTUN_MIN,
  HITSTUN_PER_KB,
  SAKURAI_KB_CUTOFF,
  SAKURAI_STRONG_DEG,
  SAKURAI_WEAK_DEG,
} from '../config';
import { clamp, degToRad } from '../core/math';
import { cos, sin } from '../core/simmath';
import type { AttackDef, Facing, Vec2 } from '../data/types';

export function computeKnockback(
  atk: AttackDef,
  victimDamageAfterHit: number,
  attackerPower: number,
  victimWeight: number,
): number {
  return (atk.baseKb + atk.kbGrowth * victimDamageAfterHit) * attackerPower * (100 / victimWeight);
}

export function hitstunFor(kb: number): number {
  return clamp(kb * HITSTUN_PER_KB, HITSTUN_MIN, HITSTUN_MAX);
}

export function resolveAngleDeg(atk: AttackDef, kb: number): number {
  if (atk.angleDeg === 361) {
    return kb > SAKURAI_KB_CUTOFF ? SAKURAI_STRONG_DEG : SAKURAI_WEAK_DEG;
  }
  return atk.angleDeg;
}

export function launchVelocity(
  out: Vec2,
  kb: number,
  angleDeg: number,
  facing: Facing,
  diY: number,
): void {
  const baseRad = degToRad(angleDeg);
  const mirroredRad = facing === 1 ? baseRad : Math.PI - baseRad;
  const diRad = degToRad(DI_MAX_DEG * clamp(diY, -1, 1));
  const launchRad = mirroredRad + diRad;
  out.x = cos(launchRad) * kb;
  out.y = sin(launchRad) * kb;
}
