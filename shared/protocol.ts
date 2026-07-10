/** Shared browser/server protocol. Keep runtime values and pure data only. */

export const PROTOCOL_VERSION = 2;
export const MAX_PLAYERS = 4;
export const RELAY_FLAG = 0x80;
export const RELAY_CHANNEL_GAME = 0;
export const RELAY_CHANNEL_CONTROL = 1;

export type GameMode = 'ffa' | 'teams' | 'coop';
export type RoomVisibility = 'public' | 'private';
export type RoomPhase = 'lobby' | 'countdown' | 'match' | 'paused' | 'results';
export type Team = 'A' | 'B' | null;

export interface RoomSettings {
  mode: GameMode;
  stocks: 1 | 2 | 3 | 4 | 5;
  stageId: string;
  levelId: number;
}

export interface RoomPlayer {
  playerId: string;
  slot: 0 | 1 | 2 | 3;
  nickname: string;
  characterId: string | null;
  weaponId: string;
  team: Team;
  ready: boolean;
  connected: boolean;
  danceSeq: number;
}

export interface MatchResultSummary {
  placements: number[];
  kosBySlot: number[];
}

export interface RoomState {
  id: string;
  code: string;
  name: string;
  visibility: RoomVisibility;
  releaseId: string;
  hostId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: RoomPlayer[];
  countdownEndsAt: number | null;
  matchId: string | null;
  result: MatchResultSummary | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  hostNickname: string;
  mode: GameMode;
  playerCount: number;
  maxPlayers: number;
  stageId: string;
  releaseId: string;
}

export interface MatchLaunch {
  matchId: string;
  seed: number;
  startAt: number;
  settings: RoomSettings;
  players: RoomPlayer[];
}

export type JoinFailure =
  | 'notFound'
  | 'full'
  | 'inProgress'
  | 'releaseMismatch'
  | 'alreadyInRoom';

export type C2S =
  | { t: 'hello'; protocol: number; releaseId: string; resumeToken?: string }
  | { t: 'listRooms' }
  | { t: 'createRoom'; nickname: string; visibility: RoomVisibility; name?: string }
  | { t: 'joinRoom'; nickname: string; roomId?: string; code?: string }
  | { t: 'leaveRoom' }
  | { t: 'setPlayer'; nickname?: string; characterId?: string | null; weaponId?: string; team?: Team; ready?: boolean; dance?: boolean }
  | { t: 'setSettings'; settings: Partial<RoomSettings> }
  | { t: 'startMatch' }
  | { t: 'cancelCountdown' }
  | { t: 'finishMatch'; matchId: string; result: MatchResultSummary }
  | { t: 'returnToLobby' }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'ping'; clientTs: number };

export type S2C =
  | { t: 'welcome'; playerId: string; resumeToken: string }
  | { t: 'roomList'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomState }
  | { t: 'joinFailed'; reason: JoinFailure; hostNickname?: string }
  | { t: 'protocolMismatch'; expected: number }
  | { t: 'countdown'; endsAt: number }
  | { t: 'matchStart'; match: MatchLaunch }
  | { t: 'matchPaused'; playerId: string }
  | { t: 'matchResumed' }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'pong'; clientTs: number; serverTs: number };

export function encodeRelayFrame(targetSlot: number, channel: 0 | 1, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(payload.length + 2);
  frame[0] = (targetSlot & 0x7f) | RELAY_FLAG;
  frame[1] = channel;
  frame.set(payload, 2);
  return frame;
}

export function decodeRelayFrame(frame: Uint8Array): { slot: number; channel: 0 | 1; payload: Uint8Array } | null {
  if (frame.length < 2 || (frame[0]! & RELAY_FLAG) === 0) return null;
  const channel = frame[1];
  if (channel !== RELAY_CHANNEL_GAME && channel !== RELAY_CHANNEL_CONTROL) return null;
  return { slot: frame[0]! & 0x7f, channel, payload: frame.subarray(2) };
}
