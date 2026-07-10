/**
 * BIG FIGHT room/signaling/relay server.
 *
 * Bun only — no framework, no dependencies. Run: `bun server/main.ts`.
 *
 *  - HTTP: serves the built client from server/public/ (+ GET /healthz).
 *  - WS /ws: JSON control messages per ../shared/protocol.ts; BINARY frames
 *    are relay frames forwarded blindly between slots in the same room.
 *
 * Room rules (v1): join only in 'lobby'; host leaving closes the room;
 * disconnects get a 30s reconnect grace (whole match while phase==='match');
 * empty rooms GC after 5 min, absolute room lifetime 6h.
 */
declare const Bun: any;

import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  RELAY_FLAG,
  VERSUS_STAGE_IDS,
  randomRoomCode,
  type C2S,
  type RoomPhase,
  type RoomSettings,
  type RoomState,
  type S2C,
  type Team,
} from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = `${import.meta.dir}/public`;
const COUNTDOWN_SECONDS = 3;
const RECONNECT_GRACE_MS = 30_000;
const KEEPALIVE_INTERVAL_MS = 20_000;
const EMPTY_ROOM_TTL_MS = 5 * 60_000;
const ROOM_MAX_AGE_MS = 6 * 60 * 60_000;
const PING_REPORT_MIN_INTERVAL_MS = 1_000;
const PING_SNAPSHOT_MIN_INTERVAL_MS = 1_000;
const STARTED_AT = Date.now();

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

interface Conn {
  helloed: boolean;
  buildId: string;
  playerId: string;
  resumeToken: string;
  roomCode: string | null;
  missedPongs: number;
}

/** Loose structural type for Bun's ServerWebSocket (bun-types not required). */
interface WS {
  data: Conn;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  ping(): void;
}

interface PlayerRec {
  playerId: string;
  resumeToken: string;
  slot: number;
  nickname: string;
  characterId: string | null;
  ready: boolean;
  team: Team | null;
  connected: boolean;
  pings: Record<string, number>;
  levelsBeaten: number;
  rematchVote: boolean;
  lastPingsReportAt: number;
  ws: WS | null;
  vacateTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  hostId: string;
  buildId: string;
  phase: RoomPhase;
  settings: RoomSettings;
  maxLevelAllowed: number;
  players: PlayerRec[];
  countdownTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  emptySince: number | null;
  lastSnapshotAt: number;
  pendingSnapshot: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();
const sockets = new Set<WS>();

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function send(ws: WS | null, msg: S2C): void {
  if (!ws) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket already closing */
  }
}

function broadcast(room: Room, msg: S2C): void {
  const text = JSON.stringify(msg);
  for (const p of room.players) {
    if (p.ws) {
      try {
        p.ws.send(text);
      } catch {
        /* ignore */
      }
    }
  }
}

function snapshot(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: { ...room.settings },
    maxLevelAllowed: room.maxLevelAllowed,
    players: room.players
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        playerId: p.playerId,
        slot: p.slot as 0 | 1 | 2 | 3,
        nickname: p.nickname,
        characterId: p.characterId,
        ready: p.ready,
        team: p.team,
        connected: p.connected,
        pings: { ...p.pings },
      })),
  };
}

/** Broadcast a full room snapshot. Ping-only changes are throttled to 1/s. */
function broadcastRoom(room: Room, pingOnly = false): void {
  const now = Date.now();
  if (pingOnly && now - room.lastSnapshotAt < PING_SNAPSHOT_MIN_INTERVAL_MS) {
    if (!room.pendingSnapshot) {
      const delay = PING_SNAPSHOT_MIN_INTERVAL_MS - (now - room.lastSnapshotAt);
      room.pendingSnapshot = setTimeout(() => {
        room.pendingSnapshot = null;
        if (rooms.get(room.code) === room) broadcastRoom(room);
      }, delay);
    }
    return;
  }
  if (room.pendingSnapshot) {
    clearTimeout(room.pendingSnapshot);
    room.pendingSnapshot = null;
  }
  room.lastSnapshotAt = now;
  broadcast(room, { t: 'room', room: snapshot(room) });
}

function connectedPlayers(room: Room): PlayerRec[] {
  return room.players.filter((p) => p.connected);
}

function updateEmptySince(room: Room): void {
  room.emptySince = connectedPlayers(room).length === 0 ? (room.emptySince ?? Date.now()) : null;
}

