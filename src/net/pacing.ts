import type { FrameClock } from './FrameClock';

/**
 * Real-time pacing policy for an online match, extracted from NetMatchScreen
 * so a node test can drive it against real RollbackSessions (pacing.test.ts).
 *
 * Two jobs:
 * 1. Decide how many sim steps to run per fixed-step update. The sim follows
 *    the shared FrameClock — including running ZERO steps when we're ahead —
 *    and catches up at most 2× speed, bounded per rendered frame. A backlog
 *    bigger than CATCHUP_LIMIT_FRAMES is DROPPED by nudging the clock instead
 *    of replayed: a stall must never turn into a fast-forward burst. Both
 *    peers stall (and shift) together — each is capped at the other's inputs
 *    plus the rollback window — so shifted clocks re-converge on their own.
 * 2. Detect a sustained network stall (prediction window exhausted, the sim
 *    cannot advance) so the screen can show a connection banner.
 */

/** Max catch-up speed: 2 sim steps per 60Hz update = 2× real time. */
export const MAX_CATCHUP_STEPS_PER_UPDATE = 2;
/** Hard bound on sim steps between two rendered frames (no invisible bursts). */
export const MAX_STEPS_PER_RENDER = 4;
/** Backlogs beyond this are dropped via FrameClock.nudge, never replayed. */
export const CATCHUP_LIMIT_FRAMES = 8;
/** Consecutive no-progress updates (~0.5s at 60Hz) before the stall banner. */
export const STALL_BANNER_UPDATES = 30;
/** Timesync cadence: at most one ±1-frame nudge per this many updates. */
export const SYNC_INTERVAL_UPDATES = 20;
/** Timesync ignores leads inside this band (estimate noise ≈ ±1 frame). */
export const SYNC_DEADBAND_FRAMES = 2;

export interface PacerStats {
  /** Total frames dropped from the clock instead of fast-forwarded. */
  clockShiftFrames: number;
  /** Times the stall banner threshold was crossed. */
  stallEvents: number;
  /** Total updates that wanted to step but could not. */
  stalledUpdates: number;
  /** Total ±1 timesync nudges applied to re-align with the other players. */
  syncNudges: number;
}

/**
 * How many frames the local sim leads the (slowest) remote sim. Derived from
 * the input stream itself — a peer's newest broadcast input is always its sim
 * frame + its input delay, sent one transit ago — so asymmetric clock shifts
 * are observable without any extra wire traffic or server round-trip:
 * lead ≈ local − (frontier − delay + transit). Positive = we are ahead.
 */
export function estimateFrameLead(
  localFrame: number,
  remoteInputFrontier: number,
  inputDelayFrames: number,
  rttMs: number,
): number {
  const transitFrames = (rttMs / 2) * (60 / 1000);
  return localFrame - remoteInputFrontier + inputDelayFrames - transitFrames;
}

export class MatchPacer {
  readonly stats: PacerStats = { clockShiftFrames: 0, stallEvents: 0, stalledUpdates: 0, syncNudges: 0 };
  private stepsThisRender = 0;
  private noProgressUpdates = 0;
  private updatesSinceSync = 0;
  private stalled = false;

  /** True while the sim has been unable to advance for ~0.5s. */
  get connectionStalled(): boolean {
    return this.stalled;
  }

  /**
   * GGPO-style timesync: asymmetric stalls make each peer drop a different
   * amount of wall time, leaving their clocks skewed — the leader then
   * predicts the laggard several frames ahead forever (constant rollbacks).
   * Gently re-align: the behind peer speeds up (+1 nudge → 2× catch-up), the
   * ahead peer holds (−1 nudge → one zero-step update), rate-limited and
   * dead-banded so estimate noise can't cause oscillation.
   */
  sync(clock: FrameClock, frameLead: number): void {
    this.updatesSinceSync += 1;
    if (this.updatesSinceSync < SYNC_INTERVAL_UPDATES) return;
    this.updatesSinceSync = 0;
    if (frameLead < -SYNC_DEADBAND_FRAMES) {
      clock.nudge(1);
      this.stats.syncNudges += 1;
    } else if (frameLead > SYNC_DEADBAND_FRAMES) {
      clock.nudge(-1);
      this.stats.syncNudges += 1;
    }
  }

  /**
   * One fixed-step update: shift the clock if the backlog is too big to
   * replay, then return how many sim steps to attempt (0 = only flush
   * packets this update).
   */
  plan(clock: FrameClock, nowMs: number, sessionFrame: number): number {
    let behind = clock.targetFrame(nowMs) - sessionFrame;
    if (behind > CATCHUP_LIMIT_FRAMES) {
      const drop = behind - 1;
      clock.nudge(-drop);
      this.stats.clockShiftFrames += drop;
      behind = 1;
    }
    const budget = MAX_STEPS_PER_RENDER - this.stepsThisRender;
    return Math.max(0, Math.min(behind, MAX_CATCHUP_STEPS_PER_UPDATE, budget));
  }

  /** Report what actually happened after pump/flush (stall detection). */
  observe(plannedSteps: number, frameBefore: number, frameAfter: number): void {
    this.stepsThisRender += frameAfter - frameBefore;
    if (frameAfter > frameBefore) {
      this.noProgressUpdates = 0;
      this.stalled = false;
      return;
    }
    if (plannedSteps === 0) return; // idle by choice (ahead of clock), not a stall
    this.noProgressUpdates += 1;
    this.stats.stalledUpdates += 1;
    if (!this.stalled && this.noProgressUpdates >= STALL_BANNER_UPDATES) {
      this.stalled = true;
      this.stats.stallEvents += 1;
    }
  }

  /** Call once per rendered frame: resets the per-render step budget. */
  onRender(): void {
    this.stepsThisRender = 0;
  }
}
