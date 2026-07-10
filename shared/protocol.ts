/**
 * BIG FIGHT — multiplayer wire protocol (v1).
 *
 * Single source of truth for every message exchanged between the browser
 * client (src/) and the Bun room server (server/main.ts). Imported by BOTH
 * via relative path, so it must stay dependency-free and browser-safe:
 * types, constants, and tiny pure helpers only.
 *
 * Transport: one WebSocket per player, endpoint `/ws`.
 *  - TEXT frames are JSON control messages, discriminated on `t`.
 *  - BINARY frames are relay frames the server forwards blindly between
 *    players in the same room (see "Relay frames" at the bottom) — the
 *    WebRTC-fallback path for game/control data.
 */

/** Bump on any breaking wire change; server rejects mismatches with `upgradeRequired`. */
export const PROTOCOL_VERSION = 1;

/** 20 consonants: no vowels (no accidental words), no I/O lookalikes. */
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** Room codes are 4 letters from ROOM_CODE_ALPHABET (160k combinations). */
export const ROOM_CODE_LENGTH = 4;

export const MAX_PLAYERS = 4;

/** Stage pool the server draws from when settings.stageId === 'random'. */
export const VERSUS_STAGE_IDS = [
  'rooftop',
  'cavern',
  'graveyard',
  'ghostship',
  'peak',
  'finale',
] as const;

// ---------------------------------------------------------------------------
// Shared state shapes
// ---------------------------------------------------------------------------

export type GameMode = 'ffa' | 'teams' | 'coop';
export type Team = 'A' | 'B';
export type StockCount = 1 | 2 | 3 | 4 | 5;
export type PlayerSlot = 0 | 1 | 2 | 3;

/**
 * Room lifecycle: lobby → countdown (3s, cancellable) → charSelect →
 * starting (transient, server rolls stage/seed) → match → results →
 * (rematch → charSelect | backToLobby → lobby).
 */
export type RoomPhase =
  | 'lobby'
  | 'countdown'
  | 'charSelect'
  | 'starting'
  | 'match'
  | 'results';

/** Host-controlled match settings (see c2s `setSettings`). */
export interface RoomSettings {
  mode: GameMode;
  stocks: StockCount;
  /** Concrete stage id, or 'random' (resolved by the server at match start). */
  stageId: string;
  /** Co-op campaign level (null outside co-op). */
  levelId: number | null;
}

/** One occupied slot in the room, as seen by everyone. */
export interface RoomPlayer {
  playerId: string;
  slot: PlayerSlot;
  nickname: string;
  /** Character pick made on the char-select screen; null = not picked yet. */
  characterId: string | null;
  ready: boolean;
  /** Team assignment for mode 'teams'; null otherwise/unassigned. */
  team: Team | null;
  /** False while the player is in the reconnect grace window. */
  connected: boolean;
  /** RTTs in ms this player measured to other playerIds (c2s `reportPings`). */
  pings: Record<string, number>;
}

/** Full room snapshot — the server re-sends the whole thing on every change. */
export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  /** Co-op level gate: host's levelsBeaten + 1 (carry-friendly). */
  maxLevelAllowed: number;
  players: RoomPlayer[];
}

/** Per-player payload inside s2c `matchStart`. */
export interface MatchStartPlayer {
  playerId: string;
  slot: PlayerSlot;
  team: Team | null;
  characterId: string;
  nickname: string;
}

// ---------------------------------------------------------------------------
// Client → server messages
// ---------------------------------------------------------------------------

/**
 * First message on every socket. `v` must equal PROTOCOL_VERSION (else the
 * server replies `upgradeRequired` and closes). `buildId` is the client build
 * fingerprint — all players in a room must share the creator's buildId.
 * `resume` reclaims a slot after a disconnect (see s2c `welcome`).
 */
export interface C2SHello {
  t: 'hello';
  v: number;
  buildId: string;
  resume?: { code: string; playerId: string; token: string };
}

