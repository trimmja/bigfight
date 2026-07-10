import type { MatchSignaling } from './MatchSignaling';
import type { NetChannel, NetTransport, PeerSlot, PeerStats } from './transport';

/** Fly-hosted fallback path used while direct WebRTC is unavailable. */
export class WsRelayTransport implements NetTransport {
  readonly localSlot: PeerSlot;
  readonly peerSlots: readonly PeerSlot[];

  private messageCallback: ((from: PeerSlot, channel: NetChannel, data: Uint8Array) => void) | null = null;
  private readonly stopRelay: () => void;

  constructor(
    localSlot: PeerSlot,
    peerSlots: readonly PeerSlot[],
    private readonly signaling: MatchSignaling,
  ) {
    this.localSlot = localSlot;
    this.peerSlots = [...peerSlots];
    this.stopRelay = signaling.onRelay((from, channel, data) => this.messageCallback?.(from, channel, data));
  }

  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    this.signaling.sendRelay(to, channel, data);
  }

  broadcast(channel: NetChannel, data: Uint8Array): void {
    for (const slot of this.peerSlots) this.send(slot, channel, data);
  }

  onMessage(callback: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): void {
    this.messageCallback = callback;
  }

  onPeerChange(_callback: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void): void {
    // Lobby room state owns relay peer presence and coordinated reconnects.
  }

  stats(_slot: PeerSlot): PeerStats {
    const stats = this.signaling.relayStats();
    return { ...stats, path: 'relay' };
  }

  close(): void {
    this.stopRelay();
    this.messageCallback = null;
  }
}
