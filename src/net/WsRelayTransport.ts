import {
  decodeRelayFrame,
  encodeRelayFrame,
  RELAY_CHANNEL_CONTROL,
  RELAY_CHANNEL_GAME,
} from '../../shared/protocol';
import type { LobbyClient } from './LobbyClient';
import type { NetChannel, NetTransport, PeerSlot, PeerStats } from './transport';

/**
 * Match transport over the Fly server's binary WS relay — the guaranteed-
 * connectivity path (works through ANY NAT; one extra hop through the server
 * region). WebRTC mesh upgrades on top of the same interface later; the
 * rollback session can't tell the difference.
 *
 * Slot translation: the rollback session uses COMPACT indices (0..n-1 in
 * server-slot order); the server relay routes by SERVER slot. This adapter
 * translates both ways.
 */
export class WsRelayTransport implements NetTransport {
  private messageCb: ((from: PeerSlot, channel: NetChannel, data: Uint8Array) => void) | null = null;
  private peerChangeCb: ((slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void) | null = null;
  private readonly unsubs: (() => void)[] = [];
  /** compact index → server slot */
  private readonly serverSlots: number[];
  /** server slot → compact index */
  private readonly indexByServerSlot = new Map<number, number>();

  constructor(
    private readonly client: LobbyClient,
    readonly localSlot: PeerSlot,
    serverSlotOrder: readonly number[],
  ) {
    this.serverSlots = [...serverSlotOrder];
    for (let i = 0; i < this.serverSlots.length; i += 1) {
      this.indexByServerSlot.set(this.serverSlots[i]!, i);
    }

    this.unsubs.push(
      client.onRelayFrame((bytes) => {
        const decoded = decodeRelayFrame(bytes);
        if (!decoded) return;
        const fromIndex = this.indexByServerSlot.get(decoded.slot);
        if (fromIndex === undefined || fromIndex === this.localSlot) return;
        const channel: NetChannel = decoded.channel === RELAY_CHANNEL_CONTROL ? 'control' : 'game';
        this.messageCb?.(fromIndex as PeerSlot, channel, decoded.payload);
      }),
      client.on('room', (room) => {
        // Surface disconnects for the in-match UX layer.
        for (const player of room.players) {
          const index = this.indexByServerSlot.get(player.slot);
          if (index === undefined || index === this.localSlot) continue;
          if (!player.connected) this.peerChangeCb?.(index as PeerSlot, 'lost');
        }
      }),
    );
  }

  get peerSlots(): readonly PeerSlot[] {
    const slots: PeerSlot[] = [];
    for (let i = 0; i < this.serverSlots.length; i += 1) {
      if (i !== this.localSlot) slots.push(i as PeerSlot);
    }
    return slots;
  }

  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    const serverSlot = this.serverSlots[to];
    if (serverSlot === undefined) return;
    const relayChannel = channel === 'control' ? RELAY_CHANNEL_CONTROL : RELAY_CHANNEL_GAME;
    this.client.sendRelayFrame(encodeRelayFrame(serverSlot, relayChannel, data));
  }

  broadcast(channel: NetChannel, data: Uint8Array): void {
    for (const slot of this.peerSlots) this.send(slot, channel, data);
  }

  onMessage(cb: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): void {
    this.messageCb = cb;
  }

  onPeerChange(cb: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void): void {
    this.peerChangeCb = cb;
  }

  stats(_slot: PeerSlot): PeerStats {
    return {
      rttMs: this.client.rttMs ?? 0,
      jitterMs: 0,
      path: 'relay',
      connected: this.client.isConnected,
    };
  }

  close(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
    this.messageCb = null;
    this.peerChangeCb = null;
    // The LobbyClient survives — the room lives on for rematch/results.
  }
}
