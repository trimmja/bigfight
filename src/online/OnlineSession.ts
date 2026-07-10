import {
  type C2S,
  type MatchLaunch,
  type MatchResultSummary,
  type RoomSettings,
  type RoomState,
  type RoomSummary,
  type RoomVisibility,
  type S2C,
} from '../../shared/protocol';
import { ALL_POWERUP_IDS, assertMatchConfig, type MatchConfig } from '../match/MatchConfig';
import { HybridMeshTransport } from '../net/hybrid';
import { LobbySocket, type LobbyConnectionState, type LobbySocketOptions } from '../net/LobbySocket';
import type { PeerSlot } from '../net/transport';
import { chooseNetworkTuning, type NetworkTuning } from '../net/tuning';

export interface OnlineState {
  connection: LobbyConnectionState;
  playerId: string;
  rooms: readonly RoomSummary[];
  room: RoomState | null;
  error: string | null;
}

export interface OnlineMatchReady {
  launch: MatchLaunch;
  config: MatchConfig;
  localSlot: PeerSlot;
  transport: HybridMeshTransport;
  tuning: NetworkTuning;
  nowMs: () => number;
}

export type OnlineMatchEvent =
  | { type: 'ready'; match: OnlineMatchReady }
  | { type: 'paused'; playerId: string; pausedAt: number }
  | { type: 'resumed'; pausedAt: number; resumedAt: number };

type SetPlayerPatch = Omit<Extract<C2S, { t: 'setPlayer' }>, 't'>;

/** Non-visual online flow controller. Screens render its state and call actions. */
export class OnlineSession {
  private readonly socket: LobbySocket;
  private readonly stateListeners = new Set<(state: OnlineState) => void>();
  private readonly matchListeners = new Set<(event: OnlineMatchEvent) => void>();
  private roomList: RoomSummary[] = [];
  private currentRoom: RoomState | null = null;
  private connection: LobbyConnectionState = 'closed';
  private error: string | null = null;
  private transport: HybridMeshTransport | null = null;
  private transportSignature = '';

  constructor(options: LobbySocketOptions = {}) {
    this.socket = new LobbySocket(options);
    this.socket.subscribe((message) => this.handleMessage(message));
    this.socket.onStatus((state) => {
      this.connection = state;
      if (state === 'reconnecting' && (this.currentRoom?.phase === 'match' || this.currentRoom?.phase === 'paused')) {
        this.emitMatch({
          type: 'paused',
          playerId: this.socket.playerId,
          pausedAt: this.socket.serverNow(),
        });
      }
      this.emitState();
    });
  }

  connect(): void {
    this.socket.connect();
  }

  subscribe(callback: (state: OnlineState) => void): () => void {
    this.stateListeners.add(callback);
    callback(this.snapshot());
    return () => this.stateListeners.delete(callback);
  }

  onMatch(callback: (event: OnlineMatchEvent) => void): () => void {
    this.matchListeners.add(callback);
    return () => this.matchListeners.delete(callback);
  }

  refreshRooms(): void {
    this.send({ t: 'listRooms' });
  }

  createRoom(nickname: string, visibility: RoomVisibility, name?: string): void {
    this.clearError();
    this.send({ t: 'createRoom', nickname, visibility, ...(name ? { name } : {}) });
  }

  joinPublic(nickname: string, roomId: string): void {
    this.clearError();
    this.send({ t: 'joinRoom', nickname, roomId });
  }

  joinPrivate(nickname: string, code: string): void {
    this.clearError();
    this.send({ t: 'joinRoom', nickname, code: code.trim().toUpperCase() });
  }

  leaveRoom(): void {
    this.send({ t: 'leaveRoom' });
    this.currentRoom = null;
    this.closeTransport();
    this.emitState();
  }

  setPlayer(patch: SetPlayerPatch): void {
    this.send({ t: 'setPlayer', ...patch });
  }

  setSettings(settings: Partial<RoomSettings>): void {
    this.send({ t: 'setSettings', settings });
  }

  startMatch(): void {
    this.send({ t: 'startMatch' });
  }

  cancelCountdown(): void {
    this.send({ t: 'cancelCountdown' });
  }

  finishMatch(matchId: string, result: MatchResultSummary): void {
    this.send({ t: 'finishMatch', matchId, result });
  }

  returnToLobby(): void {
    this.send({ t: 'returnToLobby' });
  }

  close(): void {
    this.closeTransport();
    this.socket.close();
    this.stateListeners.clear();
    this.matchListeners.clear();
  }

  private send(message: C2S): void {
    this.socket.send(message);
  }

