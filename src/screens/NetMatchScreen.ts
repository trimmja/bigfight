import type { Game } from '../Game';
import type { MatchConfig } from '../match/MatchConfig';
import { FrameClock } from '../net/FrameClock';
import { NetIntentSource } from '../net/inputCodec';
import { RollbackSession } from '../net/RollbackSession';
import { simPhase } from '../net/simPhase';
import type { NetTransport } from '../net/transport';
import { chooseNetworkTuning, type NetworkTuning } from '../net/tuning';
import { GameplayScreen, type VersusEndResult } from './GameplayScreen';
import type { Screen } from './Screen';

export interface NetMatchScreenOptions {
  match: MatchConfig;
  localSlot: number;
  transport: NetTransport;
  /** Wall-clock ms when frame 0 starts (server matchStart epoch + countdown). */
  startEpochMs: number;
  onMatchEnd: (result: VersusEndResult) => void;
  /** Measured in the lobby after direct/relay transport selection. */
  tuning?: NetworkTuning;
  onDisconnect?: (slot: number) => void;
}

/**
 * Online match wrapper: owns the GameplayScreen + RollbackSession and paces
 * the sim by the shared FrameClock instead of the local accumulator. The
 * inner screen renders/behaves exactly like solo — it just eats NetIntentSource
 * inputs the session decodes from the wire.
 */
export class NetMatchScreen implements Screen {
  private inner: GameplayScreen | null = null;
  private session: RollbackSession | null = null;
  private readonly clock = new FrameClock();

  constructor(private readonly opts: NetMatchScreenOptions) {}

  enter(game: Game): void {
    simPhase.netMode = true;
    const playerCount = this.opts.match.players.length;
    const sources: NetIntentSource[] = [];
    for (let i = 0; i < playerCount; i += 1) sources.push(new NetIntentSource());

    const inner = new GameplayScreen({
      match: this.opts.match,
      characterId: this.opts.match.players[this.opts.localSlot]?.characterId ?? 'volt',
      intentSources: sources,
      localSlot: this.opts.localSlot,
      onMatchEnd: (result) => this.opts.onMatchEnd(result),
      // No onPause: the sim never pauses online (ESC handled by overlay UI).
    });
    inner.enter(game);
    this.inner = inner;

    const tuning = this.opts.tuning ?? chooseNetworkTuning(
      this.opts.transport.peerSlots.map((slot) => this.opts.transport.stats(slot)),
    );
    this.session = new RollbackSession({
      game,
      screen: inner,
      transport: this.opts.transport,
      localSlot: this.opts.localSlot,
      playerCount,
      sources,
      inputDelay: tuning.inputDelayFrames,
      rollbackWindow: tuning.rollbackWindowFrames,
    });
    this.clock.start(this.opts.startEpochMs);
  }

  exit(game: Game): void {
    simPhase.netMode = false;
    this.inner?.exit(game);
    this.inner = null;
    this.session = null;
    this.opts.transport.close();
  }

  update(_game: Game, _dt: number): void {
    const session = this.session;
    if (!session) return;
    // Catch up toward the shared clock (bounded — beyond that we stall and
    // timesync handles it), but always pump at least one step attempt.
    const target = this.clock.targetFrame(performance.now());
    const behind = Math.max(0, target - session.frame);
    session.pump(Math.min(4, Math.max(1, behind)));
  }

  render(game: Game, alpha: number): void {
    this.inner?.render(game, alpha);
  }

  /** Live session stats for the net HUD / lobby debug. */
  get stats(): RollbackSession['stats'] | null {
    return this.session?.stats ?? null;
  }
}
