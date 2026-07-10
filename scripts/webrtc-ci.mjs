// Browser-level WebRTC gate: three real Chromium peers form a full mesh and
// exchange both unreliable game packets and reliable control packets.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4175;
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

const browser = await chromium.launch();
let failed = false;
try {
  await waitForServer();
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') console.error(message.text());
  });
  await page.goto(`http://127.0.0.1:${PORT}/bigfight/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.bigfight?.stop());
  const report = await page.evaluate(async () => {
    const { WebRtcMeshTransport } = await import('/bigfight/src/net/webrtc.ts');
    const { HybridMeshTransport } = await import('/bigfight/src/net/hybrid.ts');
    const callbacks = new Map();
    const signals = [0, 1, 2].map((slot) => ({
      sendSignal(to, data) {
        queueMicrotask(() => callbacks.get(to)?.(slot, data));
      },
      onSignal(callback) {
        callbacks.set(slot, callback);
        return () => callbacks.delete(slot);
      },
      sendRelay() {},
      onRelay() { return () => undefined; },
      relayStats() { return { rttMs: 0, jitterMs: 0, connected: false }; },
    }));
    const received = [[], [], []];
    const transports = [0, 1, 2].map((slot) => {
      const peers = [0, 1, 2].filter((candidate) => candidate !== slot);
      const transport = new WebRtcMeshTransport({
        localSlot: slot,
        peerSlots: peers,
        signaling: signals[slot],
        iceServers: [],
      });
      transport.onMessage((from, channel, data) => {
        received[slot].push({ from, channel, data: [...data] });
      });
      return transport;
    });
    const ready = await Promise.all(transports.map((transport) => transport.ready(6_000)));
    if (ready.every(Boolean)) {
      transports[0].broadcast('game', new Uint8Array([1, 7, 9]));
      transports[2].send(0, 'control', new Uint8Array([3, 4, 5]));
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    }
    const stats = transports.map((transport) => transport.peerSlots.map((slot) => transport.stats(slot)));
    for (const transport of transports) transport.close();

    // Force the direct path to stay unavailable and prove the same transport
    // API immediately routes over the relay instead.
    const relayCallbacks = new Map();
    const fallbackReceived = [[], []];
    const fallbackSignals = [0, 1].map((slot) => ({
      sendSignal() {},
      onSignal() { return () => undefined; },
      sendRelay(to, channel, data) {
        queueMicrotask(() => relayCallbacks.get(to)?.(slot, channel, data));
      },
      onRelay(callback) {
        relayCallbacks.set(slot, callback);
        return () => relayCallbacks.delete(slot);
      },
      relayStats() { return { rttMs: 26, jitterMs: 3, connected: true }; },
    }));
    const fallback = [0, 1].map((slot) => {
      const transport = new HybridMeshTransport({
        localSlot: slot,
        peerSlots: [slot === 0 ? 1 : 0],
        signaling: fallbackSignals[slot],
        iceServers: [],
      });
      transport.onMessage((from, channel, data) => fallbackReceived[slot].push({ from, channel, data: [...data] }));
      return transport;
    });
    fallback[0].send(1, 'game', new Uint8Array([8, 6]));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const fallbackStats = fallback[0].stats(1);
    for (const transport of fallback) transport.close();
    return { ready, received, stats, fallbackReceived, fallbackStats };
  });

  const peer1Game = report.received[1].some((message) => message.from === 0 && message.channel === 'game' && message.data.join(',') === '1,7,9');
  const peer2Game = report.received[2].some((message) => message.from === 0 && message.channel === 'game' && message.data.join(',') === '1,7,9');
  const peer0Control = report.received[0].some((message) => message.from === 2 && message.channel === 'control' && message.data.join(',') === '3,4,5');
  const statsReady = report.stats.flat().every((stats) => stats.connected && stats.path === 'p2p' && stats.rttMs >= 0);
  const fallbackPacket = report.fallbackReceived[1].some((message) => message.from === 0 && message.channel === 'game' && message.data.join(',') === '8,6');
  const fallbackReady = report.fallbackStats.connected && report.fallbackStats.path === 'relay';
  failed = !report.ready.every(Boolean) || !peer1Game || !peer2Game || !peer0Control || !statsReady || !fallbackPacket || !fallbackReady;
  console.log(`${failed ? 'FAIL' : 'PASS'}  3-player WebRTC mesh  ready=${report.ready.join('/')}  packets=${peer1Game}/${peer2Game}/${peer0Control}`);
  console.log(`paths=${report.stats.flat().map((stats) => `${stats.path}:${stats.rttMs.toFixed(1)}ms`).join(' ')}`);
  console.log(`${fallbackPacket && fallbackReady ? 'PASS' : 'FAIL'}  relay fallback  path=${report.fallbackStats.path}  packet=${fallbackPacket}`);
} catch (error) {
  failed = true;
  console.error('webrtc-ci error:', error);
  if (output) console.error(output);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

console.log(failed ? 'WebRTC transport: FAILED' : 'WebRTC transport: PASS');
process.exit(failed ? 1 : 0);

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/bigfight/`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not start: ${output}`);
}
