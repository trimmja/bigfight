import { events } from '../core/events';
import type { Game } from '../Game';
import type { MatchConfig } from '../match/MatchConfig';
import { FrameClock } from '../net/FrameClock';
import { NetIntentSource } from '../net/inputCodec';
import { estimateFrameLead, MatchPacer, type PacerStats } from '../net/pacing';
import { RollbackSession, type RollbackStats } from '../net/RollbackSession';
import { simPhase } from '../net/simPhase';
import type { NetTransport } from '../net/transport';
import { chooseNetworkTuning, type NetworkTuning } from '../net/tuning';
import { button, el, uiRoot } from '../ui/dom';
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
  /** Server-synchronized wall clock; LobbySocket.serverNow supplies this. */
  nowMs?: () => number;
  onDisconnect?: (slot: number) => void;
  actions?: {
    pauseMatch(): void;
    resumeMatch(): void;
    forfeitMatch(): void;
  };
}

/**
 * Online match wrapper: owns the GameplayScreen + RollbackSession and paces
 * the sim by the shared FrameClock instead of the local accumulator. The
 * inner screen renders/behaves exactly like solo — it just eats NetIntentSource
 * inputs the session decodes from the wire.
 */
export interface NetDiagnostics {
  rollback: RollbackStats;
  pacer: PacerStats;
  peers: { slot: number; path: string; rttMs: number; jitterMs: number; connected: boolean }[];
}

export class NetMatchScreen implements Screen {
  private inner: GameplayScreen | null = null;
  private session: RollbackSession | null = null;
  private readonly clock = new FrameClock();
  private readonly pacer = new MatchPacer();
  private reconnectPaused = false;
  private game: Game | null = null;
  private menuRoot: HTMLElement | null = null;
  private bannerRoot: HTMLElement | null = null;
  private stallBannerActive = false;
  private menuButtons: HTMLButtonElement[] = [];
  private locallyEnded = false;
  private nextLogFrame = 0;

  constructor(private readonly opts: NetMatchScreenOptions) {}

  enter(game: Game): void {
    this.game = game;
    simPhase.netMode = true;
    const playerCount = this.opts.match.players.length;
    const sources: NetIntentSource[] = [];
    for (let i = 0; i < playerCount; i += 1) sources.push(new NetIntentSource());

    const inner = new GameplayScreen({
      match: this.opts.match,
      characterId: this.opts.match.players[this.opts.localSlot]?.characterId ?? 'volt',
      intentSources: sources,
      localSlot: this.opts.localSlot,
      onMatchEnd: (result) => {
        this.locallyEnded = true;
        this.opts.onMatchEnd(result);
      },
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
      onPeerChange: (slot, event) => {
        if (event === 'lost' || event === 'left') this.opts.onDisconnect?.(slot);
      },
    });
    this.clock.start(this.opts.startEpochMs);
  }

  exit(game: Game): void {
    this.removeMenu();
    this.removeBanner();
    game.input.setTouchControlsVisible(true);
    simPhase.netMode = false;
    this.inner?.exit(game);
    this.inner = null;
    this.session = null;
    this.game = null;
    this.opts.transport.close();
  }

