/**
 * BIG FIGHT — campaign levels (design: Ryder).
 *
 * 12 levels with a fair ramp. Boss levels list only warm-up waves; the boss
 * spawns via `bossId` after all waves clear. Wave delays run 1.2–2s,
 * creeping up as fights get tougher.
 */

import type { LevelDef } from './types';

export const LEVELS: readonly LevelDef[] = [
  {
    id: 1,
    name: 'First Fight',
    stageId: 'rooftop',
    waves: [
      { enemies: [{ enemyId: 'skeleton', count: 2 }], delay: 1.2 },
      { enemies: [{ enemyId: 'skeleton', count: 3 }], delay: 1.4 },
    ],
    goldReward: 25,
  },
  {
    id: 2,
    name: 'Goo Trouble',
    stageId: 'cavern',
    waves: [
      { enemies: [{ enemyId: 'slime', count: 2 }], delay: 1.2 },
      {
        enemies: [
          { enemyId: 'slime', count: 2 },
          { enemyId: 'skeleton', count: 1 },
        ],
        delay: 1.4,
      },
    ],
    goldReward: 35,
    unlocks: { powerupId: 'healOrb' },
  },
  {
    id: 3,
    name: 'Bone Yard',
    stageId: 'graveyard',
    waves: [
      {
        enemies: [
          { enemyId: 'skeleton', count: 2 },
          { enemyId: 'slime', count: 1 },
        ],
        delay: 1.2,
      },
      {
        enemies: [
          { enemyId: 'skeleton', count: 2 },
          { enemyId: 'captain', count: 1 },
        ],
        delay: 1.5,
      },
    ],
    goldReward: 50,
    unlocks: { characterId: 'ace' },
  },
  {
    id: 4,
    name: 'The Bone King',
    stageId: 'graveyard',
    waves: [{ enemies: [{ enemyId: 'skeleton', count: 2 }], delay: 1.2 }],
    bossId: 'skeletonKing',
    goldReward: 90,
    unlocks: { stageId: 'ghostship', characterId: 'comet' },
  },
  {
    id: 5,
    name: 'Haunted Waters',
    stageId: 'ghostship',
    waves: [
      { enemies: [{ enemyId: 'ghost', count: 2 }], delay: 1.3 },
      {
        enemies: [
          { enemyId: 'ghost', count: 2 },
          { enemyId: 'skeleton', count: 2 },
        ],
        delay: 1.5,
      },
    ],
    goldReward: 60,
    unlocks: { powerupId: 'shieldBubble' },
  },
  {
    id: 6,
    name: 'Deck Brawl',
    stageId: 'ghostship',
    waves: [
      {
        enemies: [
          { enemyId: 'ghost', count: 2 },
          { enemyId: 'slime', count: 2 },
        ],
        delay: 1.3,
      },
      {
        enemies: [
          { enemyId: 'captain', count: 1 },
          { enemyId: 'ghost', count: 2 },
        ],
        delay: 1.5,
      },
      {
        enemies: [
          { enemyId: 'skeleton', count: 3 },
          { enemyId: 'slime', count: 1 },
        ],
        delay: 1.6,
      },
    ],
    goldReward: 75,
    unlocks: { characterId: 'blaze' },
  },
  {
    id: 7,
    name: 'Rooftop Rumble',
    stageId: 'rooftop',
    waves: [
      {
        enemies: [
          { enemyId: 'skeleton', count: 3 },
          { enemyId: 'ghost', count: 1 },
        ],
        delay: 1.3,
      },
      {
        enemies: [
          { enemyId: 'captain', count: 2 },
          { enemyId: 'slime', count: 2 },
        ],
        delay: 1.6,
      },
    ],
    goldReward: 85,
    unlocks: { powerupId: 'rageMode' },
  },
  {
    id: 8,
    name: 'The Haunting',
    stageId: 'ghostship',
    waves: [{ enemies: [{ enemyId: 'ghost', count: 2 }], delay: 1.3 }],
    bossId: 'giantGhost',
    goldReward: 130,
    unlocks: { stageId: 'peak' },
  },
  {
    id: 9,
    name: 'Sky High',
    stageId: 'peak',
    waves: [
      { enemies: [{ enemyId: 'miniEagle', count: 3 }], delay: 1.4 },
      {
        enemies: [
          { enemyId: 'miniEagle', count: 2 },
          { enemyId: 'skeleton', count: 2 },
        ],
        delay: 1.6,
      },
    ],
    goldReward: 90,
    unlocks: { characterId: 'nova' },
  },
  {
    id: 10,
    name: 'Storm Peak',
    stageId: 'peak',
    waves: [
      {
        enemies: [
          { enemyId: 'miniEagle', count: 3 },
          { enemyId: 'ghost', count: 1 },
        ],
        delay: 1.5,
      },
      {
        enemies: [
          { enemyId: 'captain', count: 2 },
          { enemyId: 'miniEagle', count: 2 },
        ],
        delay: 1.8,
      },
    ],
    goldReward: 110,
    unlocks: { powerupId: 'giantHammer', stageId: 'finale' },
  },
  {
    id: 11,
    name: 'The Gauntlet',
    stageId: 'finale',
    waves: [
      {
        enemies: [
          { enemyId: 'skeleton', count: 2 },
          { enemyId: 'slime', count: 2 },
        ],
        delay: 1.5,
      },
      {
        enemies: [
          { enemyId: 'ghost', count: 2 },
          { enemyId: 'miniEagle', count: 2 },
        ],
        delay: 1.8,
      },
      {
        enemies: [
          { enemyId: 'captain', count: 2 },
          { enemyId: 'ghost', count: 1 },
        ],
        delay: 2,
      },
    ],
    goldReward: 130,
  },
  {
    id: 12,
    name: 'Lord of the Skies',
    stageId: 'finale',
    waves: [{ enemies: [{ enemyId: 'miniEagle', count: 3 }], delay: 1.5 }],
    bossId: 'giantEagle',
    goldReward: 250,
  },
];

/** Look up a level by its 1-based id; throws on unknown id. */
export function levelById(id: number): LevelDef {
  const def = LEVELS.find((l) => l.id === id);
  if (!def) throw new Error(`Unknown level id: ${id}`);
  return def;
}