/** Create a room; sender becomes host in slot 0. `levelsBeaten` feeds the co-op level gate. */
export interface C2SCreateRoom {
  t: 'createRoom';
  nickname: string;
  levelsBeaten: number;
}

/** Join an existing room by code (case-insensitive). Fails with s2c `joinError`. */
export interface C2SJoinRoom {
  t: 'joinRoom';
  code: string;
  nickname: string;
  levelsBeaten: number;
}

/** Leave the current room. Host leaving closes the room (`roomClosed hostLeft`). */
export interface C2SLeaveRoom {
  t: 'leaveRoom';
}

/**
 * Update the sender's OWN slot. Omitted fields are left unchanged.
 * `pick` sets characterId (null clears it). Un-readying during the lobby
 * countdown cancels it for everyone.
 */
export interface C2SSetPlayer {
  t: 'setPlayer';
  pick?: string | null;
  ready?: boolean;
  team?: Team;
  nickname?: string;
}

/** Host only. Partial update of room settings; `stageId` may be 'random'. */
export interface C2SSetSettings {
  t: 'setSettings';
  mode?: GameMode;
  stocks?: StockCount;
  stageId?: string;
  levelId?: number | null;
}

/**
 * Host only. Explicit start request — valid only in 'charSelect' with every
 * connected player picked + ready (the server auto-starts on that condition
 * anyway; this is an idempotent nudge and is otherwise ignored).
 */
export interface C2SStartMatch {
  t: 'startMatch';
}

/** Host only. From results (or charSelect) back to the lobby; clears ready + rematch votes. */
export interface C2SBackToLobby {
  t: 'backToLobby';
}

/** Host only, during 'match': report the finished match → phase 'results'. */
export interface C2SMatchEnd {
  t: 'matchEnd';
  /** playerIds, winner first. */
  placements: string[];
}

/** Vote to rematch (in 'results'). All connected voted → back to charSelect, picks kept. */
export interface C2SRematchVote {
  t: 'rematchVote';
}

/** Opaque WebRTC signaling (SDP/ICE) relayed verbatim to `to` in the same room. */
export interface C2SSignal {
  t: 'signal';
  to: string;
  data: unknown;
}

/** App-level keepalive/RTT probe; server echoes s2c `pong` with the same ts. */
export interface C2SPing {
  t: 'ping';
  ts: number;
}

/**
 * Report measured RTTs (ms) to other players, keyed by playerId. Server
 * merges into the sender's `pings` map (accepted at most once per second).
 */
export interface C2SReportPings {
  t: 'reportPings';
  pings: Record<string, number>;
}

export type C2S =
  | C2SHello
  | C2SCreateRoom
  | C2SJoinRoom
  | C2SLeaveRoom
  | C2SSetPlayer
  | C2SSetSettings
  | C2SStartMatch
  | C2SBackToLobby
  | C2SMatchEnd
  | C2SRematchVote
  | C2SSignal
  | C2SPing
  | C2SReportPings;

// ---------------------------------------------------------------------------
// Server → client messages
// ---------------------------------------------------------------------------

/**
 * Reply to `hello`. Save both fields: `hello.resume {code, playerId, token}`
 * with these values reclaims your slot within the reconnect grace window
 * (30s, or the whole match while one is running).
 */
export interface S2CWelcome {
  t: 'welcome';
  playerId: string;
  resumeToken: string;
}

/** Full room snapshot — sent to every member on EVERY room change. */
export interface S2CRoom {
  t: 'room';
  room: RoomState;
}

/** Why a createRoom/joinRoom attempt failed. */
export interface S2CJoinError {
  t: 'joinError';
  reason: 'badCode' | 'full' | 'inMatch' | 'versionMismatch';
  /** Set for versionMismatch so the UI can say whose build differs. */
  hostNickname?: string;
}

/** hello.v didn't match PROTOCOL_VERSION; the server closes the socket after this. */
export interface S2CUpgradeRequired {
  t: 'upgradeRequired';
}

