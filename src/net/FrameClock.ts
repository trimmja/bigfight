/**
 * Shared match clock: maps wall time to the sim frame every peer should be
 * on. Peers start from the same epoch (server matchStart + agreed countdown);
 * timesync nudges the offset a frame at a time instead of jumping.
 */
export class FrameClock {
  private epochMs = 0;
  private offsetFrames = 0;
  private pauseStartedAtMs: number | null = null;

  start(epochMs: number): void {
    this.epochMs = epochMs;
    this.offsetFrames = 0;
    this.pauseStartedAtMs = null;
  }

  targetFrame(nowMs: number): number {
    return Math.max(0, Math.floor(((nowMs - this.epochMs) / 1000) * 60) + this.offsetFrames);
  }

  /** Timesync: slow down (-1) or speed up (+1) relative to the raw clock. */
  nudge(frames: number): void {
    this.offsetFrames += frames;
  }

  pause(serverTimeMs: number): void {
    if (this.pauseStartedAtMs === null) this.pauseStartedAtMs = serverTimeMs;
  }

  resume(pausedAtMs: number, resumedAtMs: number): void {
    const start = this.pauseStartedAtMs ?? pausedAtMs;
    this.epochMs += Math.max(0, resumedAtMs - start);
    this.pauseStartedAtMs = null;
  }
}
