/**
 * BIG FIGHT — sidekick companions (design: Ryder).
 *
 * Tiny buddies that float near the player and auto-fire every
 * `fireInterval` seconds.
 */

import type { SidekickDef } from './types';

export const SIDEKICKS: readonly SidekickDef[] = [
  {
    id: 'zapDrone',
    name: 'Zap-Drone',
    tagline: 'Your little buddy with a big zap!',
    goldCost: 400,
    fireInterval: 2.5,
    projectile: {
      id: 'zapDroneBolt',
      speed: 20,
      angleDeg: 0,
      gravityScale: 0,
      lifetime: 1.2,
      radius: 0.15,
      visual: 'bolt',
      color: 0x00eaff,
    },
    attack: { damage: 4, baseKb: 3, kbGrowth: 0.03, angleDeg: 20 },
    palette: { core: 0x0a0a12, glow: 0x00eaff, accent: 0x2f6bff },
    builder: 'drone',
  },
  {
    id: 'miniDragon',
    name: 'Mini Dragon',
    tagline: 'Small dragon. Serious fireballs.',
    goldCost: 800,
    fireInterval: 3,
    projectile: {
      id: 'miniDragonFireball',
      speed: 14,
      angleDeg: 0,
      gravityScale: 0,
      lifetime: 1.8,
      radius: 0.3,
      visual: 'orb',
      color: 0xff5a2e,
    },
    attack: { damage: 7, baseKb: 5, kbGrowth: 0.06, angleDeg: 40 },
    palette: { core: 0x140806, glow: 0xff5a2e, accent: 0xffb347 },
    builder: 'dragon',
  },
  {
    id: 'ghostBuddy',
    name: 'Ghost Buddy',
    tagline: 'A spooky friend whose wisps never miss.',
    goldCost: 1400,
    fireInterval: 3.5,
    projectile: {
      id: 'ghostBuddyWisp',
      speed: 8,
      angleDeg: 0,
      gravityScale: 0,
      lifetime: 3,
      radius: 0.3,
      visual: 'orb',
      color: 0xa86bff,
      homing: 90,
    },
    attack: { damage: 9, baseKb: 6, kbGrowth: 0.08, angleDeg: 45 },
    palette: { core: 0x0b0a14, glow: 0xa86bff, accent: 0xc9b6ff },
    builder: 'ghostBuddy',
  },
];

/** Look up a sidekick by id; throws on unknown id. */
export function sidekickById(id: string): SidekickDef {
  const def = SIDEKICKS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown sidekick id: ${id}`);
  return def;
}
