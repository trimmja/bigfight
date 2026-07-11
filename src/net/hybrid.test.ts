import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridMeshTransport } from './hybrid';
import type { NetChannel, NetTransport, PeerSlot, PeerStats } from './transport';

/**
 * Route hysteresis unit test: drives the hybrid selector with fake transports
 * and a fake clock through the transitions the browser gate can't force —
 * relay→direct promotion, overlap mirroring, silent direct failure, demotion,
 * flapping, and always-dual-route control traffic.
 */

class FakeTransport implements NetTransport {
  readonly sent: { to: PeerSlot; channel: NetChannel }[] = [];
  readonly up = new Map<PeerSlot, boolean>();
  private peerCb: ((slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void) | null = null;

  constructor(
    readonly localSlot: PeerSlot,
    readonly peerSlots: readonly PeerSlot[],
    private readonly path: PeerStats['path'],
  ) {}

  send(to: PeerSlot, channel: NetChannel, _data: Uint8Array): void {
    this.sent.push({ to, channel });
  }

  broadcast(channel: NetChannel, data: Uint8Array): void {
    for (const slot of this.peerSlots) this.send(slot, channel, data);
  }

  onMessage(_cb: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): void {}

  onPeerChange(cb: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void): void {
    this.peerCb = cb;
  }

  firePeer(slot: PeerSlot, event: 'connected' | 'lost' | 'left'): void {
    this.up.set(slot, event === 'connected');
    this.peerCb?.(slot, event);
  }

  stats(slot: PeerSlot): PeerStats {
    return { rttMs: 20, jitterMs: 1, path: this.path, connected: this.up.get(slot) ?? false };
  }

  ready(): Promise<boolean> {
    return Promise.resolve(true);
  }

  close(): void {}
}

function createHybrid() {
  let now = 0;
  const direct = new FakeTransport(0, [1], 'p2p');
  const relay = new FakeTransport(0, [1], 'relay');
  relay.up.set(1, true); // the relay websocket is always connected
  const hybrid = new HybridMeshTransport({
    localSlot: 0,
    peerSlots: [1],
    transports: { direct, relay },
    now: () => now,
  });
  const setNow = (ms: number) => {
    now = ms;
  };
  const send = (channel: NetChannel = 'game') => {
    direct.sent.length = 0;
    relay.sent.length = 0;
    hybrid.send(1, channel, new Uint8Array([1]));
    return { direct: direct.sent.length, relay: relay.sent.length };
  };
  return { hybrid, direct, relay, setNow, send };
}

test('game packets start on relay and promote to direct only after 1.5s of stability', () => {
  const { hybrid, direct, setNow, send } = createHybrid();

  assert.deepEqual(send(), { direct: 0, relay: 1 }, 'fresh hybrid must route via relay');
  assert.equal(hybrid.stats(1).path, 'relay');

  setNow(100);
  direct.firePeer(1, 'connected');
  setNow(1_000); // only 0.9s of stability — still probation
  assert.deepEqual(send(), { direct: 0, relay: 1 }, 'probation must stay on relay');

  setNow(1_700); // stable past the threshold — promoted, overlap mirrors relay
  assert.deepEqual(send(), { direct: 1, relay: 1 }, 'switch overlap must mirror both routes');
  assert.equal(hybrid.stats(1).path, 'p2p');

  setNow(2_800); // overlap window over
  assert.deepEqual(send(), { direct: 1, relay: 0 }, 'settled direct must not spend relay bandwidth');
});

test('direct loss demotes instantly and reconnection restarts the stability clock', () => {
  const { hybrid, direct, setNow, send } = createHybrid();
  setNow(100);
  direct.firePeer(1, 'connected');
  setNow(2_000);
  send(); // promoted
  setNow(3_100); // past overlap

  // Silent-failure surface: the moment stats stop reporting connected, every
  // packet goes to relay — no event required, no stability period on the way DOWN.
  direct.up.set(1, false);
  assert.deepEqual(send(), { direct: 0, relay: 1 }, 'demotion must be immediate');
  assert.equal(hybrid.stats(1).path, 'relay');

  // Flap: reconnect must re-earn the full stability window.
  setNow(3_200);
  direct.firePeer(1, 'connected');
  setNow(4_400); // 1.2s since reconnect
  assert.deepEqual(send(), { direct: 0, relay: 1 }, 'flapping direct must not be trusted early');
  setNow(4_800); // 1.6s since reconnect
  assert.equal(send().direct, 1, 'a stable reconnect eventually promotes again');
});

test('control traffic always rides both routes so repair survives a silently dead direct path', () => {
  const { direct, setNow, send } = createHybrid();
  setNow(100);
  direct.firePeer(1, 'connected');
  setNow(5_000);
  send(); // promoted (switch happens on this send)
  setNow(6_100); // past the switch overlap window

  assert.deepEqual(send('control'), { direct: 1, relay: 1 }, 'control must mirror to relay while on direct');

  direct.up.set(1, false);
  assert.deepEqual(send('control'), { direct: 0, relay: 1 }, 'control falls back to relay alone when direct is down');
});
