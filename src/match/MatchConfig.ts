import type { PowerupId } from '../data/types';

/**
 * Everything a match needs to construct itself identically on every peer.
 * Built locally for solo/campaign; delivered via the server's `matchStart`
 * for online play (seed, players, settings). Hand the SAME config + the same
 * per-frame inputs to any device and the sim plays out bit-identically.
 */

export type MatchModeId = 'campaign' | 'coop' | 'ffa' | 'teams';

export interface PlayerSetup {
  /** Stable identity: slot drives color, spawn point, HUD order. */
  slot: 0 | 1 | 2 | 3;
  characterId: string;
  weaponId: string;
  /** Campaign/co-op only; versus v1 has no sidekicks. */
  sidekickId: string | null;
  /** Combat gate: FFA unique per slot (1-4); teams share (1/2); PvE all 1. */
  teamId: number;
  nickname: string;
}

export interface MatchConfig {
  mode: MatchModeId;
  players: PlayerSetup[];
  /** Versus: explicit stage. Campaign/co-op: derived from levelId. */
  stageId?: string;
  levelId?: number;
  /** Stocks per player (versus + co-op). */
  stocks: number;
  /** Versus item crates (Smash items vibe) — host-toggleable later. */
  crates: boolean;
  /**
   * Crate contents — must be identical on every peer (NEVER derived from a
   * device's own save mid-match). Versus: all five. Co-op: host's unlocks.
   */
  powerupIds: PowerupId[];
  /** Sim RNG seed (host/server picks for online matches). */
  seed: number;
}

export const ALL_POWERUP_IDS: readonly PowerupId[] = [
  'healOrb',
  'shieldBubble',
  'rageMode',
  'giantHammer',
  'freezeRay',
];

export function isVersus(mode: MatchModeId): boolean {
  return mode === 'ffa' || mode === 'teams';
}
