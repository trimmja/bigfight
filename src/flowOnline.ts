import type { S2CMatchStart } from '../shared/protocol';
import { goTitle } from './flow';
import type { Game } from './Game';
import { ALL_POWERUP_IDS, type MatchConfig, type PlayerSetup } from './match/MatchConfig';
import { LobbyClient } from './net/LobbyClient';
import { WsRelayTransport } from './net/WsRelayTransport';
import { JoinCodeScreen } from './screens/online/JoinCodeScreen';
import { LobbyScreen } from './screens/online/LobbyScreen';
import { OnlineCharacterSelectScreen } from './screens/online/OnlineCharacterSelectScreen';
import { OnlineMenuScreen } from './screens/online/OnlineMenuScreen';
import { OnlineResultsScreen, type OnlineResultsPayload } from './screens/online/OnlineResultsScreen';
import { NetMatchScreen } from './screens/NetMatchScreen';
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
 * The online match: server matchStart → MatchConfig → NetMatchScreen
 * (GameplayScreen + RollbackSession) over the Fly relay transport. The
 * MatchConfig is a pure function of matchStart, so every peer constructs an
 * identical sim; the seed + per-frame inputs do the rest.
 */
export function goOnlineMatch(game: Game, matchStart: S2CMatchStart): void {
  const client = lobbyClient();
  const roster = [...matchStart.players].sort((a, b) => a.slot - b.slot);
  const localIndex = roster.findIndex((p) => p.playerId === client.selfId);
  if (localIndex < 0) {
    toast("Couldn't find your fighter — back to the lobby!");
    goLobby(game);
    return;
  }

  const mode =
    matchStart.settings.mode === 'coop' ? 'coop' : matchStart.settings.mode === 'teams' ? 'teams' : 'ffa';
  const players: PlayerSetup[] = roster.map((p, i) => ({
    slot: i as PlayerSetup['slot'],
    characterId: p.characterId,
    // Versus v1: everyone brings the same starter (weapons aren't lobby picks
    // yet — MUST be identical on all peers, never from a local save).
    weaponId: 'rustyPistol',
    sidekickId: null,
    teamId: mode === 'ffa' ? i + 1 : p.team === 'B' ? 2 : 1,
    nickname: p.nickname,
  }));
  const config: MatchConfig = {
    mode,
    players,
    stageId: matchStart.stageId,
    stocks: matchStart.settings.stocks,
    crates: true,
    powerupIds: [...ALL_POWERUP_IDS],
    seed: matchStart.seed,
    ...(mode === 'coop' && matchStart.settings.levelId ? { levelId: matchStart.settings.levelId } : {}),
  };

  const transport = new WsRelayTransport(
    client,
    localIndex as 0 | 1 | 2 | 3,
    roster.map((p) => p.slot),
  );

  game.screens.replace(
    new NetMatchScreen({
      match: config,
      localSlot: localIndex,
      transport,
      startEpochMs: performance.now() + 400,
      onMatchEnd: (result) => {
        // Everyone banks their own payout (Ryder's law — losing still pays).
        const myGold = result.goldBySlot[localIndex] ?? 0;
        game.save.gold += myGold;
        game.persist();
        if (client.isHost) {
          client.matchEnd(result.placements.map((slot) => roster[slot]?.playerId ?? ''));
        }
        const payload: OnlineResultsPayload = {
          placements: result.placements,
          kosBySlot: Object.fromEntries(result.kosBySlot.map((kos, slot) => [slot, kos])),
          goldBySlot: Object.fromEntries(result.goldBySlot.map((gold, slot) => [slot, gold])),
          players: roster.map((p, i) => ({ slot: i, nickname: p.nickname, characterId: p.characterId })),
        };
        goOnlineResults(game, payload);
      },
      onCoopLevelEnd: (result) => {
        // Co-op online (beta): everyone banks the FULL pot on their own save.
        game.save.gold += result.goldEarned;
        for (const [id, count] of Object.entries(result.materialsEarned)) {
          const key = id as keyof typeof game.save.materials;
          game.save.materials[key] += count ?? 0;
        }
        if (result.won && result.levelId > game.save.levelsBeaten) {
          game.save.levelsBeaten = result.levelId;
        }
        game.persist();
        if (client.isHost) client.backToLobby();
        toast(result.won ? '🏆 Level cleared — loot banked!' : 'Defeated… but you keep all your loot!');
        goLobby(game);
      },
    }),
  );
}

/** `?join=CODE` deep link → join screen, pre-filled and auto-submitting. */
export function goOnlineJoinDeepLink(game: Game, code: string): void {
  goJoinCode(game, code);
}
