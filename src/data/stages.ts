/**
 * BIG FIGHT — stage layouts (design: Ryder).
 *
 * Fighter is ~1.8u tall. Main platform top sits at y=0; small one-way
 * platforms float at y 3–6.5. Blast zones: ±(halfWidth + 12) horizontal,
 * +18 top, -10 bottom. Enclosed stages add side walls (ring out above them).
 */

import type { StageDef } from './types';

export const STAGES: readonly StageDef[] = [
  {
    id: 'rooftop',
    name: 'Neon Rooftop',
    theme: 'rooftop',
    enclosed: false,
    platforms: [
      { x: 0, y: 0, w: 24, oneWay: false },
      { x: -8, y: 3.5, w: 6, oneWay: true },
      { x: 8, y: 3.5, w: 6, oneWay: true },
    ],
    blast: { left: -24, right: 24, top: 18, bottom: -10 },
    playerSpawn: { x: -6, y: 0.5 },
    enemySpawns: [
      { x: 6, y: 0.5 },
      { x: -8, y: 4 },
      { x: 8, y: 4 },
      { x: 10, y: 0.5 },
    ],
    respawnPoint: { x: 0, y: 8 },
    unlockedAtStart: true,
    skyColor: 0x0a0618,
    glowColor: 0x00eaff,
  },
  {
    id: 'cavern',
    name: 'Slime Cavern',
    theme: 'cavern',
    enclosed: true,
    platforms: [
      { x: 0, y: 0, w: 22, oneWay: false },
      { x: 0, y: 3.8, w: 6, oneWay: true },
    ],
    walls: [
      { x: -11, y: 0, h: 8 },
      { x: 11, y: 0, h: 8 },
    ],
    blast: { left: -23, right: 23, top: 18, bottom: -10 },
    playerSpawn: { x: -6, y: 0.5 },
    enemySpawns: [
      { x: 6, y: 0.5 },
      { x: -8, y: 0.5 },
      { x: 0, y: 4.3 },
      { x: 9, y: 0.5 },
    ],
    respawnPoint: { x: 0, y: 8 },
    unlockedAtStart: true,
    skyColor: 0x04120a,
    glowColor: 0x58ff7d,
  },
  {
    id: 'graveyard',
    name: 'Bone Graveyard',
    theme: 'graveyard',
    enclosed: false,
    platforms: [
      { x: 0, y: 0, w: 26, oneWay: false },
      { x: -8, y: 3.2, w: 5.5, oneWay: true },
      { x: 0, y: 5.2, w: 6, oneWay: true },
      { x: 8, y: 3.2, w: 5.5, oneWay: true },
    ],
    blast: { left: -25, right: 25, top: 18, bottom: -10 },
    playerSpawn: { x: -6, y: 0.5 },
    enemySpawns: [
      { x: 7, y: 0.5 },
      { x: -8, y: 3.7 },
      { x: 8, y: 3.7 },
      { x: 0, y: 5.7 },
      { x: -3, y: 0.5 },
    ],
    respawnPoint: { x: 0, y: 8 },
    unlockedAtStart: true,
    skyColor: 0x0a0a14,
    glowColor: 0xa86bff,
  },
  {
    id: 'ghostship',
    name: 'Ghost Ship',
    theme: 'ghostship',
    enclosed: true,
    platforms: [
      { x: 0, y: 0, w: 24, oneWay: false },
      { x: -6, y: 3.5, w: 6, oneWay: true },
      { x: 5, y: 5.5, w: 5.5, oneWay: true },
    ],
    walls: [
      { x: -12, y: 0, h: 7 },
      { x: 12, y: 0, h: 7 },
    ],
    blast: { left: -24, right: 24, top: 18, bottom: -10 },
    playerSpawn: { x: -6, y: 0.5 },
    enemySpawns: [
      { x: 7, y: 0.5 },
      { x: -6, y: 4 },
      { x: 5, y: 6 },
      { x: -9, y: 0.5 },
    ],
    respawnPoint: { x: 0, y: 8 },
    unlockedAtStart: false,
    skyColor: 0x061018,
    glowColor: 0x7df9ff,
  },
  {
    id: 'peak',
    name: 'Eagle Peak',
    theme: 'peak',
    enclosed: false,
    platforms: [
      { x: 0, y: 0, w: 20, oneWay: false },
      { x: -3.5, y: 3.5, w: 6, oneWay: true },
      { x: 3.5, y: 6.5, w: 5.5, oneWay: true },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -10 },
    playerSpawn: { x: -6, y: 0.5 },
    enemySpawns: [
      { x: 6, y: 0.5 },
      { x: -3.5, y: 4 },
      { x: 3.5, y: 7 },
      { x: -8, y: 0.5 },
    ],
    respawnPoint: { x: 0, y: 8 },
    unlockedAtStart: false,
    skyColor: 0x0c0a1e,
    glowColor: 0xffe94a,
  },
  {
    id: 'finale',
    name: 'Final Arena',
    theme: 'finale',
    enclosed: false,
    platforms: [
      { x: 0, y: 0, w: 28, oneWay: false },
      { x: -7, y: 4, w: 6.5, oneWay: true },
      { x: 7, y: 4, w: 6.5, oneWay: true },
    ],
    blast: { left: -26, right: 26, top: 18, bottom: -10 },
    playerSpawn: { x: -6, y: 0.5 },
    enemySpawns: [
      { x: 8, y: 0.5 },
      { x: -8, y: 0.5 },
      { x: -7, y: 4.5 },
      { x: 7, y: 4.5 },
      { x: 2, y: 0.5 },
    ],
    respawnPoint: { x: 0, y: 8 },
    unlockedAtStart: false,
    skyColor: 0x120616,
    glowColor: 0xff2d95,
  },
];

/** Look up a stage by id; throws on unknown id. */
export function stageById(id: string): StageDef {
  const def = STAGES.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown stage id: ${id}`);
  return def;
}
