import type { StateIO } from '../net/snapshots';

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

/** Rollback snapshots — one function, both directions (see net/snapshots). */
export function syncMatchState(state: MatchState, io: StateIO): void {
  state.frame = io.i32(state.frame);
  state.ended = io.bool(state.ended);
  if (io.reading) {
    const count = io.i32(0);
    state.placements.length = 0;
    for (let i = 0; i < count; i += 1) state.placements.push(io.i32(0));
  } else {
    io.i32(state.placements.length);
    for (const p of state.placements) io.i32(p);
  }
  for (const slot of state.slots) {
    slot.stocks = io.i32(slot.stocks);
    slot.eliminated = io.bool(slot.eliminated);
    slot.eliminationFrame = io.i32(slot.eliminationFrame);
    slot.kos = io.i32(slot.kos);
    slot.lastHitBySlot = io.i32(slot.lastHitBySlot);
    slot.lastHitTimer = io.f64(slot.lastHitTimer);
    slot.respawnTimer = io.f64(slot.respawnTimer);
  }
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
