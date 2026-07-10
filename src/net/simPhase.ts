/**
 * Netplay sim-phase flags (module-global by design — checked from hot entity
 * code without threading a param through every update signature).
 *
 * resimulating: true ONLY while the rollback session replays already-simulated
 * frames after a misprediction. Entities must skip ALL view work (rig poses,
 * particles, trails, flashes, mesh sync) — the post-rollback reconciliation
 * pass re-syncs visuals from the final restored state. The EventBus is
 * suppressed over the same window (RollbackSession owns both flags).
 *
 * netMode: true while a networked match owns the GameplayScreen — gates
 * behavior that must differ online (no sim pause, confirmed-frame-only
 * irreversibles like level-end navigation and save persistence).
 */
export const simPhase = {
  resimulating: false,
  netMode: false,
};
