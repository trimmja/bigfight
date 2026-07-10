// Browser/server integration gate for the real LobbySocket, including resume.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const VITE_PORT = 4176;
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const backend = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
  env: { ...process.env, PORT: '0', RECONNECT_GRACE_MS: '2000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let viteOutput = '';
let backendOutput = '';
vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString(); });
vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString(); });
backend.stdout.on('data', (chunk) => { backendOutput += chunk.toString(); });
backend.stderr.on('data', (chunk) => { backendOutput += chunk.toString(); });

const browser = await chromium.launch();
let failed = false;
try {
  const backendPort = await waitForBackend();
  await waitForVite();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${VITE_PORT}/bigfight/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.bigfight?.stop());
  const report = await page.evaluate(async (socketUrl) => {
    const { LobbySocket } = await import('/bigfight/src/net/LobbySocket.ts');
    const states = [];
    const messages = [];
    const client = new LobbySocket({ url: socketUrl, releaseId: 'lobby-browser-ci', reconnectLimitMs: 1_800 });
    client.onStatus((state) => states.push(state));
    client.subscribe((message) => messages.push(message));
    client.connect();
    await waitUntil(() => client.state === 'connected' && Boolean(client.playerId));
    const firstPlayerId = client.playerId;
    client.send({ t: 'createRoom', nickname: 'Browser', visibility: 'public', name: 'Resume Test' });
    await waitUntil(() => messages.some((message) => message.t === 'room' && message.room.name === 'Resume Test'));
    client.socket.close(4010, 'test reconnect');
    await waitUntil(() => states.includes('reconnecting'));
    await waitUntil(() => client.state === 'connected' && messages.filter((message) => message.t === 'welcome').length >= 2);
    await waitUntil(() => messages.filter((message) => message.t === 'room' && message.room.name === 'Resume Test').length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const report = {
      samePlayer: client.playerId === firstPlayerId,
      roomRestored: messages.some((message) => message.t === 'room' && message.room.name === 'Resume Test' && message.room.players[0]?.connected),
      states,
      relay: client.relayStats(),
      clockDeltaMs: Math.abs(client.serverNow() - Date.now()),
    };
    client.close();
    return report;

    async function waitUntil(predicate) {
      const deadline = performance.now() + 4_000;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error(`Timed out; states=${states.join(',')} messages=${messages.map((message) => message.t).join(',')}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  }, `ws://127.0.0.1:${backendPort}/ws`);

  failed = !report.samePlayer || !report.roomRestored || !report.states.includes('reconnecting') || !report.relay.connected || report.clockDeltaMs > 2_000;
  console.log(`${failed ? 'FAIL' : 'PASS'}  browser lobby resume  samePlayer=${report.samePlayer} room=${report.roomRestored}`);
  console.log(`states=${report.states.join(' > ')} relay=${report.relay.rttMs.toFixed(1)}ms clockDelta=${report.clockDeltaMs.toFixed(1)}ms`);
} catch (error) {
  failed = true;
  console.error('lobby-client-ci error:', error);
  if (viteOutput) console.error(viteOutput);
  if (backendOutput) console.error(backendOutput);
} finally {
  await browser.close();
  vite.kill('SIGTERM');
  backend.kill('SIGTERM');
}

console.log(failed ? 'Lobby browser client: FAILED' : 'Lobby browser client: PASS');
process.exit(failed ? 1 : 0);

async function waitForBackend() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const match = backendOutput.match(/listening on :(\d+)/);
    if (match) return Number(match[1]);
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${backendOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Backend did not start: ${backendOutput}`);
}

async function waitForVite() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${VITE_PORT}/bigfight/`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Vite did not start: ${viteOutput}`);
}
