import {
  HITSTOP_BASE,
  HITSTOP_MAX,
  HITSTOP_PER_DAMAGE,
  LAUNCH_THRESHOLD,
} from '../config';
import { events } from '../core/events';
import { clamp, degToRad } from '../core/math';
import { atan2 } from '../core/simmath';
import { aabbOverlap } from '../physics/collision';
import { computeKnockback, hitstunFor, launchVelocity, resolveAngleDeg } from './knockback';
import type { ActiveHitbox, FighterLike, Rect } from './types';

const hitboxes: ActiveHitbox[] = [];
type ScaledVictim = FighterLike & { damageScale?: number; kbImmune?: boolean };
type PoweredAttacker = FighterLike & { attackMult?: number };
type ShieldedVictim = FighterLike & {
  shieldHits?: number;
  onShieldBlocked?: () => void;
  applyFreeze?: (seconds: number) => void;
};
type ResolvedHitbox = ActiveHitbox & {
  onResolvedHit?: () => void;
  stopAfterHit?: boolean;
};

export class HitResolver {
  /**
   * Player-vs-player hit notifications (KO attribution in versus modes).
   * Fires only when both parties carry a match slot; wired by GameplayScreen.
   */
  onPlayerHitPlayer: ((victimSlot: number, attackerSlot: number) => void) | null = null;

  beginStep(): void {
    hitboxes.length = 0;
  }

  submit(hitbox: ActiveHitbox): void {
    hitboxes.push(hitbox);
  }

  resolve(targets: readonly FighterLike[]): void {
    for (let hitboxIndex = 0; hitboxIndex < hitboxes.length; hitboxIndex += 1) {
      const hitbox = hitboxes[hitboxIndex];
      if (hitbox === undefined) continue;
      const attackRect = hitbox.worldRect();

      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const victim = targets[targetIndex];
        if (victim === undefined) continue;
        if (victim.teamId === hitbox.teamId) continue;
        if (victim.isInvulnerable) continue;
        if (!victim.hurtbox.enabled) continue;
        if (hitbox.alreadyHit.has(victim)) continue;

        const victimRect = victim.hurtbox.rect();
        if (!overlaps(attackRect, victimRect)) continue;

        hitbox.alreadyHit.add(victim);
        const x = overlapCenter(attackRect.minX, attackRect.maxX, victimRect.minX, victimRect.maxX);
        const y = overlapCenter(attackRect.minY, attackRect.maxY, victimRect.minY, victimRect.maxY);
        const shieldedVictim = victim as ShieldedVictim;
        if ((shieldedVictim.shieldHits ?? 0) > 0) {
          shieldedVictim.shieldHits = Math.max(0, (shieldedVictim.shieldHits ?? 0) - 1);
          shieldedVictim.onShieldBlocked?.();
          events.emit('hit', {
            pos: { x, y },
            damage: 0,
            kb: 0,
            victimIsPlayer: victim.faction === 'player',
          });
          events.emit('screenShake', { amount: 0.08 });
          if (notifyResolvedHit(hitbox)) break;
          continue;
        }

        const scaledVictim = victim as ScaledVictim;
        const damageScale = scaledVictim.damageScale ?? 1;
        const kbImmune = scaledVictim.kbImmune === true;
        const attacker = hitbox.attacker as PoweredAttacker;
        const attackMult = attacker.attackMult ?? 1;
        const damage = hitbox.def.damage * damageScale * attackMult;
        victim.damage += damage;

        const kb = computeKnockback(
          hitbox.def,
          victim.damage,
          hitbox.attacker.power * attackMult,
          victim.weight,
        );
        const angleDeg = resolveAngleDeg(hitbox.def, kb);
        if (!kbImmune) {
          launchVelocity(victim.body.vel, kb, angleDeg, hitbox.attacker.facing, victim.diY);
        }

        const effectiveKb = kbImmune ? 0 : kb;
        const hitstun = hitstunFor(effectiveKb);
        const launched = effectiveKb > LAUNCH_THRESHOLD;
        const hitstop = clamp(
          HITSTOP_BASE + damage * HITSTOP_PER_DAMAGE,
          0,
          HITSTOP_MAX,
        );
        hitbox.attacker.hitstopTimer = Math.max(hitbox.attacker.hitstopTimer, hitstop);
        victim.hitstopTimer = Math.max(victim.hitstopTimer, hitstop);

        events.emit('hit', {
          pos: { x, y },
          damage,
          kb: effectiveKb,
          victimIsPlayer: victim.faction === 'player',
        });
        if (effectiveKb > 10) {
          events.emit('screenShake', { amount: effectiveKb * 0.02 });
        }

        const result = {
          damage,
          kb: effectiveKb,
          angleRad: atan2(victim.body.vel.y, victim.body.vel.x) || degToRad(angleDeg),
          hitstun,
          launched,
        };
        victim.onHit(result);
        if (hitbox.def.freezeTime && hitbox.def.freezeTime > 0) {
          shieldedVictim.applyFreeze?.(hitbox.def.freezeTime);
        }
        hitbox.attacker.onDealtHit(result);
        if (this.onPlayerHitPlayer) {
          const attackerSlot = (hitbox.attacker as { slotIndex?: number }).slotIndex ?? -1;
          const victimSlot = (victim as { slotIndex?: number }).slotIndex ?? -1;
          if (attackerSlot >= 0 && victimSlot >= 0 && attackerSlot !== victimSlot) {
            this.onPlayerHitPlayer(victimSlot, attackerSlot);
          }
        }
        if (notifyResolvedHit(hitbox)) break;
      }
    }
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return aabbOverlap(a.minX, a.maxX, a.minY, a.maxY, b.minX, b.maxX, b.minY, b.maxY);
}

function overlapCenter(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return (Math.max(aMin, bMin) + Math.min(aMax, bMax)) * 0.5;
}

function notifyResolvedHit(hitbox: ActiveHitbox): boolean {
  const resolved = hitbox as ResolvedHitbox;
  resolved.onResolvedHit?.();
  return resolved.stopAfterHit === true;
}
