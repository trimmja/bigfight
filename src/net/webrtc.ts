import type { MatchSignaling } from './MatchSignaling';
import type { NetChannel, NetTransport, PeerSlot, PeerStats } from './transport';

const INTERNAL_MARKER = 0xbf;
const INTERNAL_PING = 1;
const INTERNAL_PONG = 2;
const PING_INTERVAL_MS = 500;

type WireSignal =
  | { kind: 'description'; description: { type: RTCSdpType; sdp?: string } }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit };

interface PeerLink {
  slot: PeerSlot;
  connection: RTCPeerConnection;
  game: RTCDataChannel;
  control: RTCDataChannel;
  connected: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  rttMs: number;
  jitterMs: number;
  pingSequence: number;
  pendingPings: Map<number, number>;
}

export interface WebRtcMeshOptions {
  localSlot: PeerSlot;
  peerSlots: readonly PeerSlot[];
  signaling: MatchSignaling;
  iceServers?: readonly RTCIceServer[];
}

/**
 * Small (2-4 player) WebRTC mesh. Inputs use an unordered, no-retransmit data
 * channel; hashes/control use a reliable ordered channel. The lower slot is
 * always the offerer, preventing negotiation glare without a host bottleneck.
 */
export class WebRtcMeshTransport implements NetTransport {
  readonly localSlot: PeerSlot;
  readonly peerSlots: readonly PeerSlot[];

  private readonly signaling: MatchSignaling;
  private readonly links = new Map<PeerSlot, PeerLink>();
  private messageCallback: ((from: PeerSlot, channel: NetChannel, data: Uint8Array) => void) | null = null;
  private peerCallback: ((slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void) | null = null;
  private readonly stopSignal: () => void;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(options: WebRtcMeshOptions) {
    this.localSlot = options.localSlot;
    this.peerSlots = [...new Set(options.peerSlots)].filter((slot) => slot !== options.localSlot);
    this.signaling = options.signaling;
    const configuration: RTCConfiguration = {
      iceServers: options.iceServers ? [...options.iceServers] : defaultIceServers(),
      bundlePolicy: 'max-bundle',
    };
    for (const slot of this.peerSlots) this.links.set(slot, this.createLink(slot, configuration));
    this.stopSignal = this.signaling.onSignal((from, data) => { void this.handleSignal(from, data); });
    this.pingTimer = setInterval(() => this.pingPeers(), PING_INTERVAL_MS);
    queueMicrotask(() => { void this.makeOffers(); });
  }

  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    const link = this.links.get(to);
    const dataChannel = channel === 'game' ? link?.game : link?.control;
    if (!link?.connected || dataChannel?.readyState !== 'open') return;
    dataChannel.send(copyBuffer(data));
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
    const link = this.links.get(slot);
    return {
      // Conservative until the first application-level ping returns.
      rttMs: link?.rttMs || 80,
      jitterMs: link?.jitterMs ?? 0,
      path: 'p2p',
      connected: link?.connected ?? false,
    };
  }

  /** Wait until every direct link is usable; false means relay should remain. */
  ready(timeoutMs = 4_000): Promise<boolean> {
    if (this.allConnected()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const deadline = performance.now() + timeoutMs;
      const check = () => {
        if (this.allConnected()) resolve(true);
        else if (this.closed || performance.now() >= deadline) resolve(false);
        else setTimeout(check, 40);
      };
      check();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopSignal();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const link of this.links.values()) {
      link.game.close();
      link.control.close();
      link.connection.close();
      if (link.connected) this.peerCallback?.(link.slot, 'left');
    }
    this.links.clear();
    this.messageCallback = null;
  }

  private createLink(slot: PeerSlot, configuration: RTCConfiguration): PeerLink {
    const connection = new RTCPeerConnection(configuration);
    const game = connection.createDataChannel('game', {
      negotiated: true,
      id: 0,
      ordered: false,
      maxRetransmits: 0,
    });
    const control = connection.createDataChannel('control', {
      negotiated: true,
      id: 1,
      ordered: true,
    });
    game.binaryType = 'arraybuffer';
    control.binaryType = 'arraybuffer';
    const link: PeerLink = {
      slot,
      connection,
      game,
      control,
      connected: false,
      pendingCandidates: [],
      rttMs: 0,
      jitterMs: 0,
      pingSequence: 0,
      pendingPings: new Map(),
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.signaling.sendSignal(slot, { kind: 'candidate', candidate: event.candidate.toJSON() } satisfies WireSignal);
    };
    connection.onconnectionstatechange = () => this.updateConnected(link);
    game.onopen = () => this.updateConnected(link);
    control.onopen = () => this.updateConnected(link);
    game.onclose = () => this.updateConnected(link);
    control.onclose = () => this.updateConnected(link);
    game.onmessage = (event) => this.deliver(link, 'game', event.data);
    control.onmessage = (event) => this.deliver(link, 'control', event.data);
    return link;
  }

