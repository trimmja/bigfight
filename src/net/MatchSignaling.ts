import type { NetChannel, PeerSlot } from './transport';

/** Signaling plus the server-relay fallback shared by a match transport. */
export interface MatchSignaling {
  sendSignal(to: PeerSlot, data: unknown): void;
  onSignal(callback: (from: PeerSlot, data: unknown) => void): () => void;
  sendRelay(to: PeerSlot, channel: NetChannel, data: Uint8Array): void;
  onRelay(callback: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): () => void;
  relayStats(): { rttMs: number; jitterMs: number; connected: boolean };
}
