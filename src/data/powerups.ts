/**
 * BIG FIGHT — powerup drops (design: Ryder).
 *
 * Powerups start dropping once their unlock level is beaten.
 * duration 0 = instant effect (heal).
 */

import type { PowerupDef } from './types';

export const POWERUPS: readonly PowerupDef[] = [
  {
    id: 'healOrb',
    name: 'Heal Orb',
    unlockAfterLevel: 2,
    duration: 0,
    color: 0x58ff7d,
    blurb: 'Heals 40% right away. Yum!',
  },
  {
    id: 'shieldBubble',
    name: 'Shield Bubble',
    unlockAfterLevel: 5,
    duration: 8,
    color: 0x00eaff,
    blurb: 'Blocks the next 3 hits. Bonk-proof!',
  },
  {
    id: 'rageMode',
    name: 'Rage Mode',
    unlockAfterLevel: 7,
    duration: 6,
    color: 0xff2d95,
    blurb: 'Double damage and knockback!',
  },
  {
    id: 'giantHammer',
    name: 'Giant Hammer',
    unlockAfterLevel: 10,
    duration: 8,
    color: 0xffe94a,
    blurb: 'SMASH everything!',
  },
  {
    id: 'freezeRay',
    name: 'Freeze Ray',
    unlockAfterLevel: 10,
    duration: 8,
    color: 0x9df3ff,
    blurb: 'Freeze your enemies solid!',
  },
];

/** Look up a powerup by id; throws on unknown id. */
export function powerupById(id: string): PowerupDef {
  const def = POWERUPS.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown powerup id: ${id}`);
  return def;
}
