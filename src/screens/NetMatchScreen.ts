import type { Game } from '../Game';
import { events } from '../core/events';
import type { MatchConfig } from '../match/MatchConfig';
import { FrameClock } from '../net/FrameClock';
import { NetIntentSource } from '../net/inputCodec';
import { RollbackSession } from '../net/RollbackSession';
import { simPhase } from '../net/simPhase';
import type { NetTransport } from '../net/transport';
import { GameplayScreen, type LevelEndResult, type VersusEndResult } from './GameplayScreen';
import type { Screen } from './Screen';

/** A hard peer drop stalls the sim (no inputs) — end gracefully after this. */
const DISCONNECT_STALL_FRAMES = 180; // ~3s of no progress
const STALL_TOAST_FRAMES = 30;

export interface NetMatchScreenOptions {
  match: MatchConfig;
  localSlot: number;
  transport: NetTransport;
  /** Wall-clock ms when frame 0 starts (server matchStart epoch + countdown). */
  startEpochMs: number;
  onMatchEnd: (result: VersusEndResult) => void;
  /** Co-op online: campaign level finished (won or lost). */
  onCoopLevelEnd?: (result: LevelEndResult) => void;
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
  private lastFrame = -1;
  private stalledFor = 0;
  private lostPeer: number | null = null;
  private ended = false;

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
      ...(this.opts.onCoopLevelEnd ? { onLevelEnd: this.opts.onCoopLevelEnd } : {}),
      // No onPause: the sim never pauses online (ESC handled by overlay UI).
    });
    inner.enter(game);
    this.inner = inner;

    this.session = new RollbackSession({
      game,
      screen: inner,
      transport: this.opts.transport,
      localSlot: this.opts.localSlot,
      playerCount,
      sources,
    });
    // A peer hard-dropping = its inputs stop → the sim stalls. Note it so the
    // stall handler ends the match cleanly instead of freezing forever.
    this.opts.transport.onPeerChange((slot, ev) => {
      if (ev === 'lost' || ev === 'left') this.lostPeer = slot;
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
    if (!session || this.ended) return;
    // Catch up toward the shared clock (bounded — beyond that we stall and
    // timesync handles it), but always pump at least one step attempt.
    const target = this.clock.targetFrame(performance.now());
    const behind = Math.max(0, target - session.frame);
    session.pump(Math.min(4, Math.max(1, behind)));

    // Stall watchdog: if the frame stops advancing (a peer went silent), warn
    // then end the match rather than freeze the demo.
    if (session.frame === this.lastFrame) {
      this.stalledFor += 1;
      if (this.stalledFor === STALL_TOAST_FRAMES) {
        events.emit('netPeer', { slot: this.lostPeer ?? -1, kind: 'lagging' });
      }
      if (this.stalledFor >= DISCONNECT_STALL_FRAMES) this.endOnDisconnect();
    } else {
      this.lastFrame = session.frame;
      if (this.stalledFor >= STALL_TOAST_FRAMES) {
        events.emit('netPeer', { slot: this.lostPeer ?? -1, kind: 'ok' });
      }
      this.stalledFor = 0;
    }
  }

  /** A peer is gone and the sim can't advance — award the local survivor. */
  private endOnDisconnect(): void {
    if (this.ended) return;
    this.ended = true;
    events.emit('netPeer', { slot: this.lostPeer ?? -1, kind: 'disconnected' });
    const playerCount = this.opts.match.players.length;
    // Everyone still connected outranks everyone who dropped.
    const dropped = new Set<number>(this.lostPeer !== null ? [this.lostPeer] : []);
    const survivors: number[] = [];
    const gone: number[] = [];
    for (let i = 0; i < playerCount; i += 1) (dropped.has(i) ? gone : survivors).push(i);
    if (this.opts.onCoopLevelEnd) {
      // Co-op: a drop just ends the run for the group; keep loot (Ryder's law).
      this.opts.onCoopLevelEnd({ won: false, goldEarned: 0, materialsEarned: {}, levelId: this.opts.match.levelId ?? 1 });
      return;
    }
    const placements = [...survivors, ...gone];
    const result: VersusEndResult = {
      placements,
      kosBySlot: new Array<number>(playerCount).fill(0),
      goldBySlot: new Array<number>(playerCount).fill(0),
    };
    this.opts.onMatchEnd(result);
  }

  render(game: Game, alpha: number): void {
    this.inner?.render(game, alpha);
  }

  /** Live session stats for the net HUD / lobby debug. */
  get stats(): RollbackSession['stats'] | null {
    return this.session?.stats ?? null;
  }
}
