/**
 * ALL multiplayer sim state, as plain scalars — snapshot/rollback-friendly by
 * construction. Nothing here references THREE or DOM; view layers derive from
 * it every rendered frame.
 */

export interface SlotState {
  stocks: number;
  /** Out of the match (stocks exhausted). */
  eliminated: boolean;
  /** Sim frame of elimination (-1 = alive); ties share a placement. */
  eliminationFrame: number;
  /** KO credits (versus payout). */
  kos: number;
  /** Last slot that hit this player (-1 none) — KO attribution. */
  lastHitBySlot: number;
  /** Attribution decays after 4s without a hit. */
  lastHitTimer: number;
  /** Delay before an available stock respawns. */
  respawnTimer: number;
}

export interface MatchState {
  frame: number;
  slots: SlotState[];
  ended: boolean;
  /** Slot ids best-to-worst, filled when the match ends. */
  placements: number[];
}

export function createMatchState(playerCount: number, stocks: number): MatchState {
  const slots: SlotState[] = [];
  for (let i = 0; i < playerCount; i += 1) {
    slots.push({
      stocks,
      eliminated: false,
      eliminationFrame: -1,
      kos: 0,
      lastHitBySlot: -1,
      lastHitTimer: 0,
      respawnTimer: 0,
    });
  }
  return { frame: 0, slots, ended: false, placements: [] };
}

/** Append every scalar (replay digests / net snapshots). */
export function digestMatchState(state: MatchState, out: number[]): void {
  out.push(state.frame, state.ended ? 1 : 0, state.placements.length);
  for (const p of state.placements) out.push(p);
  for (const slot of state.slots) {
    out.push(
      slot.stocks,
      slot.eliminated ? 1 : 0,
      slot.eliminationFrame,
      slot.kos,
      slot.lastHitBySlot,
      slot.lastHitTimer,
      slot.respawnTimer,
    );
  }
}