  private handleMessage(message: S2C): void {
    switch (message.t) {
      case 'welcome':
        this.error = null;
        break;
      case 'roomList':
        this.roomList = [...message.rooms];
        break;
      case 'room':
        this.currentRoom = message.room;
        this.socket.setMatchPlayers(message.room.players);
        if (message.room.phase === 'lobby' && message.room.matchId === null) this.closeTransport();
        break;
      case 'joinFailed':
        this.error = joinFailureCopy(message.reason);
        break;
      case 'protocolMismatch':
        this.error = 'This game updated. Refresh before joining an online fight.';
        break;
      case 'countdown':
        this.prepareTransport();
        break;
      case 'matchStart':
        this.beginMatch(message.match);
        break;
      case 'matchPaused':
        this.emitMatch({ type: 'paused', playerId: message.playerId, pausedAt: message.pausedAt });
        break;
      case 'matchResumed':
        this.emitMatch({ type: 'resumed', pausedAt: message.pausedAt, resumedAt: message.resumedAt });
        break;
      case 'signal':
      case 'pong':
        break;
    }
    this.emitState();
  }

  private prepareTransport(): HybridMeshTransport | null {
    const room = this.currentRoom;
    if (!room) return null;
    const local = room.players.find((player) => player.playerId === this.socket.playerId);
    if (!local || !isPeerSlot(local.slot)) return null;
    const signature = room.players.map((player) => `${player.slot}:${player.playerId}`).join('|');
    if (this.transport && signature === this.transportSignature) return this.transport;
    this.closeTransport();
    this.socket.setMatchPlayers(room.players);
    const peerSlots = room.players
      .map((player) => player.slot)
      .filter((slot): slot is PeerSlot => isPeerSlot(slot) && slot !== local.slot);
    this.transport = new HybridMeshTransport({
      localSlot: local.slot,
      peerSlots,
      signaling: this.socket,
    });
    this.transportSignature = signature;
    return this.transport;
  }

  private beginMatch(launch: MatchLaunch): void {
    const transport = this.prepareTransport();
    const local = launch.players.find((player) => player.playerId === this.socket.playerId);
    if (!transport || !local || !isPeerSlot(local.slot)) {
      this.error = 'Could not prepare this online fight. Return to the room and try again.';
      return;
    }
    try {
      const config = buildMatchConfig(launch);
      const tuning = chooseNetworkTuning(transport.peerSlots.map((slot) => transport.stats(slot)));
      this.emitMatch({
        type: 'ready',
        match: {
          launch,
          config,
          localSlot: local.slot,
          transport,
          tuning,
          nowMs: () => this.socket.serverNow(),
        },
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The room sent an invalid match.';
    }
  }

  private clearError(): void {
    this.error = null;
    this.emitState();
  }

  private closeTransport(): void {
    this.transport?.close();
    this.transport = null;
    this.transportSignature = '';
  }

  private emitState(): void {
    const state = this.snapshot();
    for (const callback of this.stateListeners) callback(state);
  }

  private emitMatch(event: OnlineMatchEvent): void {
    for (const callback of this.matchListeners) callback(event);
  }

  private snapshot(): OnlineState {
    return {
      connection: this.connection,
      playerId: this.socket.playerId,
      rooms: [...this.roomList],
      room: this.currentRoom,
      error: this.error,
    };
  }
}

export function buildMatchConfig(launch: MatchLaunch): MatchConfig {
  const mode = launch.settings.mode;
  const players = [...launch.players]
    .sort((a, b) => a.slot - b.slot)
    .map((player, index) => {
      if (player.slot !== index || !player.characterId) throw new Error('The room has an invalid fighter slot.');
      let teamId: number;
      if (mode === 'ffa') teamId = player.slot + 1;
      else if (mode === 'coop') teamId = 1;
      else teamId = player.team === 'B' ? 2 : player.team === 'A' ? 1 : player.slot % 2 + 1;
      return {
        slot: player.slot,
        characterId: player.characterId,
        weaponId: player.weaponId,
        sidekickId: null,
        teamId,
        nickname: player.nickname,
      };
    });
  const config: MatchConfig = {
    mode,
    players,
    stocks: launch.settings.stocks,
    crates: true,
    powerupIds: [...ALL_POWERUP_IDS],
    seed: launch.seed,
    ...(mode === 'ffa' || mode === 'teams'
      ? { stageId: launch.settings.stageId }
      : { levelId: launch.settings.levelId }),
  };
  assertMatchConfig(config);
  return config;
}

function isPeerSlot(slot: number): slot is PeerSlot {
  return slot === 0 || slot === 1 || slot === 2 || slot === 3;
}

function joinFailureCopy(reason: Extract<S2C, { t: 'joinFailed' }>['reason']): string {
  switch (reason) {
    case 'notFound': return 'That game is no longer open.';
    case 'full': return 'That game filled up. Pick another one.';
    case 'inProgress': return 'That fight already started.';
    case 'releaseMismatch': return 'That room uses a different game update. Refresh and try again.';
    case 'alreadyInRoom': return 'Leave your current room before joining another one.';
  }
}
