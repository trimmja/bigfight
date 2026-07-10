import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocket, type RawData } from 'ws';
import { PROTOCOL_VERSION, type C2S, type S2C } from '../shared/protocol';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
type RoomMessage = Extract<S2C, { t: 'room' }>;
type RoomListMessage = Extract<S2C, { t: 'roomList' }>;

class TestClient {
  private readonly queued: S2C[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw: RawData, binary: boolean) => {
      if (binary) return;
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

  guest.client.socket.close();
  const guestRemoved = await resumed.client.waitFor((message): message is RoomMessage => message.t === 'room' && message.room.players.length === 1, 2_000);
  assert.equal(guestRemoved.room.hostId, host.playerId);
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
    env: { ...process.env, PORT: '0', RECONNECT_GRACE_MS: '100' },
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
