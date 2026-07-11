import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  PROTOCOL_VERSION,
  RELAY_CHANNEL_CONTROL,
  RELAY_CHANNEL_GAME,
  RELAY_FLAG,
  type C2S,
  type RoomState,
  type S2C,
} from '../shared/protocol';
import { RoomDirectory, RoomError } from './rooms';

const PORT = envNumber('PORT', 8080, 0);
const RECONNECT_GRACE_MS = envNumber('RECONNECT_GRACE_MS', 30_000, 1_000);
const MATCH_COUNTDOWN_MS = envNumber('MATCH_COUNTDOWN_MS', 3_000, 1);
const MAX_CONTROL_BYTES = 32 * 1024;
const PUBLIC_DIR = fileURLToPath(new URL('../dist/', import.meta.url));

interface Connection {
  socket: WebSocket;
  helloed: boolean;
  playerId: string;
  resumeToken: string;
  releaseId: string;
  removalTimer: ReturnType<typeof setTimeout> | null;
}

interface SessionRecord {
  playerId: string;
  resumeToken: string;
  releaseId: string;
  expiresAt: number;
  removalTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new RoomDirectory();
const connections = new Set<Connection>();
const connectionByPlayer = new Map<string, Connection>();
const sessionsByToken = new Map<string, SessionRecord>();
const countdownTimers = new Map<string, ReturnType<typeof setTimeout>>();

const server = createServer(handleHttp);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

wss.on('connection', (socket) => {
  const connection: Connection = {
    socket,
    helloed: false,
    playerId: '',
    resumeToken: '',
    releaseId: '',
    removalTimer: null,
  };
  connections.add(connection);

  socket.on('message', (data, isBinary) => {
    if (isBinary) handleRelay(connection, data);
    else handleControl(connection, data);
  });
  socket.on('close', () => handleClose(connection));
  socket.on('error', () => undefined);
});

server.listen(PORT, '0.0.0.0', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`BIG FIGHT server listening on :${port}`);
});

