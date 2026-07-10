import {
  PROTOCOL_VERSION,
  type C2S,
  type GameMode,
  type RoomState,
  type S2C,
  type S2CJoinError,
  type S2CMatchStart,
  type S2CRoomClosed,
  type StockCount,
  type Team,
} from '../../shared/protocol';

/**
 * WebSocket lobby client for the BIG FIGHT room server (shared/protocol.ts).
 *
 * Owns exactly the transport + room-protocol concerns: connect/hello,
 * resume-token reconnect (30s grace, exponential backoff), typed send
 * helpers, an event emitter for S2C messages, and server-RTT measurement.
 * Match netcode rides on top via `sendSignal`/`onSignal` (WebRTC SDP/ICE)
 * and `sendRelayFrame`/`onRelayFrame` (binary WS relay fallback) — this
 * class never interprets those payloads.
 */

const DEFAULT_WS_URL = 'wss://bigfight-online.fly.dev/ws';
const HELLO_TIMEOUT_MS = 7_000;
const PING_INTERVAL_MS = 2_000;
const RECONNECT_GRACE_MS = 30_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;

/** Server endpoint: same-origin when served from the fly host; `?localserver` → local dev server. */
export function lobbyServerUrl(): string {
  if (location.search.includes('localserver')) return 'ws://localhost:8080/ws';
  if (location.hostname.endsWith('.fly.dev')) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }
  return DEFAULT_WS_URL;
}

export interface LobbyClientEvents {
  /** Socket up + welcome received (fires again after a successful resume). */
  connected: void;
  /** Full room snapshot (server re-sends on every change). */
  room: RoomState;
  joinError: S2CJoinError;
  /** Our PROTOCOL_VERSION is stale — the server refused the socket. */
  upgradeRequired: void;
  countdown: { seconds: number };
  countdownCancelled: { by: string };
  matchStart: S2CMatchStart;
  signal: { from: string; data: unknown };
  roomClosed: S2CRoomClosed;
  /** Trying to reclaim our slot after an unexpected drop. */
  reconnecting: { attempt: number };
  /** Slot reclaimed — same identity, room state follows via 'room'. */
  resumed: void;
  /** Connection is gone for good (grace expired or resume rejected). */
  lost: void;
  /** Fresh server RTT measurement, ms. */
  rtt: number;
}

type Handler<T> = (payload: T) => void;

