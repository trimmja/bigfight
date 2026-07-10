import {
  MAX_PLAYERS,
  type MatchLaunch,
  type MatchResultSummary,
  type RoomPlayer,
  type RoomSettings,
  type RoomState,
  type RoomSummary,
  type RoomVisibility,
  type Team,
} from '../shared/protocol';

const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const DEFAULT_SETTINGS: RoomSettings = {
  mode: 'ffa',
  stocks: 3,
  stageId: 'rooftop',
  levelId: 1,
};

export type RoomErrorCode =
  | 'notFound'
  | 'full'
  | 'inProgress'
  | 'releaseMismatch'
  | 'alreadyInRoom'
  | 'notHost'
  | 'notReady'
  | 'invalidPhase';

export class RoomError extends Error {
  constructor(readonly code: RoomErrorCode) {
    super(code);
  }
}

interface RoomRecord extends RoomState {
  createdAt: number;
  updatedAt: number;
  joinOrder: string[];
}

export interface RoomDirectoryOptions {
  now?: () => number;
  createId?: () => string;
  createCode?: () => string;
  createSeed?: () => number;
}

export class RoomDirectory {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly roomIdByCode = new Map<string, string>();
  private readonly roomIdByPlayer = new Map<string, string>();
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly createCode: () => string;
  private readonly createSeed: () => number;