function handleControl(connection: Connection, raw: RawData): void {
  const text = raw.toString();
  if (text.length > MAX_CONTROL_BYTES) {
    connection.socket.close(1009, 'control message too large');
    return;
  }
  let message: C2S;
  try {
    message = JSON.parse(text) as C2S;
  } catch {
    return;
  }

  if (!connection.helloed) {
    if (message.t !== 'hello') return;
    handleHello(connection, message);
    return;
  }

  try {
    switch (message.t) {
      case 'hello':
        return;
      case 'listRooms':
        send(connection, { t: 'roomList', rooms: rooms.listPublic(connection.releaseId) });
        return;
      case 'createRoom': {
        const room = rooms.create({
          playerId: connection.playerId,
          releaseId: connection.releaseId,
          nickname: message.nickname,
          visibility: message.visibility,
          ...(message.name !== undefined ? { name: message.name } : {}),
        });
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'joinRoom': {
        const room = rooms.join({
          playerId: connection.playerId,
          releaseId: connection.releaseId,
          nickname: message.nickname,
          ...(message.roomId !== undefined ? { roomId: message.roomId } : {}),
          ...(message.code !== undefined ? { code: message.code } : {}),
        });
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'leaveRoom':
        leaveRoom(connection.playerId);
        return;
      case 'setPlayer': {
        const room = rooms.setPlayer(connection.playerId, message);
        syncCountdown(room);
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'setSettings': {
        const room = rooms.setSettings(connection.playerId, message.settings);
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'startMatch': {
        const room = rooms.startCountdown(connection.playerId, MATCH_COUNTDOWN_MS);
        publishRoom(room);
        publishToRoom(room, { t: 'countdown', endsAt: room.countdownEndsAt! });
        syncCountdown(room);
        publishRoomLists();
        return;
      }
      case 'cancelCountdown': {
        const room = rooms.cancelCountdown(connection.playerId);
        syncCountdown(room);
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'pauseMatch': {
        const room = rooms.pauseMatch(connection.playerId);
        publishRoom(room);
        publishToRoom(room, {
          t: 'matchPaused',
          playerId: connection.playerId,
          pausedAt: room.pauseStartedAt!,
          reason: 'menu',
        });
        return;
      }
      case 'resumeMatch': {
        const { room, resumed } = rooms.resumeMatch(connection.playerId);
        publishRoom(room);
        if (resumed) publishToRoom(room, { t: 'matchResumed', ...resumed });
        return;
      }
      case 'forfeitMatch': {
        const room = rooms.forfeitMatch(connection.playerId);
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'finishMatch': {
        const room = rooms.finishMatch(connection.playerId, message.matchId, message.result);
        publishRoom(room);
        return;
      }
      case 'returnToLobby': {
        const room = rooms.returnToLobby(connection.playerId);
        publishRoom(room);
        publishRoomLists();
        return;
      }
      case 'signal':
        relaySignal(connection, message.to, message.data);
        return;
      case 'ping':
        send(connection, { t: 'pong', clientTs: message.clientTs, serverTs: Date.now() });
        return;
    }
  } catch (error) {
    if (error instanceof RoomError) {
      if (message.t === 'joinRoom' || message.t === 'createRoom') {
        const reason = toJoinFailure(error.code);
        send(connection, { t: 'joinFailed', reason });
      } else if (message.t === 'setPlayer') {
        const room = rooms.roomForPlayer(connection.playerId);
        if (room) send(connection, { t: 'room', room });
      }
      return;
    }
    console.error(error);
  }
}

function handleHello(connection: Connection, message: Extract<C2S, { t: 'hello' }>): void {
  if (message.protocol !== PROTOCOL_VERSION) {
    send(connection, { t: 'protocolMismatch', expected: PROTOCOL_VERSION });
    connection.socket.close(4000, 'protocol mismatch');
    return;
  }
  const resumed = message.resumeToken ? sessionsByToken.get(message.resumeToken) : undefined;
  let matchResumed: { pausedAt: number; resumedAt: number } | null = null;
  if (resumed && resumed.expiresAt >= Date.now() && resumed.releaseId === message.releaseId) {
    const old = connectionByPlayer.get(resumed.playerId);
    old?.socket.close(4001, 'resumed elsewhere');
    if (resumed.removalTimer) clearTimeout(resumed.removalTimer);
    connection.playerId = resumed.playerId;
    connection.resumeToken = resumed.resumeToken;
    connection.releaseId = resumed.releaseId;
    connection.removalTimer = null;
    const before = rooms.roomForPlayer(connection.playerId);
    if (before) {
      const after = rooms.setConnected(connection.playerId, true);
      if (before.phase === 'paused' && before.pauseStartedAt !== null && after.phase === 'match') {
        matchResumed = { pausedAt: before.pauseStartedAt, resumedAt: Date.now() };
      }
    }
  } else {
    connection.playerId = crypto.randomUUID();
    connection.resumeToken = crypto.randomUUID();
    connection.releaseId = cleanReleaseId(message.releaseId);
  }
  connection.helloed = true;
  connectionByPlayer.set(connection.playerId, connection);
  sessionsByToken.set(connection.resumeToken, {
    playerId: connection.playerId,
    resumeToken: connection.resumeToken,
    releaseId: connection.releaseId,
    expiresAt: Number.POSITIVE_INFINITY,
    removalTimer: null,
  });
  send(connection, { t: 'welcome', playerId: connection.playerId, resumeToken: connection.resumeToken });
  const room = rooms.roomForPlayer(connection.playerId);
  if (room) {
    publishRoom(room);
    if (matchResumed) publishToRoom(room, { t: 'matchResumed', ...matchResumed });
  }
  send(connection, { t: 'roomList', rooms: rooms.listPublic(connection.releaseId) });
}

function handleRelay(connection: Connection, raw: RawData): void {
  if (!connection.helloed) return;
  const frame = rawDataToUint8Array(raw);
  if (frame.length < 2 || (frame[0]! & RELAY_FLAG) === 0) return;
  if (frame[1] !== RELAY_CHANNEL_GAME && frame[1] !== RELAY_CHANNEL_CONTROL) return;
  const room = rooms.roomForPlayer(connection.playerId);
  if (!room || (room.phase !== 'match' && room.phase !== 'paused')) return;
  const sender = room.players.find((player) => player.playerId === connection.playerId);
  const targetSlot = frame[0]! & 0x7f;
  const target = room.players.find((player) => player.slot === targetSlot);
  if (!sender || !target || target.playerId === sender.playerId) return;
  const targetConnection = connectionByPlayer.get(target.playerId);
  if (!targetConnection || targetConnection.socket.readyState !== WebSocket.OPEN) return;
  const forwarded = new Uint8Array(frame);
  forwarded[0] = (sender.slot & 0x7f) | RELAY_FLAG;
  targetConnection.socket.send(forwarded);
}

function relaySignal(connection: Connection, targetPlayerId: string, data: unknown): void {
  const room = rooms.roomForPlayer(connection.playerId);
  if (!room || !room.players.some((player) => player.playerId === targetPlayerId)) return;
  const target = connectionByPlayer.get(targetPlayerId);
  if (target) send(target, { t: 'signal', from: connection.playerId, data });
}

function handleClose(connection: Connection): void {
  connections.delete(connection);
  if (!connection.helloed) return;
  // A resume closes the stale socket after the new one owns this player. Its
  // delayed close event must not mark the newly resumed player disconnected.
  if (connectionByPlayer.get(connection.playerId) !== connection) return;
  connectionByPlayer.delete(connection.playerId);
  const room = rooms.roomForPlayer(connection.playerId);
  const session = sessionsByToken.get(connection.resumeToken);
  if (!session) return;
  if (!room) {
    sessionsByToken.delete(connection.resumeToken);
    return;
  }
  const updated = rooms.setConnected(connection.playerId, false);
  publishRoom(updated);
  if (room.phase === 'match' && updated.pauseStartedAt !== null) {
    publishToRoom(updated, {
      t: 'matchPaused',
      playerId: connection.playerId,
      pausedAt: updated.pauseStartedAt,
      reason: 'connection',
    });
  }
  publishRoomLists();
  session.expiresAt = Date.now() + RECONNECT_GRACE_MS;
  session.removalTimer = setTimeout(() => {
    session.removalTimer = null;
    sessionsByToken.delete(session.resumeToken);
    const current = rooms.roomForPlayer(session.playerId);
    if (!current) return;
    const after = rooms.removePlayer(session.playerId);
    if (after) publishRoom(after);
    publishRoomLists();
  }, RECONNECT_GRACE_MS);
  connection.removalTimer = session.removalTimer;
}

function leaveRoom(playerId: string): void {
  const before = rooms.roomForPlayer(playerId);
  if (!before) return;
  const after = rooms.removePlayer(playerId);
  clearCountdown(before.id);
  if (after) publishRoom(after);
  publishRoomLists();
}

function syncCountdown(room: RoomState): void {
  clearCountdown(room.id);
  if (room.phase !== 'countdown' || room.countdownEndsAt === null) return;
  const delay = Math.max(0, room.countdownEndsAt - Date.now());
  countdownTimers.set(room.id, setTimeout(() => {
    countdownTimers.delete(room.id);
    try {
      const match = rooms.beginMatch(room.id);
      const updated = rooms.get(room.id);
      if (!updated) return;
      publishToRoom(updated, { t: 'matchStart', match });
      publishRoom(updated);
      publishRoomLists();
    } catch {
      const updated = rooms.get(room.id);
      if (updated) publishRoom(updated);
      publishRoomLists();
    }
  }, delay));
}

function clearCountdown(roomId: string): void {
  const timer = countdownTimers.get(roomId);
  if (timer) clearTimeout(timer);
  countdownTimers.delete(roomId);
}

function publishRoom(room: RoomState): void {
  publishToRoom(room, { t: 'room', room });
}

function publishToRoom(room: RoomState, message: S2C): void {
  for (const player of room.players) {
    const connection = connectionByPlayer.get(player.playerId);
    if (connection) send(connection, message);
  }
}

function publishRoomLists(): void {
  for (const connection of connections) {
    if (connection.helloed) send(connection, { t: 'roomList', rooms: rooms.listPublic(connection.releaseId) });
  }
}

function send(connection: Connection, message: S2C): void {
  if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify(message));
}

function toJoinFailure(code: RoomError['code']): 'notFound' | 'full' | 'inProgress' | 'releaseMismatch' | 'alreadyInRoom' {
  if (code === 'full' || code === 'inProgress' || code === 'releaseMismatch' || code === 'alreadyInRoom') return code;
  return 'notFound';
}

function cleanReleaseId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'unknown';
}

function rawDataToUint8Array(raw: RawData): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) {
    const length = raw.reduce((sum, item) => sum + item.byteLength, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const item of raw) {
      out.set(item, offset);
      offset += item.byteLength;
    }
    return out;
  }
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

function handleHttp(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/healthz') {
    writeJson(response, 200, {
      ok: true,
      publicRooms: rooms.listPublic().length,
      connections: connections.size,
      sessions: sessionsByToken.size,
    });
    return;
  }
  if (url.pathname === '/api/rooms') {
    writeJson(response, 200, { rooms: rooms.listPublic(url.searchParams.get('release') ?? undefined) });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  serveStatic(url.pathname, request.method === 'HEAD', response);
}

function serveStatic(pathname: string, headOnly: boolean, response: ServerResponse): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  let relative = normalize(decoded).replace(/^\/+/, '');
  // The old GitHub Pages build uses /bigfight/ while the canonical Fly domain
  // builds for /. Serving both makes cached clients and local builds recover.
  if (relative === 'bigfight') relative = '';
  else if (relative.startsWith('bigfight/')) relative = relative.slice('bigfight/'.length);
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  let file = join(PUBLIC_DIR, relative);
  const invalidPath = !file.startsWith(PUBLIC_DIR);
  const missing = invalidPath || !existsSync(file) || !statSync(file).isFile();
  if (missing && extname(relative)) {
    response.writeHead(404).end();
    return;
  }
  if (missing) file = join(PUBLIC_DIR, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Client build not staged');
    return;
  }
  const contentType = MIME[extname(file)] ?? 'application/octet-stream';
  const cache = file.endsWith('index.html') ? 'no-cache, no-store, must-revalidate' : file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  response.writeHead(200, { 'content-type': contentType, 'cache-control': cache });
  if (headOnly) response.end();
  else createReadStream(file).pipe(response);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function envNumber(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}