/** Lobby countdown started (all ready); charSelect follows after `seconds`. */
export interface S2CCountdown {
  t: 'countdown';
  seconds: number;
}

/** Countdown aborted (someone un-readied or left); room is back in 'lobby'. */
export interface S2CCountdownCancelled {
  t: 'countdownCancelled';
  /** Nickname of the player who caused the cancel. */
  by: string;
}

/**
 * The match is starting. `seed` is a u32 for the deterministic sim RNG;
 * `stageId` is always concrete here ('random' already resolved).
 */
export interface S2CMatchStart {
  t: 'matchStart';
  matchId: string;
  seed: number;
  stageId: string;
  settings: RoomSettings;
  players: MatchStartPlayer[];
}

/** Opaque WebRTC signaling relayed from `from` (see c2s `signal`). */
export interface S2CSignal {
  t: 'signal';
  from: string;
  data: unknown;
}

/** The room is gone: host left, or the room idled out / hit max age. */
export interface S2CRoomClosed {
  t: 'roomClosed';
  reason: 'hostLeft' | 'idle';
}

/** Echo of c2s `ping` (same ts) — measure server RTT client-side. */
export interface S2CPong {
  t: 'pong';
  ts: number;
}

export type S2C =
  | S2CWelcome
  | S2CRoom
  | S2CJoinError
  | S2CUpgradeRequired
  | S2CCountdown
  | S2CCountdownCancelled
  | S2CMatchStart
  | S2CSignal
  | S2CRoomClosed
  | S2CPong;

// ---------------------------------------------------------------------------
// Relay frames (binary WS messages)
// ---------------------------------------------------------------------------
//
// Any BINARY WebSocket message is a relay frame:
//   [u8 slot | 0x80, u8 channel (0=game, 1=control), ...payload]
// Sender sets byte0 to the TARGET slot; the server rewrites byte0 to the
// SENDER's slot and forwards the frame to the target slot's socket in the
// same room, without inspecting the payload.

/** High bit set on byte0 of every relay frame. */
export const RELAY_FLAG = 0x80;

/** Bytes before the payload: [slot|0x80, channel]. */
export const RELAY_HEADER_BYTES = 2;

export const RELAY_CHANNEL_GAME = 0;
export const RELAY_CHANNEL_CONTROL = 1;
export type RelayChannel = 0 | 1;

/** Build a relay frame addressed to `targetSlot` (server rewrites byte0 to the sender's slot). */
export function encodeRelayFrame(
  targetSlot: number,
  channel: RelayChannel,
  payload: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(RELAY_HEADER_BYTES + payload.length);
  frame[0] = (targetSlot & 0x7f) | RELAY_FLAG;
  frame[1] = channel;
  frame.set(payload, RELAY_HEADER_BYTES);
  return frame;
}

/**
 * Parse a relay frame. On the receiving client, `slot` is the SENDER's slot
 * (already rewritten by the server). Returns null for malformed frames.
 * The returned payload is a subarray view (no copy).
 */
export function decodeRelayFrame(
  bytes: Uint8Array,
): { slot: number; channel: number; payload: Uint8Array } | null {
  if (bytes.length < RELAY_HEADER_BYTES) return null;
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (b0 === undefined || b1 === undefined) return null;
  if ((b0 & RELAY_FLAG) === 0) return null;
  return { slot: b0 & 0x7f, channel: b1, payload: bytes.subarray(RELAY_HEADER_BYTES) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Random ROOM_CODE_LENGTH-letter room code from ROOM_CODE_ALPHABET.
 * Pass a seeded rng ([0,1)) for determinism; defaults to Math.random.
 * (Uniqueness is the server's job — it regenerates on collision.)
 */
export function randomRoomCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const idx = Math.min(
      ROOM_CODE_ALPHABET.length - 1,
      Math.floor(rng() * ROOM_CODE_ALPHABET.length),
    );
    code += ROOM_CODE_ALPHABET.charAt(idx);
  }
  return code;
}
