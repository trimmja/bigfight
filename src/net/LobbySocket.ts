import {
  PROTOCOL_VERSION,
  RELAY_CHANNEL_CONTROL,
  RELAY_CHANNEL_GAME,
  decodeRelayFrame,
  encodeRelayFrame,
  type C2S,
  type S2C,
} from '../../shared/protocol';
import type { MatchSignaling } from './MatchSignaling';
import type { NetChannel, PeerSlot } from './transport';

export type LobbyConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'incompatible';

export interface LobbySocketOptions {
  url?: string;
  releaseId?: string;
  reconnectLimitMs?: number;
}

/**
 * Persistent browser connection for room state, WebRTC signaling, and the
 * fallback relay. A resume token keeps the same player slot across brief Wi-Fi
 * drops and page reloads; room state remains authoritative on the server.
 */
export class LobbySocket implements MatchSignaling {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly releaseId: string;
  private readonly reconnectLimitMs: number;
  private readonly eventListeners = new Set<(message: S2C) => void>();
  private readonly signalListeners = new Set<(from: PeerSlot, data: unknown) => void>();
  private readonly relayListeners = new Set<(from: PeerSlot, channel: NetChannel, data: Uint8Array) => void>();
  private readonly statusListeners = new Set<(state: LobbyConnectionState) => void>();
  private readonly queued: C2S[] = [];
  private stopped = false;
  private welcomed = false;
  private reconnectStartedAt = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingPings = new Map<number, { performanceAt: number; wallAt: number }>();
  private pingSequence = 0;
  private measuredRttMs = 0;
  private measuredJitterMs = 0;
  private measuredServerOffsetMs = 0;
  private hasServerOffset = false;

  playerId = '';
  resumeToken = '';
  state: LobbyConnectionState = 'closed';

  constructor(options: LobbySocketOptions = {}) {
    this.url = options.url ?? defaultSocketUrl();
    this.releaseId = cleanReleaseId(options.releaseId ?? __BUILD_ID__);
    this.reconnectLimitMs = options.reconnectLimitMs ?? 28_000;
    this.resumeToken = readResumeToken(this.releaseId);
  }

