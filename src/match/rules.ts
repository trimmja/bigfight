import type { MatchConfig } from './MatchConfig';
import type { MatchState } from './MatchState';

/**
 * Match end evaluation — pure functions over MatchState (deterministic,
 * no side effects; GameplayScreen applies the results).
 */

export interface MatchEnd {
  /** Slot ids best-to-worst. Ties (same eliminationFrame) share order stably. */
  placements: number[];
  /** teams mode: the winning teamId. */
  winnerTeam?: number;
}

/** FFA: over when ≤1 slot remains uneliminated. */
export function evaluateFfaEnd(state: MatchState): MatchEnd | null {
  let remaining = 0;
  for (const slot of state.slots) if (!slot.eliminated) remaining += 1;
  if (remaining > 1) return null;
  return { placements: computePlacements(state) };
}

/** 2v2: over when every member of a team is eliminated. */
export function evaluateTeamsEnd(state: MatchState, config: MatchConfig): MatchEnd | null {
  const teamAlive = new Map<number, number>();
  for (let i = 0; i < state.slots.length; i += 1) {
    const teamId = config.players[i]!.teamId;
    if (!teamAlive.has(teamId)) teamAlive.set(teamId, 0);
    if (!state.slots[i]!.eliminated) teamAlive.set(teamId, teamAlive.get(teamId)! + 1);
  }
  const teams = [...teamAlive.entries()];
  const alive = teams.filter(([, count]) => count > 0);
  if (alive.length > 1 || teams.length < 2) return null;
  const winnerTeam = alive[0]?.[0];
  const result: MatchEnd = { placements: computePlacements(state) };
  if (winnerTeam !== undefined) result.winnerTeam = winnerTeam;
  return result;
}

/**
 * Placements: survivors first (by slot order — the match ended, they win
 * together or the single survivor leads), then eliminated slots by descending
 * eliminationFrame (later KO = better). Equal frames keep slot order — a
 * deterministic, kid-fair shared placement.
 */
export function computePlacements(state: MatchState): number[] {
  const slots = state.slots.map((slot, index) => ({ slot, index }));
  slots.sort((a, b) => {
    const aOut = a.slot.eliminated ? a.slot.eliminationFrame : Number.POSITIVE_INFINITY;
    const bOut = b.slot.eliminated ? b.slot.eliminationFrame : Number.POSITIVE_INFINITY;
    if (aOut !== bOut) return bOut - aOut;
    return a.index - b.index;
  });
  return slots.map((entry) => entry.index);
}

/** Versus payouts (Ryder's law: losing still pays). Placement-indexed gold. */
export const VERSUS_GOLD_PLACEMENT: readonly number[] = [40, 25, 15, 10];
export const VERSUS_GOLD_PARTICIPATION = 15;
export const VERSUS_GOLD_PER_KO = 10;

export function versusGoldFor(placementIndex: number, kos: number): number {
  return (
    VERSUS_GOLD_PARTICIPATION +
    (VERSUS_GOLD_PLACEMENT[placementIndex] ?? VERSUS_GOLD_PLACEMENT[VERSUS_GOLD_PLACEMENT.length - 1] ?? 0) +
    kos * VERSUS_GOLD_PER_KO
  );
}
