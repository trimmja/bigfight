import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocket, type RawData } from 'ws';
import {
  PROTOCOL_VERSION,
  RELAY_CHANNEL_GAME,
  decodeRelayFrame,
  encodeRelayFrame,
  type C2S,
  type S2C,
} from '../shared/protocol';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
type RoomMessage = Extract<S2C, { t: 'room' }>;
type RoomListMessage = Extract<S2C, { t: 'roomList' }>;

class TestClient {
  private readonly queued: S2C[] = [];
  private readonly binaryQueued: Uint8Array[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw: RawData, binary: boolean) => {
      if (binary) {
        this.binaryQueued.push(new Uint8Array(raw as Buffer));
        for (const wake of this.waiters) wake();
        return;
      }
      this.queued.push(JSON.parse(raw.toString()) as S2C);
      for (const wake of this.waiters) wake();
    });
  }

  send(message: C2S): void {
    this.socket.send(JSON.stringify(message));
  }

  async waitFor<T extends S2C>(predicate: (message: S2C) => message is T, timeoutMs?: number): Promise<T>;
  async waitFor(predicate: (message: S2C) => boolean, timeoutMs?: number): Promise<S2C>;
  async waitFor(predicate: (message: S2C) => boolean, timeoutMs = 2_000): Promise<S2C> {
    const queued = this.take(predicate);
    if (queued) return queued;
    return new Promise<S2C>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Timed out waiting for server message; queued: ${JSON.stringify(this.queued)}`));
      }, timeoutMs);
      const check = () => {
        const message = this.take(predicate);
        if (!message) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(message);
      };
      this.waiters.add(check);
    });
  }

  async waitForBinary(timeoutMs = 2_000): Promise<Uint8Array> {
    const queued = this.binaryQueued.shift();
    if (queued) return queued;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error('Timed out waiting for binary relay packet'));
      }, timeoutMs);
      const check = () => {
        const data = this.binaryQueued.shift();
        if (!data) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(data);
      };
      this.waiters.add(check);
    });
  }

  private take(predicate: (message: S2C) => boolean): S2C | null {
    const index = this.queued.findIndex(predicate);
    if (index < 0) return null;
    return this.queued.splice(index, 1)[0]!;
  }
}

test('real websocket clients can discover, join, and resume the same room', async (t) => {
  const launched = await launchServer();
  t.after(() => stopServer(launched.child));

  const host = await connect(launched.port, 'release-test');
  t.after(() => host.client.socket.close());
  host.client.send({ t: 'createRoom', nickname: 'Alpha', visibility: 'public', name: 'Austin Game' });
  const created = await host.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 1);
  assert.equal(created.room.name, 'Austin Game');

  const guest = await connect(launched.port, 'release-test');
  t.after(() => guest.client.socket.close());
  const listed = await guest.client.waitFor((message): message is RoomListMessage => message.t === 'roomList' && message.rooms.length === 1);
  assert.equal(listed.rooms[0]?.id, created.room.id);
  guest.client.send({ t: 'joinRoom', nickname: 'Bravo', roomId: created.room.id });
  const joined = await host.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 2);
  assert.deepEqual(joined.room.players.map((player) => player.nickname), ['Alpha', 'Bravo']);

  const resumed = await connect(launched.port, 'release-test', host.resumeToken);
  t.after(() => resumed.client.socket.close());
  assert.equal(resumed.playerId, host.playerId);
  const restored = await resumed.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 2);
  assert.equal(restored.room.players.find((player) => player.playerId === host.playerId)?.connected, true);

  // The old socket closes after the replacement is installed. A stale close
  // handler used to flip this player back to disconnected.
  resumed.client.send({ t: 'setPlayer', dance: true });
  const danced = await resumed.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.some((player) => player.playerId === host.playerId && player.danceSeq === 1));
  assert.equal(danced.room.players.find((player) => player.playerId === host.playerId)?.connected, true);

  resumed.client.send({ t: 'setPlayer', characterId: 'volt', ready: true });
  guest.client.send({ t: 'setPlayer', characterId: 'kaze', ready: true });
  await resumed.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.every((player) => player.ready));
  resumed.client.send({ t: 'startMatch' });
  await resumed.client.waitFor((message) => message.t === 'matchStart', 2_000);

  const relayFrame = encodeRelayFrame(1, RELAY_CHANNEL_GAME, new Uint8Array([9, 7, 5]));
  resumed.client.socket.send(relayFrame.slice().buffer as ArrayBuffer);
  const relayed = decodeRelayFrame(await guest.client.waitForBinary());
  assert.equal(relayed?.slot, 0);
  assert.equal(relayed?.channel, RELAY_CHANNEL_GAME);
  assert.deepEqual([...relayed!.payload], [9, 7, 5]);

  guest.client.socket.close();
  const guestRemoved = await resumed.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 1, 3_000);
  assert.equal(guestRemoved.room.hostId, host.playerId);

  const transient = await connect(launched.port, 'release-test');
  transient.client.socket.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const health = await fetch(`http://127.0.0.1:${launched.port}/healthz`).then((response) => response.json()) as { sessions: number };
  assert.equal(health.sessions, 1);
  assert.equal((await fetch(`http://127.0.0.1:${launched.port}/missing.js`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${launched.port}/%ZZ`)).status, 400);
});

test('resuming while the other player is disconnected keeps everyone informed, not stranded', async (t) => {
  const launched = await launchServer();
  t.after(() => stopServer(launched.child));

  const host = await connect(launched.port, 'release-test');
  t.after(() => host.client.socket.close());
  host.client.send({ t: 'createRoom', nickname: 'Alpha', visibility: 'public' });
  const created = await host.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 1);

  const guest = await connect(launched.port, 'release-test');
  t.after(() => guest.client.socket.close());
  guest.client.send({ t: 'joinRoom', nickname: 'Bravo', roomId: created.room.id });
  host.client.send({ t: 'setPlayer', characterId: 'volt', ready: true });
  guest.client.send({ t: 'setPlayer', characterId: 'kaze', ready: true });
  await host.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 2 && message.room.players.every((player) => player.ready));
  host.client.send({ t: 'startMatch' });
  await host.client.waitFor((message) => message.t === 'matchStart', 2_000);

  // Host opens the pause menu, then the guest's connection dies while paused.
  host.client.send({ t: 'pauseMatch' });
  await host.client.waitFor((message) => message.t === 'matchPaused' && message.reason === 'menu');
  guest.client.socket.close();
  await host.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.some((player) => !player.connected), 3_000);

  // RESUME cannot complete — the host must get a connection pause, not silence.
  host.client.send({ t: 'resumeMatch' });
  const stillPaused = await host.client.waitFor(
    (message): message is Extract<S2C, { t: 'matchPaused' }> => message.t === 'matchPaused' && message.reason === 'connection',
  );
  assert.equal(stillPaused.playerId, guest.playerId);

  // The guest reconnecting finally releases the match for both players.
  const rejoined = await connect(launched.port, 'release-test', guest.resumeToken);
  t.after(() => rejoined.client.socket.close());
  await host.client.waitFor((message) => message.t === 'matchResumed', 3_000);
});

async function connect(port: number, releaseId: string, resumeToken?: string): Promise<{
  client: TestClient;
  playerId: string;
  resumeToken: string;
}> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const client = new TestClient(socket);
  client.send({ t: 'hello', protocol: PROTOCOL_VERSION, releaseId, ...(resumeToken ? { resumeToken } : {}) });
  const welcome = await client.waitFor((message): message is Extract<S2C, { t: 'welcome' }> => message.t === 'welcome');
  return { client, playerId: welcome.playerId, resumeToken: welcome.resumeToken };
}

async function launchServer(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: '0', RECONNECT_GRACE_MS: '1000', MATCH_COUNTDOWN_MS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 5_000);
    let output = '';
    const inspect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/listening on :(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, port: Number(match[1]) });
    };
    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited before startup (${code}): ${output}`));
    });
  });
}

function stopServer(child: ChildProcess): void {
  if (child.exitCode === null) child.kill('SIGTERM');
}