  connect(): void {
    if (this.socket || this.stopped) return;
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        releaseId: this.releaseId,
        ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
      } satisfies C2S));
    });
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('close', () => this.handleClose(socket));
    socket.addEventListener('error', () => undefined);
  }

  send(message: C2S): void {
    if (message.t === 'hello') return;
    if (this.welcomed && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    if (this.queued.length >= 32) this.queued.shift();
    this.queued.push(message);
  }

  subscribe(callback: (message: S2C) => void): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  onStatus(callback: (state: LobbyConnectionState) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.state);
    return () => this.statusListeners.delete(callback);
  }

  sendSignal(to: PeerSlot, data: unknown): void {
    this.send({ t: 'signal', to: this.playerIdForSlot(to), data });
  }

  onSignal(callback: (from: PeerSlot, data: unknown) => void): () => void {
    this.signalListeners.add(callback);
    return () => this.signalListeners.delete(callback);
  }

  sendRelay(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    if (!this.welcomed || this.socket?.readyState !== WebSocket.OPEN) return;
    const channelId = channel === 'game' ? RELAY_CHANNEL_GAME : RELAY_CHANNEL_CONTROL;
    const frame = encodeRelayFrame(to, channelId, data);
    this.socket.send(frame.slice().buffer as ArrayBuffer);
  }

  onRelay(callback: (from: PeerSlot, channel: NetChannel, data: Uint8Array) => void): () => void {
    this.relayListeners.add(callback);
    return () => this.relayListeners.delete(callback);
  }

  relayStats(): { rttMs: number; jitterMs: number; connected: boolean } {
    return {
      rttMs: this.measuredRttMs,
      jitterMs: this.measuredJitterMs,
      connected: this.welcomed && this.socket?.readyState === WebSocket.OPEN,
    };
  }

  /** Wall clock corrected from midpoint samples against the room server. */
  serverNow(): number {
    return Date.now() + (this.hasServerOffset ? this.measuredServerOffsetMs : 0);
  }

  /** Slot-to-player mapping is installed from the authoritative room state. */
  setMatchPlayers(players: readonly { slot: number; playerId: string }[]): void {
    this.playerIdBySlot.clear();
    this.slotByPlayerId.clear();
    for (const player of players) {
      if (!isPeerSlot(player.slot)) continue;
      this.playerIdBySlot.set(player.slot, player.playerId);
      this.slotByPlayerId.set(player.playerId, player.slot);
    }
  }

  close(): void {
    this.stopped = true;
    this.welcomed = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.socket?.close(1000, 'client closed');
    this.socket = null;
    this.setState('closed');
  }

  private readonly playerIdBySlot = new Map<PeerSlot, string>();
  private readonly slotByPlayerId = new Map<string, PeerSlot>();

  private playerIdForSlot(slot: PeerSlot): string {
    return this.playerIdBySlot.get(slot) ?? '';
  }

  private handleMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const decoded = decodeRelayFrame(new Uint8Array(data));
      if (!decoded) return;
      const channel = decoded.channel === RELAY_CHANNEL_GAME ? 'game' : 'control';
      for (const callback of this.relayListeners) callback(decoded.slot as PeerSlot, channel, decoded.payload);
      return;
    }
    if (typeof data !== 'string') return;
    let message: S2C;
    try {
      message = JSON.parse(data) as S2C;
    } catch {
      return;
    }
    if (message.t === 'welcome') {
      this.playerId = message.playerId;
      this.resumeToken = message.resumeToken;
      writeResumeToken(this.releaseId, message.resumeToken);
      this.welcomed = true;
      this.reconnectAttempt = 0;
      this.reconnectStartedAt = 0;
      this.setState('connected');
      this.startPings();
      while (this.queued.length > 0) {
        const queued = this.queued.shift();
        if (queued) this.send(queued);
      }
    } else if (message.t === 'protocolMismatch') {
      this.stopped = true;
      this.setState('incompatible');
    } else if (message.t === 'signal') {
      const from = this.slotByPlayerId.get(message.from);
      if (from !== undefined) for (const callback of this.signalListeners) callback(from, message.data);
    } else if (message.t === 'pong') {
      this.recordPong(message.clientTs, message.serverTs);
    }
    for (const callback of this.eventListeners) callback(message);
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.welcomed = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.stopped || this.state === 'incompatible') return;
    const now = performance.now();
    if (this.reconnectStartedAt === 0) this.reconnectStartedAt = now;
    if (now - this.reconnectStartedAt >= this.reconnectLimitMs) {
      this.setState('closed');
      return;
    }
    this.reconnectAttempt += 1;
    this.setState('reconnecting');
    const delay = Math.min(3_000, 250 * 2 ** Math.min(4, this.reconnectAttempt - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const ping = () => {
      const clientTs = ++this.pingSequence;
      this.pendingPings.set(clientTs, { performanceAt: performance.now(), wallAt: Date.now() });
      this.send({ t: 'ping', clientTs });
      for (const [sequence] of this.pendingPings) {
        if (sequence < clientTs - 8) this.pendingPings.delete(sequence);
      }
    };
    ping();
    this.pingTimer = setInterval(ping, 1_000);
  }

  private recordPong(sequence: number, serverTs: number): void {
    const sent = this.pendingPings.get(sequence);
    if (!sent) return;
    this.pendingPings.delete(sequence);
    const sample = performance.now() - sent.performanceAt;
    const offsetSample = serverTs - (sent.wallAt + sample * 0.5);
    if (!this.hasServerOffset) {
      this.measuredServerOffsetMs = offsetSample;
      this.hasServerOffset = true;
    } else {
      this.measuredServerOffsetMs = this.measuredServerOffsetMs * 0.8 + offsetSample * 0.2;
    }
    if (this.measuredRttMs === 0) this.measuredRttMs = sample;
    else {
      const deviation = Math.abs(sample - this.measuredRttMs);
      this.measuredJitterMs = this.measuredJitterMs === 0 ? deviation : this.measuredJitterMs * 0.75 + deviation * 0.25;
      this.measuredRttMs = this.measuredRttMs * 0.8 + sample * 0.2;
    }
  }

  private setState(state: LobbyConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const callback of this.statusListeners) callback(state);
  }
}

function defaultSocketUrl(): string {
  const configured = import.meta.env.VITE_MULTIPLAYER_URL?.trim();
  if (configured) return configured;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV) {
    return `${protocol}//${location.hostname}:8080/ws`;
  }
  return `${protocol}//${location.host}/ws`;
}

function cleanReleaseId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'unknown';
}

function isPeerSlot(slot: number): slot is PeerSlot {
  return slot === 0 || slot === 1 || slot === 2 || slot === 3;
}

function resumeStorageKey(releaseId: string): string {
  return `bigfight_resume_${releaseId}`;
}

function readResumeToken(releaseId: string): string {
  try {
    return sessionStorage.getItem(resumeStorageKey(releaseId)) ?? '';
  } catch {
    return '';
  }
}

function writeResumeToken(releaseId: string, token: string): void {
  try {
    sessionStorage.setItem(resumeStorageKey(releaseId), token);
  } catch {
    // Private browsing can disable storage; reconnect still works in-tab.
  }
}