  constructor(options: RoomDirectoryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.createCode = options.createCode ?? (() => randomCode());
    this.createSeed = options.createSeed ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0);
  }

  create(input: {
    playerId: string;
    releaseId: string;
    nickname: string;
    visibility: RoomVisibility;
    name?: string;
  }): RoomState {
    this.assertPlayerFree(input.playerId);
    const id = this.uniqueId();
    const code = this.uniqueCode();
    const nickname = cleanNickname(input.nickname, 'PLAYER 1');
    const now = this.now();
    const player = createPlayer(input.playerId, nickname, 0);
    const room: RoomRecord = {
      id,
      code,
      name: cleanRoomName(input.name, `${nickname}'S GAME`),
      visibility: input.visibility === 'private' ? 'private' : 'public',
      releaseId: input.releaseId,
      hostId: input.playerId,
      phase: 'lobby',
      settings: { ...DEFAULT_SETTINGS },
      players: [player],
      countdownEndsAt: null,
      matchId: null,
      result: null,
      createdAt: now,
      updatedAt: now,
      joinOrder: [input.playerId],
    };
    this.rooms.set(id, room);
    this.roomIdByCode.set(code, id);
    this.roomIdByPlayer.set(input.playerId, id);
    return snapshot(room);
  }

  join(input: {
    playerId: string;
    releaseId: string;
    nickname: string;
    roomId?: string;
    code?: string;
  }): RoomState {
    this.assertPlayerFree(input.playerId);
    const room = this.find(input.roomId, input.code);
    if (!room) throw new RoomError('notFound');
    if (room.releaseId !== input.releaseId) throw new RoomError('releaseMismatch');
    if (room.phase !== 'lobby') throw new RoomError('inProgress');
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('full');
    const slot = lowestFreeSlot(room.players);
    if (slot < 0) throw new RoomError('full');
    const player = createPlayer(input.playerId, cleanNickname(input.nickname, `PLAYER ${slot + 1}`), slot);
    room.players.push(player);
    room.joinOrder.push(input.playerId);
    this.roomIdByPlayer.set(input.playerId, room.id);
    this.touch(room);
    return snapshot(room);
  }

  listPublic(releaseId?: string): RoomSummary[] {
    const summaries: { room: RoomRecord; summary: RoomSummary }[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public' || room.phase !== 'lobby') continue;
      if (releaseId && room.releaseId !== releaseId) continue;
      const host = room.players.find((player) => player.playerId === room.hostId);
      summaries.push({
        room,
        summary: {
          id: room.id,
          name: room.name,
          hostNickname: host?.nickname ?? 'PLAYER',
          mode: room.settings.mode,
          playerCount: room.players.filter((player) => player.connected).length,
          maxPlayers: MAX_PLAYERS,
          stageId: room.settings.stageId,
          releaseId: room.releaseId,
        },
      });
    }
    summaries.sort((a, b) => b.room.updatedAt - a.room.updatedAt || a.room.id.localeCompare(b.room.id));
    return summaries.map((entry) => entry.summary);
  }

  roomForPlayer(playerId: string): RoomState | null {
    const roomId = this.roomIdByPlayer.get(playerId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    return room ? snapshot(room) : null;
  }

  get(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    return room ? snapshot(room) : null;
  }

  setPlayer(playerId: string, patch: {
    nickname?: string;
    characterId?: string | null;
    weaponId?: string;
    team?: Team;
    ready?: boolean;
    dance?: boolean;
  }): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    const player = requirePlayer(room, playerId);
    if (room.phase !== 'lobby' && room.phase !== 'countdown') throw new RoomError('invalidPhase');
    if (patch.nickname !== undefined) player.nickname = cleanNickname(patch.nickname, player.nickname);
    if (patch.characterId !== undefined) player.characterId = cleanId(patch.characterId);
    if (patch.weaponId !== undefined) player.weaponId = cleanId(patch.weaponId) ?? 'rustyPistol';
    if (patch.team === 'A' || patch.team === 'B' || patch.team === null) player.team = patch.team;
    if (patch.ready !== undefined) player.ready = patch.ready;
    if (patch.dance === true) player.danceSeq += 1;
    if (room.phase === 'countdown' && (!player.ready || !player.characterId)) this.cancelCountdownRecord(room);
    this.touch(room);
    return snapshot(room);
  }

  setSettings(playerId: string, patch: Partial<RoomSettings>): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    this.assertHost(room, playerId);
    if (room.phase !== 'lobby') throw new RoomError('invalidPhase');
    if (patch.mode === 'ffa' || patch.mode === 'teams' || patch.mode === 'coop') room.settings.mode = patch.mode;
    if (patch.stocks !== undefined && [1, 2, 3, 4, 5].includes(patch.stocks)) room.settings.stocks = patch.stocks;
    if (patch.stageId !== undefined) {
      const stageId = cleanId(patch.stageId);
      if (stageId) room.settings.stageId = stageId;
    }
    if (patch.levelId !== undefined && Number.isInteger(patch.levelId) && patch.levelId > 0) room.settings.levelId = patch.levelId;
    this.touch(room);
    return snapshot(room);
  }

  startCountdown(playerId: string, durationMs = 3_000): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    this.assertHost(room, playerId);
    if (room.phase !== 'lobby') throw new RoomError('invalidPhase');
    const connected = room.players.filter((player) => player.connected);
    if (connected.length < 2 || connected.some((player) => !player.ready || !player.characterId)) {
      throw new RoomError('notReady');
    }
    room.phase = 'countdown';
    room.countdownEndsAt = this.now() + Math.max(1_000, durationMs);
    room.result = null;
    this.touch(room);
    return snapshot(room);
  }

  cancelCountdown(playerId: string): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    this.assertHost(room, playerId);
    if (room.phase !== 'countdown') throw new RoomError('invalidPhase');
    this.cancelCountdownRecord(room);
    this.touch(room);
    return snapshot(room);
  }

  beginMatch(roomId: string): MatchLaunch {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('notFound');
    if (room.phase !== 'countdown') throw new RoomError('invalidPhase');
    if (room.countdownEndsAt === null || this.now() < room.countdownEndsAt) throw new RoomError('invalidPhase');
    const connected = room.players.filter((player) => player.connected);
    if (connected.length < 2 || connected.some((player) => !player.ready || !player.characterId)) {
      this.cancelCountdownRecord(room);
      throw new RoomError('notReady');
    }
    const matchId = this.uniqueId();
    room.phase = 'match';
    room.matchId = matchId;
    room.countdownEndsAt = null;
    this.touch(room);
    return {
      matchId,
      seed: this.createSeed(),
      startAt: this.now(),
      settings: { ...room.settings },
      players: room.players.map(copyPlayer),
    };
  }

  finishMatch(playerId: string, matchId: string, result: MatchResultSummary): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    this.assertHost(room, playerId);
    if (room.phase !== 'match' || room.matchId !== matchId) throw new RoomError('invalidPhase');
    room.phase = 'results';
    room.result = copyResult(result);
    for (const player of room.players) player.ready = false;
    this.touch(room);
    return snapshot(room);
  }

  returnToLobby(playerId: string): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    this.assertHost(room, playerId);
    if (room.phase !== 'results' && room.phase !== 'paused') throw new RoomError('invalidPhase');
    room.phase = 'lobby';
    room.matchId = null;
    room.result = null;
    room.countdownEndsAt = null;
    for (const player of room.players) player.ready = false;
    this.touch(room);
    return snapshot(room);
  }

  setConnected(playerId: string, connected: boolean): RoomState {
    const room = this.requireRoomForPlayer(playerId);
    const player = requirePlayer(room, playerId);
    player.connected = connected;
    if (!connected && room.phase === 'countdown') this.cancelCountdownRecord(room);
    this.touch(room);
    return snapshot(room);
  }

  removePlayer(playerId: string): RoomState | null {
    const room = this.requireRoomForPlayer(playerId);
    room.players = room.players.filter((player) => player.playerId !== playerId);
    room.joinOrder = room.joinOrder.filter((id) => id !== playerId);
    this.roomIdByPlayer.delete(playerId);
    if (room.players.length === 0) {
      this.deleteRoom(room);
      return null;
    }
    if (room.hostId === playerId) room.hostId = room.joinOrder[0] ?? room.players[0]!.playerId;
    if (room.phase === 'countdown') this.cancelCountdownRecord(room);
    this.touch(room);
    return snapshot(room);
  }

  private find(roomId?: string, code?: string): RoomRecord | null {
    if (roomId) return this.rooms.get(roomId) ?? null;
    const id = code ? this.roomIdByCode.get(code.trim().toUpperCase()) : undefined;
    return id ? this.rooms.get(id) ?? null : null;
  }

  private requireRoomForPlayer(playerId: string): RoomRecord {
    const roomId = this.roomIdByPlayer.get(playerId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) throw new RoomError('notFound');
    return room;
  }

  private assertPlayerFree(playerId: string): void {
    if (this.roomIdByPlayer.has(playerId)) throw new RoomError('alreadyInRoom');
  }

  private assertHost(room: RoomRecord, playerId: string): void {
    if (room.hostId !== playerId) throw new RoomError('notHost');
  }

  private cancelCountdownRecord(room: RoomRecord): void {
    room.phase = 'lobby';
    room.countdownEndsAt = null;
  }

  private touch(room: RoomRecord): void {
    room.updatedAt = this.now();
  }

  private uniqueId(): string {
    let id = this.createId();
    while (this.rooms.has(id)) id = this.createId();
    return id;
  }

  private uniqueCode(): string {
    let code = this.createCode().toUpperCase();
    while (this.roomIdByCode.has(code)) code = this.createCode().toUpperCase();
    return code;
  }

  private deleteRoom(room: RoomRecord): void {
    this.rooms.delete(room.id);
    this.roomIdByCode.delete(room.code);
    for (const player of room.players) this.roomIdByPlayer.delete(player.playerId);
  }
}

