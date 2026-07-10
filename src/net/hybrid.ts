import type { MatchSignaling } from './MatchSignaling';
import { WsRelayTransport } from './relay';
import type { NetChannel, NetTransport, PeerSlot, PeerStats } from './transport';
import { WebRtcMeshTransport } from './webrtc';

export interface HybridMeshOptions {
  localSlot: PeerSlot;
  peerSlots: readonly PeerSlot[];
  signaling: MatchSignaling;
  iceServers?: readonly RTCIceServer[];
}

/**
 * Per-peer route selector. The match works immediately over Fly relay, then
 * switches each peer to direct WebRTC as soon as both data channels open.
 * Rollback input redundancy makes the one-packet route transition harmless.
 */
export class HybridMeshTransport implements NetTransport {
  readonly localSlot: PeerSlot;
  readonly peerSlots: readonly PeerSlot[];

  private readonly direct: WebRtcMeshTransport;
  private readonly relay: WsRelayTransport;
  private messageCallback: ((from: PeerSlot, channel: NetChannel, data: Uint8Array) => void) | null = null;
  private peerCallback: ((slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void) | null = null;

  constructor(options: HybridMeshOptions) {
    this.localSlot = options.localSlot;
    this.peerSlots = [...options.peerSlots];
    this.relay = new WsRelayTransport(options.localSlot, options.peerSlots, options.signaling);
    this.direct = new WebRtcMeshTransport({
      localSlot: options.localSlot,
      peerSlots: options.peerSlots,
      signaling: options.signaling,
      ...(options.iceServers ? { iceServers: options.iceServers } : {}),
    });
    this.direct.onMessage((from, channel, data) => this.messageCallback?.(from, channel, data));
    this.relay.onMessage((from, channel, data) => this.messageCallback?.(from, channel, data));
    this.direct.onPeerChange((slot, event) => {
      if (event === 'connected') this.peerCallback?.(slot, 'connected');
      else if (!this.relay.stats(slot).connected) this.peerCallback?.(slot, event);
    });
  }

  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    const route = this.direct.stats(to).connected ? this.direct : this.relay;
    route.send(to, channel, data);
  }

  broadcast(channel: NetChannel, data: Uint8Array): void {
    for (const slot of this.peerSlots) this.send(slot, channel, data);
  }

  onMessage(callback: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): void {
    this.messageCallback = callback;
  }

  onPeerChange(callback: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void): void {
    this.peerCallback = callback;
  }

  stats(slot: PeerSlot): PeerStats {
    const direct = this.direct.stats(slot);
    return direct.connected ? direct : this.relay.stats(slot);
  }

  /** Direct is preferred but relay makes a false result playable, not fatal. */
  awaitDirect(timeoutMs = 4_000): Promise<boolean> {
    return this.direct.ready(timeoutMs);
  }

  close(): void {
    this.direct.close();
    this.relay.close();
    this.messageCallback = null;
  }
}