  private async makeOffers(): Promise<void> {
    for (const link of this.links.values()) {
      if (this.localSlot > link.slot || this.closed) continue;
      try {
        const offer = await link.connection.createOffer();
        await link.connection.setLocalDescription(offer);
        const local = link.connection.localDescription;
        if (local) this.signaling.sendSignal(link.slot, {
          kind: 'description',
          description: { type: local.type, ...(local.sdp ? { sdp: local.sdp } : {}) },
        } satisfies WireSignal);
      } catch (error) {
        console.warn('WebRTC offer failed; relay remains active', error);
      }
    }
  }

  private async handleSignal(from: PeerSlot, raw: unknown): Promise<void> {
    const link = this.links.get(from);
    const signal = parseSignal(raw);
    if (!link || !signal || this.closed) return;
    try {
      if (signal.kind === 'candidate') {
        if (!link.connection.remoteDescription) link.pendingCandidates.push(signal.candidate);
        else await link.connection.addIceCandidate(signal.candidate);
        return;
      }
      await link.connection.setRemoteDescription(signal.description);
      for (const candidate of link.pendingCandidates.splice(0)) await link.connection.addIceCandidate(candidate);
      if (signal.description.type === 'offer') {
        const answer = await link.connection.createAnswer();
        await link.connection.setLocalDescription(answer);
        const local = link.connection.localDescription;
        if (local) this.signaling.sendSignal(from, {
          kind: 'description',
          description: { type: local.type, ...(local.sdp ? { sdp: local.sdp } : {}) },
        } satisfies WireSignal);
      }
    } catch (error) {
      console.warn('WebRTC signaling failed; relay remains active', error);
    }
  }

  private updateConnected(link: PeerLink): void {
    const connectionReady = link.connection.connectionState === 'connected';
    const channelsReady = link.game.readyState === 'open' && link.control.readyState === 'open';
    const connected = connectionReady && channelsReady;
    if (connected === link.connected) return;
    link.connected = connected;
    this.peerCallback?.(link.slot, connected ? 'connected' : 'lost');
  }

  private deliver(link: PeerLink, channel: NetChannel, raw: unknown): void {
    const data = toBytes(raw);
    if (!data) return;
    if (channel === 'control' && data[0] === INTERNAL_MARKER) {
      this.handleInternal(link, data);
      return;
    }
    this.messageCallback?.(link.slot, channel, data);
  }

  private pingPeers(): void {
    for (const link of this.links.values()) {
      if (!link.connected || link.control.readyState !== 'open') continue;
      const sequence = ++link.pingSequence;
      link.pendingPings.set(sequence, performance.now());
      link.control.send(internalPacket(INTERNAL_PING, sequence));
      for (const pending of link.pendingPings.keys()) {
        if (pending < sequence - 8) link.pendingPings.delete(pending);
      }
    }
  }

  private handleInternal(link: PeerLink, data: Uint8Array): void {
    if (data.length !== 6) return;
    const kind = data[1];
    const sequence = readU32(data, 2);
    if (kind === INTERNAL_PING && link.control.readyState === 'open') {
      link.control.send(internalPacket(INTERNAL_PONG, sequence));
      return;
    }
    if (kind !== INTERNAL_PONG) return;
    const sentAt = link.pendingPings.get(sequence);
    if (sentAt === undefined) return;
    link.pendingPings.delete(sequence);
    const sample = performance.now() - sentAt;
    if (link.rttMs === 0) link.rttMs = sample;
    else {
      const deviation = Math.abs(sample - link.rttMs);
      link.jitterMs = link.jitterMs === 0 ? deviation : link.jitterMs * 0.75 + deviation * 0.25;
      link.rttMs = link.rttMs * 0.8 + sample * 0.2;
    }
  }

  private allConnected(): boolean {
    return this.links.size === this.peerSlots.length && [...this.links.values()].every((link) => link.connected);
  }
}

function defaultIceServers(): RTCIceServer[] {
  return [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
}

function parseSignal(raw: unknown): WireSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'candidate' && value.candidate && typeof value.candidate === 'object') {
    return { kind: 'candidate', candidate: value.candidate as RTCIceCandidateInit };
  }
  if (value.kind !== 'description' || !value.description || typeof value.description !== 'object') return null;
  const description = value.description as Record<string, unknown>;
  if (description.type !== 'offer' && description.type !== 'answer') return null;
  if (description.sdp !== undefined && typeof description.sdp !== 'string') return null;
  return {
    kind: 'description',
    description: {
      type: description.type,
      ...(typeof description.sdp === 'string' ? { sdp: description.sdp } : {}),
    },
  };
}

function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  return null;
}

function copyBuffer(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer as ArrayBuffer;
}

function internalPacket(kind: number, sequence: number): ArrayBuffer {
  const data = new Uint8Array(6);
  data[0] = INTERNAL_MARKER;
  data[1] = kind;
  writeU32(data, 2, sequence);
  return data.buffer;
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function readU32(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0;
}