function lowestFreeSlot(room: Room): number {
  for (let s = 0; s < MAX_PLAYERS; s += 1) {
    if (!room.players.some((p) => p.slot === s)) return s;
  }
  return -1;
}

function cleanNickname(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 24) : '';
  return s.length > 0 ? s : fallback;
}

function makePlayer(conn: Conn, nickname: string, levelsBeaten: number, slot: number): PlayerRec {
  return {
    playerId: conn.playerId,
    resumeToken: conn.resumeToken,
    slot,
    nickname,
    characterId: null,
    ready: false,
    team: null,
    connected: true,
    pings: {},
    levelsBeaten: Math.max(0, Number(levelsBeaten) || 0),
    rematchVote: false,
    lastPingsReportAt: 0,
    ws: null,
    vacateTimer: null,
  };
}

function findPlayer(room: Room, playerId: string): PlayerRec | undefined {
  return room.players.find((p) => p.playerId === playerId);
}

function clearVacate(p: PlayerRec): void {
  if (p.vacateTimer) {
    clearTimeout(p.vacateTimer);
    p.vacateTimer = null;
  }
}

// --------------------------------------------------------------------------
// Room lifecycle
// --------------------------------------------------------------------------

function closeRoom(room: Room, reason: 'hostLeft' | 'idle'): void {
  broadcast(room, { t: 'roomClosed', reason });
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  if (room.pendingSnapshot) clearTimeout(room.pendingSnapshot);
  for (const p of room.players) {
    clearVacate(p);
    if (p.ws) p.ws.data.roomCode = null;
  }
  rooms.delete(room.code);
  log(`room ${room.code} closed (${reason})`);
}

function cancelCountdown(room: Room, by: string): void {
  if (room.phase !== 'countdown') return;
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.phase = 'lobby';
  broadcast(room, { t: 'countdownCancelled', by });
  broadcastRoom(room);
}

/**
 * Lobby is now the ONE staging room: players pick their fighter AND ready up
 * here (no separate char-select phase). ≥2 connected, ALL picked + ready →
 * 3s countdown → match. A late unready/unpick/leave cancels it (setPlayer +
 * cancelCountdown handle that), and we re-validate when the timer fires.
 */
function checkLobbyCountdown(room: Room): void {
  if (room.phase !== 'lobby') return;
  const conn = connectedPlayers(room);
  if (conn.length < 2 || !conn.every((p) => p.ready && p.characterId !== null)) return;
  room.phase = 'countdown';
  broadcast(room, { t: 'countdown', seconds: COUNTDOWN_SECONDS });
  broadcastRoom(room);
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    if (rooms.get(room.code) !== room || room.phase !== 'countdown') return;
    const ready = connectedPlayers(room);
    if (ready.length < 2 || !ready.every((p) => p.ready && p.characterId !== null)) {
      room.phase = 'lobby';
      broadcastRoom(room);
      return;
    }
    beginMatch(room, ready);
  }, COUNTDOWN_SECONDS * 1000);
}

function beginMatch(room: Room, players: PlayerRec[]): void {
  room.phase = 'starting';
  const stageId =
    room.settings.stageId === 'random'
      ? VERSUS_STAGE_IDS[Math.floor(Math.random() * VERSUS_STAGE_IDS.length)]!
      : room.settings.stageId;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0;
  const matchId = crypto.randomUUID();
  broadcast(room, {
    t: 'matchStart',
    matchId,
    seed,
    stageId,
    settings: { ...room.settings },
    players: players.map((p) => ({
      playerId: p.playerId,
      slot: p.slot as 0 | 1 | 2 | 3,
      team: p.team,
      characterId: p.characterId ?? '',
      nickname: p.nickname,
    })),
  });
  room.phase = 'match';
  broadcastRoom(room);
  log(`room ${room.code} match ${matchId} started (stage=${stageId} seed=${seed})`);
}

/** Remove a player's slot entirely (explicit leave or expired grace). */
function removePlayer(room: Room, p: PlayerRec): void {
  if (p.playerId === room.hostId) {
    closeRoom(room, 'hostLeft');
    return;
  }
  clearVacate(p);
  if (p.ws) p.ws.data.roomCode = null;
  room.players = room.players.filter((q) => q !== p);
  log(`room ${room.code}: ${p.nickname} left (${room.players.length} remain)`);
  if (room.phase === 'countdown') cancelCountdown(room, p.nickname);
  updateEmptySince(room);
  broadcastRoom(room);
  checkLobbyCountdown(room);
  checkRematch(room);
}

