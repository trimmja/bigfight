import type { MatchResultSummary } from '../shared/protocol';
import type { Game } from './Game';
import { versusGoldFor } from './match/rules';
import {
  OnlineSession,
  type OnlineMatchEvent,
  type OnlineMatchReady,
  type OnlineState,
} from './online/OnlineSession';
import type { VersusEndResult } from './screens/GameplayScreen';
import { NetMatchScreen } from './screens/NetMatchScreen';
import { OnlineLobbyScreen } from './screens/online/OnlineLobbyScreen';
import { OnlineResultsScreen } from './screens/online/OnlineResultsScreen';

/**
 * Owns one OnlineSession across browser, loadout, waiting room, match, results,
 * and rematches. Leaving online is the only point where the socket is closed.
 */
export function startOnlineFlow(game: Game, onExit: () => void): void {
  const flow = new OnlineFlow(game, onExit);
  flow.start();
}

class OnlineFlow {
  private readonly session = new OnlineSession();
  private state: OnlineState | null = null;
  private stateUnsubscribe: (() => void) | null = null;
  private matchUnsubscribe: (() => void) | null = null;
  private activeMatch: OnlineMatchReady | null = null;
  private activeMatchScreen: NetMatchScreen | null = null;
  private pendingResult: VersusEndResult | null = null;
  private resultsScreen: OnlineResultsScreen | null = null;
  private finishSent = false;
  private wantsLobby = false;
  private returnSent = false;
  private closed = false;
  private readonly rewardedMatches = new Set<string>();

  constructor(
    private readonly game: Game,
    private readonly onExit: () => void,
  ) {}

  start(): void {
    this.stateUnsubscribe = this.session.subscribe((state) => this.handleState(state));
    this.showLobby();
    this.session.connect();
  }

  private showLobby(): void {
    if (this.closed) return;
    this.wantsLobby = false;
    this.returnSent = false;
    this.resultsScreen = null;
    this.activeMatch = null;
    this.pendingResult = null;
    this.finishSent = false;
    this.game.screens.replace(new OnlineLobbyScreen(this.session, {
      onBack: () => this.exitOnline(),
      onMatch: (match) => this.startMatch(match),
    }));
  }

  private startMatch(match: OnlineMatchReady): void {
    if (this.closed || this.activeMatch?.launch.matchId === match.launch.matchId) return;
    this.activeMatch = match;
    this.pendingResult = null;
    this.finishSent = false;
    this.matchUnsubscribe?.();
    this.matchUnsubscribe = this.session.onMatch((event) => this.handleMatchEvent(event));

    const screen = new NetMatchScreen({
      match: match.config,
      localSlot: match.localSlot,
      transport: match.transport,
      startEpochMs: match.launch.startAt,
      tuning: match.tuning,
      nowMs: match.nowMs,
      onMatchEnd: (result) => this.handleMatchEnd(result),
    });
    this.activeMatchScreen = screen;
    this.game.screens.replace(screen);
  }

  private handleMatchEvent(event: OnlineMatchEvent): void {
    const screen = this.activeMatchScreen;
    if (!screen) return;
    if (event.type === 'paused') screen.pauseForReconnect(event.pausedAt);
    else if (event.type === 'resumed') {
      screen.resumeAfterReconnect(event.pausedAt, event.resumedAt);
    }
  }

  private handleMatchEnd(result: VersusEndResult): void {
    const active = this.activeMatch;
    if (!active || this.pendingResult) return;
    this.pendingResult = result;
    this.submitResultIfHost();
    this.maybeShowAuthoritativeResults();
  }

  private handleState(state: OnlineState): void {
    this.state = state;
    // Host migration can happen after a device has locally finished. The new
    // host takes over both result submission and the requested lobby return.
    this.submitResultIfHost();
    if (this.wantsLobby && !this.returnSent && state.room?.phase === 'results' && this.isHost()) {
      this.returnSent = true;
      this.session.returnToLobby();
    }
    this.maybeShowAuthoritativeResults();

    // The host moves the authoritative room back once; every guest follows
    // automatically instead of having to press a second results button.
    if (state.room?.phase === 'lobby' && (this.wantsLobby || this.resultsScreen)) this.showLobby();
  }

  private submitResultIfHost(): void {
    const active = this.activeMatch;
    const result = this.pendingResult;
    if (!active || !result || this.finishSent || !this.isHost()) return;
    if (this.state?.room?.phase !== 'match') return;
    // The server accepts the deterministic summary from the current host only.
    this.finishSent = true;
    this.session.finishMatch(active.launch.matchId, summaryOf(result));
  }

  private maybeShowAuthoritativeResults(): void {
    const active = this.activeMatch;
    const local = this.pendingResult;
    const authoritative = this.state?.room?.result;
    if (!active || !local || !authoritative || this.resultsScreen) return;
    if (this.state?.room?.phase !== 'results') return;

    const result = resultFromSummary(authoritative, local.winnerTeam);
    if (!this.rewardedMatches.has(active.launch.matchId)) {
      this.rewardedMatches.add(active.launch.matchId);
      this.game.save.gold += result.goldBySlot[active.localSlot] ?? 0;
      this.game.persist();
    }

    this.matchUnsubscribe?.();
    this.matchUnsubscribe = null;
    this.activeMatchScreen = null;
    const screen = new OnlineResultsScreen(active.launch, result, active.localSlot, {
      onBackToRoom: () => this.backToSameRoom(),
      onExitOnline: () => this.exitOnline(),
    });
    this.resultsScreen = screen;
    this.game.screens.replace(screen);
  }

  private backToSameRoom(): void {
    const room = this.state?.room;
    if (room?.phase === 'lobby') {
      this.showLobby();
      return;
    }

    this.wantsLobby = true;
    if (this.isHost() && room?.phase === 'results') {
      this.returnSent = true;
      this.session.returnToLobby();
    } else this.resultsScreen?.waitForHost();
  }

  private isHost(): boolean {
    const state = this.state;
    return Boolean(state?.playerId && state.room?.hostId === state.playerId);
  }

  private exitOnline(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.state?.room) this.session.leaveRoom();
    this.matchUnsubscribe?.();
    this.stateUnsubscribe?.();
    this.matchUnsubscribe = null;
    this.stateUnsubscribe = null;
    this.session.close();
    this.onExit();
  }
}

function summaryOf(result: VersusEndResult): MatchResultSummary {
  return {
    placements: [...result.placements],
    kosBySlot: [...result.kosBySlot],
  };
}

function resultFromSummary(summary: MatchResultSummary, winnerTeam?: number): VersusEndResult {
  const goldBySlot = new Array<number>(summary.kosBySlot.length).fill(0);
  for (let place = 0; place < summary.placements.length; place += 1) {
    const slot = summary.placements[place]!;
    goldBySlot[slot] = versusGoldFor(place, summary.kosBySlot[slot] ?? 0);
  }
  return {
    placements: [...summary.placements],
    kosBySlot: [...summary.kosBySlot],
    goldBySlot,
    ...(winnerTeam === undefined ? {} : { winnerTeam }),
  };
}