function createPlayer(playerId: string, nickname: string, slot: number): RoomPlayer {
  return {
    playerId,
    slot: slot as RoomPlayer['slot'],
    nickname,
    characterId: null,
    weaponId: 'rustyPistol',
    team: null,
    ready: false,
    connected: true,
    danceSeq: 0,
  };
}

function requirePlayer(room: RoomRecord, playerId: string): RoomPlayer {
  const player = room.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new RoomError('notFound');
  return player;
}

function lowestFreeSlot(players: readonly RoomPlayer[]): number {
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    if (!players.some((player) => player.slot === slot)) return slot;
  }
  return -1;
}

function cleanNickname(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return cleaned || fallback;
}

function cleanRoomName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9 '\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return cleaned || fallback;
}

function cleanId(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return cleaned || null;
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function snapshot(room: RoomRecord): RoomState {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    visibility: room.visibility,
    releaseId: room.releaseId,
    hostId: room.hostId,
    phase: room.phase,
    settings: { ...room.settings },
    players: room.players.slice().sort((a, b) => a.slot - b.slot).map(copyPlayer),
    countdownEndsAt: room.countdownEndsAt,
    matchId: room.matchId,
    result: room.result ? copyResult(room.result) : null,
  };
}

function copyPlayer(player: RoomPlayer): RoomPlayer {
  return { ...player };
}

function copyResult(result: MatchResultSummary): MatchResultSummary {
  return { placements: [...result.placements], kosBySlot: [...result.kosBySlot] };
}