function scheduleVacate(room: Room, p: PlayerRec): void {
  clearVacate(p);
  p.vacateTimer = setTimeout(() => {
    p.vacateTimer = null;
    if (rooms.get(room.code) !== room || p.connected) return;
    removePlayer(room, p);
  }, RECONNECT_GRACE_MS);
}

/** Socket dropped (not an explicit leave): keep the slot for a grace window. */
function handleDisconnect(ws: WS): void {
  const conn = ws.data;
  if (!conn.roomCode) return;
  const room = rooms.get(conn.roomCode);
  conn.roomCode = null;
  if (!room) return;
  const p = findPlayer(room, conn.playerId);
  if (!p || p.ws !== ws) return; // stale socket (already resumed elsewhere)
  p.ws = null;
  p.connected = false;
  if (room.phase === 'countdown') cancelCountdown(room, p.nickname);
  updateEmptySince(room);
  // During a match every slot is held until matchEnd; otherwise 30s grace.
  if (room.phase !== 'match') scheduleVacate(room, p);
  broadcastRoom(room);
  checkLobbyCountdown(room);
  checkRematch(room);
}

function checkRematch(room: Room): void {
  if (room.phase !== 'results') return;
  const conn = connectedPlayers(room);
  if (conn.length === 0 || !conn.every((p) => p.rematchVote)) return;
  room.phase = 'lobby'; // back to the staging room; picks kept, re-ready to go
  for (const p of room.players) {
    p.ready = false; // picks kept
    p.rematchVote = false;
  }
  broadcastRoom(room);
}

// --------------------------------------------------------------------------
// Control message handling
// --------------------------------------------------------------------------

