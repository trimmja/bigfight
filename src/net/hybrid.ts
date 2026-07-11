import type { MatchSignaling } from './MatchSignaling';
import { WsRelayTransport } from './relay';
import type { NetChannel, NetTransport, PeerSlot, PeerStats } from './transport';
import { WebRtcMeshTransport } from './webrtc';

/** The direct-transport surface hybrid needs (WebRTC, or a test fake). */
export type DirectTransport = NetTransport & { ready(timeoutMs?: number): Promise<boolean> };

export interface HybridMeshOptions {
  localSlot: PeerSlot;
  peerSlots: readonly PeerSlot[];
  signaling?: MatchSignaling;
  iceServers?: readonly RTCIceServer[];
  /** Test seams: injected transports + clock (production: WebRTC/relay/Date.now). */
  transports?: { direct: DirectTransport; relay: NetTransport };
  now?: () => number;
}

/** Direct must stay connected this long before we route on it (no flapping). */
const DIRECT_STABLE_MS = 1_500;
/** After any route switch, mirror sends on the old route for this long. */
const ROUTE_OVERLAP_MS = 1_000;

interface RouteState {
  onDirect: boolean;
  /** When the direct link last (re)connected; 0 while down. */
  directSince: number;
  /** When the active route last changed; 0 = never switched. */
  switchedAt: number;
}

/**
 * Per-peer route selector with hysteresis. The match works immediately over
 * Fly relay; a peer is promoted to direct WebRTC only after its data channels
 * have been open for DIRECT_STABLE_MS, and demoted the moment they drop.
 * Around every switch, packets go out on BOTH routes for ROUTE_OVERLAP_MS —
 * rollback input packets are redundant and idempotent, so duplicates are
 * harmless and a single bad handoff can't open an input gap.
 */
export class HybridMeshTransport implements NetTransport {
  readonly localSlot: PeerSlot;
  readonly peerSlots: readonly PeerSlot[];

  private readonly direct: DirectTransport;
  private readonly relay: NetTransport;
  private readonly now: () => number;
  private readonly routes = new Map<PeerSlot, RouteState>();
  private messageCallback: ((from: PeerSlot, channel: NetChannel, data: Uint8Array) => void) | null = null;
  private peerCallback: ((slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void) | null = null;

  constructor(options: HybridMeshOptions) {
    this.localSlot = options.localSlot;
    this.peerSlots = [...options.peerSlots];
    this.now = options.now ?? Date.now;
    if (options.transports) {
      this.relay = options.transports.relay;
      this.direct = options.transports.direct;
    } else {
      if (!options.signaling) throw new Error('HybridMeshTransport needs signaling (or injected transports)');
      this.relay = new WsRelayTransport(options.localSlot, options.peerSlots, options.signaling);
      this.direct = new WebRtcMeshTransport({
        localSlot: options.localSlot,
        peerSlots: options.peerSlots,
        signaling: options.signaling,
        ...(options.iceServers ? { iceServers: options.iceServers } : {}),
      });
    }
    this.direct.onMessage((from, channel, data) => this.messageCallback?.(from, channel, data));
    this.relay.onMessage((from, channel, data) => this.messageCallback?.(from, channel, data));
    this.direct.onPeerChange((slot, event) => {
      const route = this.routeState(slot);
      if (event === 'connected') {
        route.directSince = this.now();
        this.peerCallback?.(slot, 'connected');
      } else {
        route.directSince = 0;
        if (!this.relay.stats(slot).connected) this.peerCallback?.(slot, event);
      }
    });
  }

  send(to: PeerSlot, channel: NetChannel, data: Uint8Array): void {
    const now = this.now();
    const route = this.updateRoute(to, now);
    if (channel === 'control') {
      // Reliable control traffic (state hashes, the input-repair exchange
      // that unfreezes a stalled match) is tiny and idempotent: send it on
      // BOTH routes always, so a direct path that still claims connected
      // while silently dropping traffic can never starve a repair.
      this.relay.send(to, channel, data);
      this.directIfUp(to)?.send(to, channel, data);
      return;
    }
    const primary = route.onDirect ? this.direct : this.relay;
    primary.send(to, channel, data);
    if (route.switchedAt > 0 && now - route.switchedAt < ROUTE_OVERLAP_MS) {
      const mirror = route.onDirect ? this.relay : this.directIfUp(to);
      mirror?.send(to, channel, data);
    }
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
    const route = this.updateRoute(slot, this.now());
    return route.onDirect ? this.direct.stats(slot) : this.relay.stats(slot);
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

  private routeState(slot: PeerSlot): RouteState {
    let route = this.routes.get(slot);
    if (!route) {
      route = { onDirect: false, directSince: 0, switchedAt: 0 };
      this.routes.set(slot, route);
    }
    return route;
  }

  /** Apply hysteresis: promote after stability, demote immediately on drop. */
  private updateRoute(slot: PeerSlot, now: number): RouteState {
    const route = this.routeState(slot);
    const directUp = this.direct.stats(slot).connected;
    if (!directUp) {
      route.directSince = 0;
      if (route.onDirect) {
        route.onDirect = false;
        route.switchedAt = now;
        console.info(`[net] peer ${slot} route: direct→relay`);
      }
    } else {
      if (route.directSince === 0) route.directSince = now;
      if (!route.onDirect && now - route.directSince >= DIRECT_STABLE_MS) {
        route.onDirect = true;
        route.switchedAt = now;
        console.info(`[net] peer ${slot} route: relay→direct`);
      }
    }
    return route;
  }

  private directIfUp(slot: PeerSlot): DirectTransport | null {
    return this.direct.stats(slot).connected ? this.direct : null;
  }
}
