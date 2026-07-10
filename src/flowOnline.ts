import type { S2CMatchStart } from '../shared/protocol';
import { goTitle } from './flow';
import type { Game } from './Game';
import { LobbyClient } from './net/LobbyClient';
import { JoinCodeScreen } from './screens/online/JoinCodeScreen';
import { LobbyScreen } from './screens/online/LobbyScreen';
import { OnlineCharacterSelectScreen } from './screens/online/OnlineCharacterSelectScreen';
import { OnlineMenuScreen } from './screens/online/OnlineMenuScreen';
import { OnlineResultsScreen, type OnlineResultsPayload } from './screens/online/OnlineResultsScreen';
import { toast } from './ui/toasts';
import { wipe } from './ui/transition';

/**
 * Online navigation in one place, mirroring flow.ts: menu → join/lobby →
 * char select → match → results → (rematch/lobby) … One shared LobbyClient
 * lives here for the whole online session; leaving online disposes it.
 */

let client: LobbyClient | null = null;

/** The shared lobby connection (created on first use; netcode uses it too). */
export function lobbyClient(): LobbyClient {
  if (!client) client = new LobbyClient();
  return client;
}

/** Tear down the online session (leaving online entirely). */
function disposeClient(): void {
  client?.dispose();
  client = null;
}

export function goOnlineMenu(game: Game): void {
  wipe(() =>
    game.screens.replace(
      new OnlineMenuScreen(lobbyClient(), {
        onLobby: () => goLobby(game),
        onJoinCode: () => goJoinCode(game),
        onBack: () => {
          disposeClient();
          goTitle(game);
        },
      }),
    ),
  );
}

export function goJoinCode(game: Game, prefillCode?: string): void {
  game.screens.replace(
    new JoinCodeScreen(
      lobbyClient(),
      {
        onLobby: () => goLobby(game),
        onBack: () => goOnlineMenu(game),
      },
      prefillCode,
    ),
  );
}

export function goLobby(game: Game): void {
  wipe(() =>
    game.screens.replace(
      new LobbyScreen(lobbyClient(), {
        onCharSelect: () => goOnlineCharSelect(game),
        onLeft: () => goOnlineMenu(game),
      }),
    ),
  );
}

export function goOnlineCharSelect(game: Game): void {
  wipe(() =>
    game.screens.replace(
      new OnlineCharacterSelectScreen(lobbyClient(), {
        onMatch: (ms) => goOnlineMatch(game, ms),
        onLobby: () => goLobby(game),
        onLeft: () => goOnlineMenu(game),
      }),
    ),
  );
}

export function goOnlineResults(game: Game, payload: OnlineResultsPayload): void {
  game.screens.replace(
    new OnlineResultsScreen(payload, lobbyClient(), {
      onCharSelect: () => goOnlineCharSelect(game),
      onLobby: () => goLobby(game),
      onLeft: () => goOnlineMenu(game),
    }),
  );
}

/**
 * WIRED-BY-NETCODE: this stub is replaced by the online match session. It
 * receives the server's authoritative matchStart (seed, concrete stageId,
 * settings, roster) and must: build the MatchConfig, stand up the P2P/relay
 * transport on lobbyClient() (sendSignal/onSignal + sendRelayFrame/
 * onRelayFrame), screens.replace() into the online GameplayScreen, and on
 * match end have the host send lobbyClient().matchEnd(placements) then route
 * everyone to goOnlineResults(game, payload).
 */
export function goOnlineMatch(_game: Game, matchStart: S2CMatchStart): void {
  console.log('[online] matchStart (netcode not wired yet):', matchStart);
  toast('Match starting… (coming soon!)');
}

/** `?join=CODE` deep link → join screen, pre-filled and auto-submitting. */
export function goOnlineJoinDeepLink(game: Game, code: string): void {
  goJoinCode(game, code);
}