function handleControl(ws: WS, msg: C2S): void {
  const conn = ws.data;

  if (msg.t === 'hello') {
    if (typeof msg.v !== 'number' || msg.v !== PROTOCOL_VERSION) {
      send(ws, { t: 'upgradeRequired' });
      ws.close(4000, 'protocol version mismatch');
      return;
    }
    conn.helloed = true;
    conn.buildId = typeof msg.buildId === 'string' ? msg.buildId : '';
    // Resume: reclaim a held slot after a disconnect.
    if (msg.resume) {
      const room = rooms.get(String(msg.resume.code ?? '').toUpperCase());
      const p = room ? findPlayer(room, msg.resume.playerId) : undefined;
      if (room && p && p.resumeToken === msg.resume.token) {
        if (p.ws && p.ws !== ws) p.ws.close(4001, 'resumed elsewhere');
        clearVacate(p);
        p.ws = ws;
        p.connected = true;
        conn.playerId = p.playerId;
        conn.resumeToken = p.resumeToken;
        conn.roomCode = room.code;
        conn.buildId = room.buildId; // resumed session is by definition same build
        updateEmptySince(room);
        send(ws, { t: 'welcome', playerId: p.playerId, resumeToken: p.resumeToken });
        broadcastRoom(room);
        log(`room ${room.code}: ${p.nickname} resumed`);
        return;
      }
      // Invalid/expired resume falls through to a fresh identity.
    }
    send(ws, { t: 'welcome', playerId: conn.playerId, resumeToken: conn.resumeToken });
    return;
  }

  if (!conn.helloed) {
    ws.close(4002, 'hello required first');
    return;
  }

  if (msg.t === 'ping') {
    send(ws, { t: 'pong', ts: Number(msg.ts) || 0 });
    return;
  }

  if (msg.t === 'createRoom') {
    if (conn.roomCode) return;
    let code = randomRoomCode();
    while (rooms.has(code)) code = randomRoomCode();
    const nickname = cleanNickname(msg.nickname, 'HOST');
    const host = makePlayer(conn, nickname, msg.levelsBeaten, 0);
    host.ws = ws;
    const room: Room = {
      code,
      hostId: conn.playerId,
      buildId: conn.buildId,
      phase: 'lobby',
      settings: { mode: 'ffa', stocks: 3, stageId: 'random', levelId: null },
      maxLevelAllowed: host.levelsBeaten + 1,
      players: [host],
      countdownTimer: null,
      createdAt: Date.now(),
      emptySince: null,
      lastSnapshotAt: 0,
      pendingSnapshot: null,
    };
    rooms.set(code, room);
    conn.roomCode = code;
    broadcastRoom(room);
    log(`room ${code} created by ${nickname} (${rooms.size} rooms)`);
    return;
  }

  if (msg.t === 'joinRoom') {
    if (conn.roomCode) return;
    const code = String(msg.code ?? '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      send(ws, { t: 'joinError', reason: 'badCode' });
      return;
    }
    const host = findPlayer(room, room.hostId);
    if (room.buildId !== conn.buildId) {
      send(ws, { t: 'joinError', reason: 'versionMismatch', hostNickname: host?.nickname });
      return;
    }
    if (room.phase !== 'lobby') {
      send(ws, { t: 'joinError', reason: 'inMatch', hostNickname: host?.nickname });
      return;
    }
    const slot = lowestFreeSlot(room);
    if (slot === -1) {
      send(ws, { t: 'joinError', reason: 'full', hostNickname: host?.nickname });
      return;
    }
    const nickname = cleanNickname(msg.nickname, `PLAYER ${slot + 1}`);
    const p = makePlayer(conn, nickname, msg.levelsBeaten, slot);
    p.ws = ws;
    room.players.push(p);
    conn.roomCode = room.code;
    updateEmptySince(room);
    broadcastRoom(room);
    log(`room ${code}: ${nickname} joined slot ${slot}`);
    return;
  }

  // Everything below requires being in a room.
  const room = conn.roomCode ? rooms.get(conn.roomCode) : undefined;
  const self = room ? findPlayer(room, conn.playerId) : undefined;
  if (!room || !self) return;
  const isHost = conn.playerId === room.hostId;

  switch (msg.t) {
    case 'leaveRoom': {
      conn.roomCode = null;
      removePlayer(room, self);
      return;
    }

    case 'setPlayer': {
      if (msg.nickname !== undefined) self.nickname = cleanNickname(msg.nickname, self.nickname);
      if (msg.pick !== undefined) {
        self.characterId = typeof msg.pick === 'string' ? msg.pick : null;
      }
      if (msg.team === 'A' || msg.team === 'B') self.team = msg.team;
      if (typeof msg.ready === 'boolean') {
        self.ready = msg.ready;
        if (!msg.ready && room.phase === 'countdown') {
          cancelCountdown(room, self.nickname);
          return; // cancelCountdown already broadcast
        }
      }
      broadcastRoom(room);
      checkLobbyCountdown(room);
      return;
    }

    case 'setSettings': {
      if (!isHost) return;
      if (room.phase !== 'lobby' && room.phase !== 'charSelect' && room.phase !== 'results') return;
      const s = room.settings;
      if (msg.mode === 'ffa' || msg.mode === 'teams' || msg.mode === 'coop') s.mode = msg.mode;
      if (typeof msg.stocks === 'number' && [1, 2, 3, 4, 5].includes(msg.stocks)) {
        s.stocks = msg.stocks;
      }
      if (typeof msg.stageId === 'string' && msg.stageId.length > 0) s.stageId = msg.stageId;
      if (msg.levelId !== undefined) {
        s.levelId = typeof msg.levelId === 'number' ? msg.levelId : null;
      }
      broadcastRoom(room);
      return;
    }

    case 'startMatch': {
      if (!isHost) return;
      checkLobbyCountdown(room); // validates ≥2 picked + ready; else no-op
      return;
    }

    case 'matchEnd': {
      if (!isHost || room.phase !== 'match') return;
      room.phase = 'results';
      for (const p of room.players) {
        p.rematchVote = false;
        // Slots held for the whole match now get their normal grace window.
        if (!p.connected) scheduleVacate(room, p);
      }
      broadcastRoom(room);
      log(`room ${room.code} match ended`);
      return;
    }

    case 'rematchVote': {
      if (room.phase !== 'results') return;
      self.rematchVote = true;
      broadcastRoom(room);
      checkRematch(room);
      return;
    }

    case 'backToLobby': {
      if (!isHost) return;
      if (room.countdownTimer) {
        clearTimeout(room.countdownTimer);
        room.countdownTimer = null;
      }
      room.phase = 'lobby';
      for (const p of room.players) {
        p.ready = false;
        p.rematchVote = false;
      }
      broadcastRoom(room);
      return;
    }

    case 'signal': {
      const target = findPlayer(room, String(msg.to ?? ''));
      if (target?.ws) send(target.ws, { t: 'signal', from: conn.playerId, data: msg.data });
      return;
    }

    case 'reportPings': {
      const now = Date.now();
      if (now - self.lastPingsReportAt < PING_REPORT_MIN_INTERVAL_MS) return;
      self.lastPingsReportAt = now;
      if (msg.pings && typeof msg.pings === 'object') {
        for (const [id, rtt] of Object.entries(msg.pings)) {
          if (typeof rtt === 'number' && Number.isFinite(rtt)) {
            self.pings[id] = Math.max(0, Math.round(rtt));
          }
        }
      }
      broadcastRoom(room, true);
      return;
    }

    default:
      return;
  }
}

