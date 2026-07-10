/**
 * Match transport abstraction. Implementations: LoopbackTransport (in-page
 * testing — below), WebRtcMeshTransport + WsRelayTransport (net/webrtc.ts,
 * net/relay.ts). RollbackSession never knows which is underneath — that's
 * also the expansion path past 4 players (star topology behind the same API).
 */

export type PeerSlot = 0 | 1 | 2 | 3;
/** game = unreliable/unordered (inputs); control = reliable (resync, meta). */
export type NetChannel = 'game' | 'control';

export interface PeerStats {
  rttMs: number;
  jitterMs: number;
  path: 'p2p' | 'relay' | 'local';
  connected: boolean;
}

export interface NetTransport {
  readonly localSlot: PeerSlot;
  /** Remote slots this transport talks to. */
  readonly peerSlots: readonly PeerSlot[];
  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void;
  broadcast(channel: NetChannel, data: Uint8Array): void;
  onMessage(cb: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): void;
  onPeerChange(cb: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void): void;
  stats(slot: PeerSlot): PeerStats;
  close(): void;
}

type Message = { from: PeerSlot; channel: NetChannel; data: Uint8Array };

/**
 * In-page transport with synthetic network conditions — the M1 workhorse and
 * the rollback golden-test harness. Create one hub, take one endpoint per
 * simulated peer. Delivery is deterministic given a seeded jitter source is
 * NOT required — loss/jitter only shape WHEN inputs arrive, never the sim
 * (rollback must converge to identical state regardless; that's the test).
 */
export class LoopbackHub {
  private readonly endpoints: LoopbackEndpoint[] = [];
  /** One-way delay ms; jitter adds 0..jitterMs; loss drops game-channel packets. */
  delayMs = 0;
  jitterMs = 0;
  lossRate = 0;
  private now = 0;
  private readonly queue: { at: number; to: PeerSlot; msg: Message }[] = [];

  endpoint(slot: PeerSlot): LoopbackEndpoint {
    const ep = new LoopbackEndpoint(this, slot);
    this.endpoints.push(ep);
    return ep;
  }

  /** Advance simulated time and deliver due packets (call per sim frame). */
  pump(dtMs: number): void {
    this.now += dtMs;
    // Deliver everything due, in send order per destination.
    for (let i = 0; i < this.queue.length; ) {
      const item = this.queue[i]!;
      if (item.at <= this.now) {
        this.queue.splice(i, 1);
        const target = this.endpoints.find((e) => e.localSlot === item.to);
        target?.deliver(item.msg);
      } else {
        i += 1;
      }
    }
  }

  post(from: PeerSlot, to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    if (channel === 'game' && this.lossRate > 0 && Math.random() < this.lossRate) return; // det-ok: transport-only randomness (sim must converge regardless)
    const jitter = this.jitterMs > 0 ? Math.random() * this.jitterMs : 0; // det-ok: transport-only randomness
    // Reliable channel: no loss and never reordered (deliver after max in-flight).
    const at = this.now + this.delayMs + (channel === 'game' ? jitter : this.jitterMs);
    this.queue.push({ at, to, msg: { from, channel, data } });
  }
}

export class LoopbackEndpoint implements NetTransport {
  private messageCb: ((from: PeerSlot, channel: NetChannel, data: Uint8Array) => void) | null = null;

  constructor(
    private readonly hub: LoopbackHub,
    readonly localSlot: PeerSlot,
  ) {}

  get peerSlots(): readonly PeerSlot[] {
    const slots: PeerSlot[] = [];
    for (const slot of [0, 1, 2, 3] as const) {
      if (slot !== this.localSlot) slots.push(slot);
    }
    return slots;
  }

  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    this.hub.post(this.localSlot, to, channel, data);
  }

  broadcast(channel: NetChannel, data: Uint8Array): void {
    for (const slot of this.peerSlots) this.send(slot, channel, data);
  }

  onMessage(cb: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): void {
    this.messageCb = cb;
  }

  onPeerChange(_cb: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void): void {
    // Loopback peers never drop.
  }

  deliver(msg: Message): void {
    this.messageCb?.(msg.from, msg.channel, msg.data);
  }

  stats(_slot: PeerSlot): PeerStats {
    return { rttMs: this.hub.delayMs * 2, jitterMs: this.hub.jitterMs, path: 'local', connected: true };
  }

  close(): void {
    this.messageCb = null;
  }
}