export class LobbyClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<keyof LobbyClientEvents, Set<Handler<never>>>();
  private relayHandlers = new Set<Handler<Uint8Array>>();

  private playerId: string | null = null;
  private resumeToken: string | null = null;
  private roomState: RoomState | null = null;
  private serverRtt: number | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectedAt = 0;
  private reconnectAttempt = 0;
  private connecting: Promise<void> | null = null;
  private intentionalClose = false;
  private disposed = false;

  // -------------------------------------------------------------- accessors

  get room(): RoomState | null {
    return this.roomState;
  }

  get selfId(): string | null {
    return this.playerId;
  }

  get self(): RoomState['players'][number] | null {
    return this.roomState?.players.find((p) => p.playerId === this.playerId) ?? null;
  }

  get isHost(): boolean {
    return this.roomState !== null && this.roomState.hostId === this.playerId;
  }

  /** Latest measured server RTT in ms (null before the first pong). */
  get rttMs(): number | null {
    return this.serverRtt;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.playerId !== null;
  }

  // ----------------------------------------------------------------- events

  on<K extends keyof LobbyClientEvents>(
    event: K,
    fn: Handler<LobbyClientEvents[K]>,
  ): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  private emit<K extends keyof LobbyClientEvents>(event: K, payload: LobbyClientEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) (fn as Handler<LobbyClientEvents[K]>)(payload);
  }

  /** Binary relay frames from other players (already sender-slot-stamped). */
  onRelayFrame(fn: (bytes: Uint8Array) => void): () => void {
    this.relayHandlers.add(fn);
    return () => this.relayHandlers.delete(fn);
  }

  onSignal(fn: (from: string, data: unknown) => void): () => void {
    return this.on('signal', ({ from, data }) => fn(from, data));
  }

  // ------------------------------------------------------------- connection

  /**
   * Open the socket and complete the hello/welcome handshake. Resolves once
   * we're ready to createRoom/joinRoom; rejects if the server is unreachable
   * or requires an upgrade. Idempotent while connected/connecting.
   */
  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('disposed'));
    if (this.isConnected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.open(null).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /** One socket lifecycle. `resume` non-null = trying to reclaim a slot. */
  private open(resume: { code: string; playerId: string; token: string } | null): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      };
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        settle(new Error('hello timeout'));
      }, HELLO_TIMEOUT_MS);

      let ws: WebSocket;
      try {
        ws = new WebSocket(lobbyServerUrl());
      } catch (e) {
        settle(e instanceof Error ? e : new Error('websocket failed'));
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.intentionalClose = false;
      this.ws = ws;

      ws.onopen = () => {
        const hello: C2S = {
          t: 'hello',
          v: PROTOCOL_VERSION,
          buildId: __BUILD_ID__,
          ...(resume ? { resume } : {}),
        };
        ws.send(JSON.stringify(hello));
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (this.ws !== ws) return; // stale socket
        if (typeof ev.data !== 'string') {
          const bytes = new Uint8Array(ev.data as ArrayBuffer);
          for (const fn of [...this.relayHandlers]) fn(bytes);
          return;
        }
        let msg: S2C;
        try {
          msg = JSON.parse(ev.data) as S2C;
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          const resumedSameIdentity = resume !== null && msg.playerId === resume.playerId;
          if (resume && !resumedSameIdentity) {
            // Server rejected the resume (grace expired / room gone) and
            // handed us a fresh identity — our old slot is unrecoverable.
            this.playerId = msg.playerId;
            this.resumeToken = msg.resumeToken;
            this.roomState = null;
            settle();
            this.startPingLoop();
            this.emit('lost', undefined);
            return;
          }
          this.playerId = msg.playerId;
          this.resumeToken = msg.resumeToken;
          settle();
          this.startPingLoop();
          this.emit('connected', undefined);
          if (resumedSameIdentity) this.emit('resumed', undefined);
          return;
        }
        this.dispatch(msg);
      };

      ws.onerror = () => {
        settle(new Error('connection failed'));
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.stopPingLoop();
        settle(new Error('connection closed'));
        if (this.disposed || this.intentionalClose) return;
        this.scheduleResume();
      };
    });
  }

  private dispatch(msg: S2C): void {
    switch (msg.t) {
      case 'room':
        this.roomState = msg.room;
        this.emit('room', msg.room);
        return;
      case 'joinError':
        this.emit('joinError', msg);
        return;
      case 'upgradeRequired':
        this.intentionalClose = true; // server closes the socket; don't resume
        this.emit('upgradeRequired', undefined);
        return;
      case 'countdown':
        this.emit('countdown', { seconds: msg.seconds });
        return;
      case 'countdownCancelled':
        this.emit('countdownCancelled', { by: msg.by });
        return;
      case 'matchStart':
        this.emit('matchStart', msg);
        return;
      case 'signal':
        this.emit('signal', { from: msg.from, data: msg.data });
        return;
      case 'roomClosed':
        this.roomState = null;
        this.emit('roomClosed', msg);
        return;
      case 'pong': {
        const rtt = Math.max(0, Math.round(performance.now() - msg.ts));
        this.serverRtt = rtt;
        this.emit('rtt', rtt);
        // Publish our own server RTT self-keyed, so other lobbies can show a
        // connection-quality dot for us before any P2P link exists. The
        // netcode layer later reports true peer RTTs keyed by peer ids.
        if (this.playerId && this.roomState) {
          this.send({ t: 'reportPings', pings: { [this.playerId]: rtt } });
        }
        return;
      }
      default:
        return;
    }
  }

  /** Unexpected drop: reclaim our slot with backoff inside the grace window. */
  private scheduleResume(): void {
    const code = this.roomState?.code;
    if (!code || !this.playerId || !this.resumeToken) {
      // Not in a room — nothing to reclaim; screens reconnect on demand.
      this.emit('lost', undefined);
      return;
    }
    if (this.reconnectAttempt === 0) this.disconnectedAt = performance.now();
    const elapsed = performance.now() - this.disconnectedAt;
    if (elapsed > RECONNECT_GRACE_MS) {
      this.reconnectAttempt = 0;
      this.roomState = null;
      this.emit('lost', undefined);
      return;
    }
    const attempt = this.reconnectAttempt + 1;
    this.reconnectAttempt = attempt;
    this.emit('reconnecting', { attempt });
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.intentionalClose) return;
      void this.open({ code, playerId: this.playerId!, token: this.resumeToken! })
        .then(() => {
          this.reconnectAttempt = 0;
        })
        .catch(() => {
          /* onclose fires scheduleResume again */
        });
    }, delay);
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    const probe = (): void => this.send({ t: 'ping', ts: performance.now() });
    probe();
    this.pingTimer = setInterval(probe, PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ----------------------------------------------------------- send helpers

  private send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  createRoom(nickname: string, levelsBeaten: number): void {
    this.send({ t: 'createRoom', nickname, levelsBeaten });
  }

  joinRoom(code: string, nickname: string, levelsBeaten: number): void {
    this.send({ t: 'joinRoom', code, nickname, levelsBeaten });
  }

  leaveRoom(): void {
    this.roomState = null;
    this.send({ t: 'leaveRoom' });
  }

  /** Update our own slot; omitted fields unchanged. `pick: null` clears. */
  setPlayer(patch: { pick?: string | null; ready?: boolean; team?: Team; nickname?: string }): void {
    this.send({ t: 'setPlayer', ...patch });
  }

  /** Host only. Partial room settings update; `stageId` may be 'random'. */
  setSettings(patch: {
    mode?: GameMode;
    stocks?: StockCount;
    stageId?: string;
    levelId?: number | null;
  }): void {
    this.send({ t: 'setSettings', ...patch });
  }

  startMatch(): void {
    this.send({ t: 'startMatch' });
  }

  backToLobby(): void {
    this.send({ t: 'backToLobby' });
  }

  /** Host only, during 'match': playerIds winner-first. */
  matchEnd(placements: string[]): void {
    this.send({ t: 'matchEnd', placements });
  }

  rematchVote(): void {
    this.send({ t: 'rematchVote' });
  }

  /** Opaque WebRTC signaling relayed to `to` (netcode layer). */
  sendSignal(to: string, data: unknown): void {
    this.send({ t: 'signal', to, data });
  }

  /** Report measured peer RTTs (netcode layer; server caps at 1/s). */
  reportPings(pings: Record<string, number>): void {
    this.send({ t: 'reportPings', pings });
  }

  /** Binary passthrough — build frames with shared/protocol encodeRelayFrame. */
  sendRelayFrame(bytes: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  // ---------------------------------------------------------------- cleanup

  dispose(): void {
    this.disposed = true;
    this.intentionalClose = true;
    this.stopPingLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'client disposed');
      } catch {
        /* ignore */
      }
    }
    this.handlers.clear();
    this.relayHandlers.clear();
    this.roomState = null;
  }
}