/** Binary relay: [u8 targetSlot|0x80, u8 channel, ...payload] → rewrite byte0 to fromSlot, forward. */
function handleRelay(ws: WS, bytes: Uint8Array): void {
  const conn = ws.data;
  if (!conn.roomCode || bytes.length < 2) return;
  const room = rooms.get(conn.roomCode);
  if (!room) return;
  const self = findPlayer(room, conn.playerId);
  if (!self) return;
  const b0 = bytes[0]!;
  if ((b0 & RELAY_FLAG) === 0) return;
  const targetSlot = b0 & 0x7f;
  const target = room.players.find((p) => p.slot === targetSlot);
  if (!target?.ws || target === self) return;
  bytes[0] = (self.slot & 0x7f) | RELAY_FLAG;
  try {
    target.ws.send(bytes);
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------------
// HTTP: static client + health
// --------------------------------------------------------------------------

const NO_CLIENT_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>BIG FIGHT server</title>
<style>body{font-family:system-ui,sans-serif;background:#14101f;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center}h1{font-size:2.2rem}code{background:#2a2440;padding:2px 8px;border-radius:6px}</style></head>
<body><main><h1>🥊 BIG FIGHT server is up</h1>
<p>No client build deployed — run <code>node scripts/deploy-server.mjs</code> to build &amp; ship the game here.</p>
<p><a href="/healthz" style="color:#9cf">/healthz</a></p></main></body></html>`;

async function serveStatic(pathname: string): Promise<Response> {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (p.includes('..') || p.includes('\\')) return new Response('Bad request', { status: 400 });
  if (p === '/' || p === '') p = '/index.html';
  const file = Bun.file(PUBLIC_DIR + p);
  if (await file.exists()) {
    // Bun.file infers Content-Type from the extension.
    // HTML shell must NEVER be cached — it points at fingerprinted bundles, so
    // a stale shell serves stale JS (this is the "I don't see the new build"
    // trap). Vite-hashed assets under /assets/ are immutable → cache forever.
    const cache = p.endsWith('.html')
      ? 'no-cache, no-store, must-revalidate'
      : p.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
    return new Response(file, { headers: { 'cache-control': cache } });
  }
  if (pathname === '/') {
    return new Response(NO_CLIENT_PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response('Not found', { status: 404 });
}

// --------------------------------------------------------------------------
// Server
// --------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request, srv: any): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const conn: Conn = {
        helloed: false,
        buildId: '',
        playerId: crypto.randomUUID(),
        resumeToken: crypto.randomUUID(),
        roomCode: null,
        missedPongs: 0,
      };
      if (srv.upgrade(req, { data: conn })) return undefined;
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    if (url.pathname === '/healthz') {
      let players = 0;
      for (const room of rooms.values()) players += connectedPlayers(room).length;
      return Response.json({
        ok: true,
        rooms: rooms.size,
        players,
        uptime: Math.round((Date.now() - STARTED_AT) / 1000),
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws: WS) {
      sockets.add(ws);
    },
    message(ws: WS, data: string | Uint8Array) {
      if (typeof data === 'string') {
        let msg: C2S;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
        handleControl(ws, msg);
      } else {
        handleRelay(ws, data);
      }
    },
    close(ws: WS) {
      sockets.delete(ws);
      handleDisconnect(ws);
    },
    pong(ws: WS) {
      ws.data.missedPongs = 0;
    },
  },
});

// Keepalive: WS ping every 20s; close after 2 missed pongs.
setInterval(() => {
  for (const ws of sockets) {
    if (ws.data.missedPongs >= 2) {
      try {
        ws.close(4003, 'keepalive timeout');
      } catch {
        /* ignore */
      }
      continue;
    }
    ws.data.missedPongs += 1;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, KEEPALIVE_INTERVAL_MS);

// Room GC: empty 5 min → delete; absolute lifetime 6h.
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now - room.createdAt > ROOM_MAX_AGE_MS) {
      closeRoom(room, 'idle');
    } else if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      closeRoom(room, 'idle');
    }
  }
}, 60_000);

log(`BIG FIGHT server listening on :${server.port} (protocol v${PROTOCOL_VERSION})`);