  update(game: Game, _dt: number): void {
    const session = this.session;
    if (!session) return;
    if (game.input.state.pausePressed) {
      if (this.menuRoot) this.resumeFromMenu();
      else if (!this.reconnectPaused && !this.locallyEnded && this.opts.actions) {
        this.showMenu(game);
        this.opts.actions.pauseMatch();
      }
    }
    if (this.reconnectPaused) {
      session.flush();
      return;
    }
    // Follow the shared clock. The pacer bounds catch-up speed and DROPS big
    // backlogs by shifting the clock — a stall never becomes a fast-forward.
    const now = this.opts.nowMs?.() ?? Date.now();
    const frameBefore = session.frame;
    // Timesync: asymmetric stalls skew the peers' locally shifted clocks;
    // re-align to the input stream (skip the noisy first second of a match).
    if (frameBefore > 60 && this.opts.transport.peerSlots.length > 0) {
      let maxRtt = 0;
      for (const slot of this.opts.transport.peerSlots) {
        maxRtt = Math.max(maxRtt, this.opts.transport.stats(slot).rttMs);
      }
      const lead = estimateFrameLead(
        frameBefore,
        session.remoteInputFrontier,
        session.stats.inputDelayFrames,
        maxRtt,
      );
      this.pacer.sync(this.clock, lead);
    }
    const steps = this.pacer.plan(this.clock, now, frameBefore);
    if (steps > 0) session.pump(steps);
    else session.flush();
    this.pacer.observe(steps, frameBefore, session.frame);
    this.syncStallBanner();
    this.logDiagnostics(session);
  }

  render(game: Game, alpha: number): void {
    this.pacer.onRender();
    this.inner?.render(game, alpha);
  }

  /** Live net diagnostics for the HUD / lobby debug / console. */
  get stats(): NetDiagnostics | null {
    const session = this.session;
    if (!session) return null;
    return {
      rollback: session.stats,
      pacer: this.pacer.stats,
      peers: this.opts.transport.peerSlots.map((slot) => {
        const peer = this.opts.transport.stats(slot);
        return { slot, path: peer.path, rttMs: peer.rttMs, jitterMs: peer.jitterMs, connected: peer.connected };
      }),
    };
  }

  /** ~Every 10s: one console line a phone playtest can be diagnosed from. */
  private logDiagnostics(session: RollbackSession): void {
    if (session.frame < this.nextLogFrame) return;
    this.nextLogFrame = session.frame + 600;
    const s = session.stats;
    const peers = this.opts.transport.peerSlots
      .map((slot) => {
        const peer = this.opts.transport.stats(slot);
        return `p${slot}:${peer.path}${peer.connected ? '' : '!'} ${Math.round(peer.rttMs)}ms±${Math.round(peer.jitterMs)}`;
      })
      .join(' ');
    console.info(
      `[net] f=${s.frame} conf=${s.confirmedFrame} ${peers} rollbacks=${s.rollbacks} `
      + `resim=${s.resimmedFrames} stalls=${s.stalledFrames} shifted=${this.pacer.stats.clockShiftFrames}f `
      + `sync=${this.pacer.stats.syncNudges} desyncs=${s.desyncs}`,
    );
  }

  /** Room server calls this after a paused player resumes their session. */
  repairConnections(): void {
    this.session?.repairConnections();
  }

  pauseForReconnect(pausedAt: number): void {
    if (this.reconnectPaused) return;
    this.reconnectPaused = true;
    this.clock.pause(pausedAt);
  }

  resumeAfterReconnect(pausedAt: number, resumedAt: number): void {
    this.onMatchResumed(pausedAt, resumedAt);
  }

  onMatchPaused(info: {
    pausedAt: number;
    isLocal: boolean;
    reason: 'menu' | 'connection';
    nickname: string;
  }): void {
    this.pauseForReconnect(info.pausedAt);
    if (info.reason === 'menu' && info.isLocal) {
      this.removeBanner();
      return;
    }
    // A connection pause supersedes the local pause menu (e.g. RESUME was
    // pressed while the other player is disconnected — the room stays paused).
    if (info.reason === 'connection') this.removeMenu();
    const subtitle = info.reason === 'menu'
      ? `${info.nickname} paused the fight`
      : info.isLocal
        ? 'Reconnecting…'
        : `${info.nickname} is reconnecting…`;
    this.showBanner(subtitle);
  }

  onMatchResumed(pausedAt: number, resumedAt: number): void {
    this.clock.resume(pausedAt, resumedAt);
    this.session?.repairConnections();
    this.reconnectPaused = false;
    this.removeBanner();
    this.removeMenu();
  }

  private showMenu(game: Game): void {
    if (this.menuRoot) return;
    game.input.setTouchControlsVisible(false);
    const root = uiRoot('bf-modal-backdrop');
    this.menuRoot = root;
    const panel = el('div', 'bf-panel', root);
    el('h1', 'bf-title', panel).textContent = 'PAUSED';

    const col = el('div', 'bf-button-col', panel);
    const resume = button('RESUME', () => this.resumeFromMenu(), 'bf-button bf-button-green', col);
    const sound = button(
      game.audio.muted ? 'SOUND: OFF' : 'SOUND: ON',
      () => {
        const muted = !game.audio.muted;
        game.audio.setMuted(muted);
        game.save.settings.muted = muted;
        game.persist();
        sound.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
      },
      'bf-button',
      col,
    );
    const endGame = button(
      'END GAME',
      () => {
        for (const menuButton of this.menuButtons) menuButton.disabled = true;
        this.opts.actions?.forfeitMatch();
      },
      'bf-button bf-button-red',
      col,
    );
    this.menuButtons = [resume, sound, endGame];
    events.emit('ui', { kind: 'confirm' });
  }

  private resumeFromMenu(): void {
    if (!this.menuRoot || !this.opts.actions) return;
    if (this.menuButtons.some((menuButton) => menuButton.disabled)) return;
    // Keep the menu up until the server confirms (onMatchResumed removes it):
    // if the other player is disconnected the room STAYS paused, and removing
    // the menu now would strand this player on a frozen fight with no UI.
    const [resume, sound] = this.menuButtons;
    if (resume) {
      resume.disabled = true;
      resume.textContent = 'RESUMING…';
    }
    if (sound) sound.disabled = true;
    // END GAME stays enabled — always an exit even if the resume never lands.
    this.opts.actions.resumeMatch();
  }

  /** Connection-hiccup banner while the rollback window is exhausted. */
  private syncStallBanner(): void {
    const stalled = this.pacer.connectionStalled;
    if (stalled && !this.stallBannerActive && !this.menuRoot && !this.bannerRoot) {
      this.showBanner('Connection hiccup — hang tight!', 'HOLD ON!');
      this.stallBannerActive = true;
      console.info(`[net] stall: waiting for remote inputs at frame ${this.session?.frame}`);
    } else if (!stalled && this.stallBannerActive) {
      this.stallBannerActive = false;
      this.removeBanner();
      console.info(
        `[net] stall recovered at frame ${this.session?.frame} `
        + `(clock shifted ${this.pacer.stats.clockShiftFrames}f total instead of fast-forwarding)`,
      );
    }
  }

  private showBanner(subtitle: string, titleText = 'PAUSED'): void {
    const game = this.game;
    if (!game) return;
    this.removeBanner();
    game.input.setTouchControlsVisible(false);
    const root = uiRoot('bf-modal-backdrop');
    this.bannerRoot = root;
    const panel = el('div', 'bf-panel', root);
    const title = el('h1', 'bf-title', panel);
    title.textContent = titleText;
    title.style.fontSize = 'clamp(42px, 9vw, 72px)';
    const copy = el('p', '', panel);
    copy.textContent = subtitle;
    copy.style.margin = '0';
    copy.style.fontSize = '16px';
    copy.style.fontWeight = '700';
  }

  private removeMenu(): void {
    this.menuRoot?.remove();
    this.menuRoot = null;
    this.menuButtons = [];
    this.restoreTouchControlsIfClear();
  }

  private removeBanner(): void {
    this.bannerRoot?.remove();
    this.bannerRoot = null;
    this.stallBannerActive = false;
    this.restoreTouchControlsIfClear();
  }

  private restoreTouchControlsIfClear(): void {
    if (!this.menuRoot && !this.bannerRoot) this.game?.input.setTouchControlsVisible(true);
  }
}
