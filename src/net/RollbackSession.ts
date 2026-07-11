import { TIMESTEP } from '../config';
import type { InputState } from '../contracts';
import { events } from '../core/events';
import type { Game } from '../Game';
import type { GameplayScreen } from '../screens/GameplayScreen';
import { xxHash32 } from './hash';
import { encodeInput, INPUT_BYTES, NetIntentSource } from './inputCodec';
import { simPhase } from './simPhase';
import { StateIO } from './snapshots';
import type { NetTransport, PeerSlot } from './transport';

/**
 * GGPO-style rollback session.
 *
 * Drives an (unmodified) GameplayScreen through injected NetIntentSources:
 * each sim frame decodes every slot's input (real if received, repeat-last
 * prediction otherwise), steps the screen once, and snapshots BEFORE the step.
 * A late input that contradicts a prediction restores the snapshot at that
 * frame, resims silently (simPhase.resimulating + event suppression), and
 * reconciles visuals once.
 *
 * Wire (game channel):  0x01 inputs [slot, startFrame u32, count u8, n×3B]
 *                       0x03 hash   [slot, frame u32, hash u32]
 * Packets carry the last REDUNDANT_FRAMES frames — loss needs no retransmit.
 */

export const DEFAULT_INPUT_DELAY_FRAMES = 3;
export const DEFAULT_ROLLBACK_WINDOW_FRAMES = 15;
const SNAPSHOT_MARGIN = 8;
const INPUT_RING = 1024; // frames of input history (~17s — far beyond any rollback)
const REDUNDANT_FRAMES = 10;
const HASH_INTERVAL = 20;

const MSG_INPUTS = 0x01;
const MSG_HASH = 0x03;
const MSG_INPUT_REQUEST = 0x04;
const MSG_INPUT_REPAIR = 0x05;
const REPAIR_CHUNK_FRAMES = 200;
/** Consecutive stalled pumps before (re)requesting reliable input repair. */
const STALL_REPAIR_INTERVAL = 30;

export interface RollbackStats {
  frame: number;
  confirmedFrame: number;
  rollbacks: number;
  resimmedFrames: number;
  desyncs: number;
  stalledFrames: number;
  inputDelayFrames: number;
  rollbackWindowFrames: number;
}

export interface RollbackSessionOptions {
  game: Game;
  screen: GameplayScreen;
  transport: NetTransport;
  localSlot: number;
  playerCount: number;
  /** Per-slot sources — the SAME objects passed to the GameplayScreen. */
  sources: NetIntentSource[];
  /** Local input sampler (default: live device input). Tests inject bots. */
  sampleLocalInput?: () => InputState;
  /** Chosen once before the match from measured peer RTT/jitter. */
  inputDelay?: number;
  /** Maximum prediction distance before the sim waits for real inputs. */
  rollbackWindow?: number;
  onPeerChange?: (slot: PeerSlot, event: 'connected' | 'lost' | 'left') => void;
}

export class RollbackSession {
  /** Next frame to simulate. */
  frame = 0;

  private readonly game: Game;
  private readonly screen: GameplayScreen;
  private readonly transport: NetTransport;
  private readonly localSlot: number;
  private readonly playerCount: number;
  private readonly sources: NetIntentSource[];
  private readonly sampleLocal: () => InputState;
  private readonly inputDelay: number;
  private readonly rollbackWindow: number;
  private readonly snapshotRingSize: number;

  /** Per-slot input rings: bytes actually USED per frame (+known flag). */
  private readonly inputBytes: Uint8Array[];
  private readonly inputKnown: Uint8Array[];
  /** Exact frame stored at each ring index; prevents stale data after lap 1024. */
  private readonly inputFrameTags: Int32Array[];
  private readonly lastKnownFrame: number[];
  private nextLocalFrame: number;

  private readonly snapshots: StateIO[] = [];
  private readonly snapshotFrames: number[] = [];

  private rollbackTo = -1;
  private stalledStreak = 0;
  private lastHashedFrame = -1;
  private readonly pendingHashes = new Map<number, Map<number, number>>();

  readonly stats: RollbackStats = {
    frame: 0,
    confirmedFrame: -1,
    rollbacks: 0,
    resimmedFrames: 0,
    desyncs: 0,
    stalledFrames: 0,
    inputDelayFrames: 0,
    rollbackWindowFrames: 0,
  };

  constructor(opts: RollbackSessionOptions) {
    this.game = opts.game;
    this.screen = opts.screen;
    this.transport = opts.transport;
    this.localSlot = opts.localSlot;
    this.playerCount = opts.playerCount;
    this.sources = opts.sources;
    this.sampleLocal = opts.sampleLocalInput ?? (() => opts.game.input.state);
    if (this.playerCount < 1 || this.playerCount > 4 || this.sources.length !== this.playerCount) {
      throw new Error('RollbackSession requires 1-4 players and one input source per player');
    }
    if (this.localSlot < 0 || this.localSlot >= this.playerCount) {
      throw new Error(`RollbackSession localSlot ${this.localSlot} is outside the match`);
    }
    this.inputDelay = Math.max(0, Math.floor(opts.inputDelay ?? DEFAULT_INPUT_DELAY_FRAMES));
    this.rollbackWindow = Math.max(
      this.inputDelay + 2,
      Math.floor(opts.rollbackWindow ?? DEFAULT_ROLLBACK_WINDOW_FRAMES),
    );
    this.snapshotRingSize = this.rollbackWindow + SNAPSHOT_MARGIN;
    this.stats.inputDelayFrames = this.inputDelay;
    this.stats.rollbackWindowFrames = this.rollbackWindow;
    this.nextLocalFrame = 0;

    this.inputBytes = [];
    this.inputKnown = [];
    this.inputFrameTags = [];
    this.lastKnownFrame = [];
    for (let slot = 0; slot < this.playerCount; slot += 1) {
      this.inputBytes.push(new Uint8Array(INPUT_RING * INPUT_BYTES));
      this.inputKnown.push(new Uint8Array(INPUT_RING));
      const tags = new Int32Array(INPUT_RING);
      tags.fill(-1);
      this.inputFrameTags.push(tags);
      this.lastKnownFrame.push(-1);
    }
    for (let i = 0; i < this.snapshotRingSize; i += 1) {
      this.snapshots.push(new StateIO());
      this.snapshotFrames.push(-1);
    }

    this.transport.onMessage((from, channel, data) => this.onMessage(from, channel, data));
    this.transport.onPeerChange((slot, event) => {
      if (event === 'connected') this.requestPeerRepair(slot);
      opts.onPeerChange?.(slot, event);
    });
    // Neutral inputs cover the delay gap at match start (all peers agree).
    const neutral = new Uint8Array(INPUT_BYTES); // buttons 0, axes 0
    for (let f = 0; f < this.inputDelay; f += 1) this.writeRing(this.localSlot, f, neutral, 0, true);
    this.nextLocalFrame = this.inputDelay;
    this.broadcastInputs();
  }

  /** Min contiguous frame received from EVERY slot (local included). */
  get confirmedFrame(): number {
    let min = Number.POSITIVE_INFINITY;
    for (let slot = 0; slot < this.playerCount; slot += 1) {
      if (this.lastKnownFrame[slot]! < min) min = this.lastKnownFrame[slot]!;
    }
    return min === Number.POSITIVE_INFINITY ? -1 : min;
  }

  /**
   * One pump per local fixed step: ingest packets, sample+send local input,
   * roll back if needed, then advance up to `maxSteps` sim frames.
   */
  pump(maxSteps = 1): void {
    // 1. Fill enough local frames to support bounded catch-up after a slow
    // render. All catch-up frames sample the current held state; edge flags
    // are derived later from the encoded held stream.
    const localTarget = this.frame + this.inputDelay + Math.max(2, maxSteps + 1);
    let sampled = false;
    while (this.nextLocalFrame < localTarget) {
      const bytes = new Uint8Array(INPUT_BYTES);
      encodeInput(this.sampleLocal(), bytes, 0);
      this.writeRing(this.localSlot, this.nextLocalFrame, bytes, 0, true);
      this.nextLocalFrame += 1;
      sampled = true;
    }
    if (sampled) this.broadcastInputs();

    // 2. Apply any pending rollback (packets arrive via onMessage).
    this.applyRollbackIfNeeded();

    // 3. Advance.
    let steps = 0;
    while (steps < maxSteps && this.canSimulate(this.frame)) {
      this.stepFrame(this.frame);
      this.frame += 1;
      steps += 1;
    }
    if (steps === 0) {
      this.stats.stalledFrames += 1;
      this.stalledStreak += 1;
      // Peers simulate up to a full rollback window INTO an outage, which is
      // deeper than the redundant packet tail reaches back. A stall that long
      // leaves a hole ordinary resends never refill — keep asking every peer
      // for a reliable refill until the sim moves again.
      if (this.stalledStreak % STALL_REPAIR_INTERVAL === 0) this.repairConnections();
    } else {
      this.stalledStreak = 0;
    }

    // 4. Confirmed-frame hashes (host compares).
    this.exchangeHashes();

    this.stats.frame = this.frame;
    this.stats.confirmedFrame = this.confirmedFrame;
  }

  /**
   * Ingest + correct WITHOUT advancing: rebroadcasts local inputs (loss
   * recovery) and applies any pending rollback. Used when pacing says "don't
   * step" and by the golden test's drain phase.
   */
  flush(): void {
    this.broadcastInputs();
    this.applyRollbackIfNeeded();
  }

  /** Refill any input gap after a coordinated room reconnect. */
  repairConnections(): void {
    for (const slot of this.transport.peerSlots) this.requestPeerRepair(slot);
  }

  private canSimulate(frame: number): boolean {
    if (frame >= this.nextLocalFrame) return false; // local input not sampled yet
    return frame <= this.confirmedFrame + this.rollbackWindow;
  }

  private stepFrame(frame: number): void {
    // Snapshot the state BEFORE simulating this frame.
    const ring = frame % this.snapshotRingSize;
    this.screen.writeSnapshot(this.snapshots[ring]!);
    this.snapshotFrames[ring] = frame;

    for (let slot = 0; slot < this.playerCount; slot += 1) {
      const idx = frame % INPUT_RING;
      if (this.inputKnown[slot]![idx] !== 1 || !this.ringFrameMatches(slot, frame)) {
        // Predict: repeat the last known input (or neutral).
        this.predictInto(slot, frame);
      }
      this.sources[slot]!.applyFrame(this.inputBytes[slot]!, idx * INPUT_BYTES);
    }
    this.screen.update(this.game, TIMESTEP);
  }

  private predictInto(slot: number, frame: number): void {
    const last = this.lastKnownFrame[slot]!;
    const src = last >= 0 ? this.readRing(slot, last) : null;
    const idx = (frame % INPUT_RING) * INPUT_BYTES;
    const bytes = this.inputBytes[slot]!;
    if (src) {
      bytes[idx] = src[0]!;
      bytes[idx + 1] = src[1]!;
      bytes[idx + 2] = src[2]!;
    } else {
      bytes[idx] = 0;
      bytes[idx + 1] = 0;
      bytes[idx + 2] = 0;
    }
    this.inputKnown[slot]![frame % INPUT_RING] = 0;
    this.inputFrameTags[slot]![frame % INPUT_RING] = frame;
  }

  private applyRollbackIfNeeded(): void {
    if (this.rollbackTo < 0 || this.rollbackTo >= this.frame) {
      this.rollbackTo = -1;
      return;
    }
    const to = this.rollbackTo;
    this.rollbackTo = -1;
    const ring = to % this.snapshotRingSize;
    if (this.snapshotFrames[ring] !== to) {
      // Snapshot evicted (shouldn't happen inside the window) — hard fault.
      console.error(`rollback: snapshot for frame ${to} evicted (have ${this.snapshotFrames[ring]})`);
      this.stats.desyncs += 1;
      return;
    }

    this.stats.rollbacks += 1;
    this.screen.readSnapshot(this.snapshots[ring]!);

    // Re-prime edge derivation from the frame before the rollback point.
    for (let slot = 0; slot < this.playerCount; slot += 1) {
      if (to > 0) {
        const prev = this.readRing(slot, to - 1);
        this.sources[slot]!.primeFromButtons(prev[0]!);
      } else {
        this.sources[slot]!.reset();
      }
    }

    const savedFrame = this.frame;
    simPhase.resimulating = true;
    events.setSuppressed(true);
    try {
      for (let f = to; f < savedFrame; f += 1) {
        this.stepFrame(f);
        this.stats.resimmedFrames += 1;
      }
    } finally {
      simPhase.resimulating = false;
      events.setSuppressed(false);
    }
    this.screen.reconcileView();
  }

  // --- wire ---

  private broadcastInputs(): void {
    const newest = this.nextLocalFrame - 1;
    const oldest = Math.max(0, newest - REDUNDANT_FRAMES + 1);
    const count = newest - oldest + 1;
    const packet = new Uint8Array(1 + 1 + 4 + 1 + count * INPUT_BYTES);
    packet[0] = MSG_INPUTS;
    packet[1] = this.localSlot;
    writeU32(packet, 2, oldest);
    packet[6] = count;
    for (let i = 0; i < count; i += 1) {
      const src = this.readRing(this.localSlot, oldest + i);
      packet.set(src, 7 + i * INPUT_BYTES);
    }
    this.transport.broadcast('game', packet);
  }

  private onMessage(from: PeerSlot, channel: 'game' | 'control', data: Uint8Array): void {
    if (data.length < 1) return;
    if (data[0] === MSG_INPUTS) {
      if (channel !== 'game' || data.length < 7) return;
      const slot = data[1]!;
      if (slot !== from || slot === this.localSlot || slot >= this.playerCount) return;
      const startFrame = readU32(data, 2);
      const count = data[6]!;
      if (count === 0 || data.length < 7 + count * INPUT_BYTES) return;
      for (let i = 0; i < count; i += 1) {
        const frame = startFrame + i;
        this.ingestInput(slot, frame, data, 7 + i * INPUT_BYTES);
      }
    } else if (data[0] === MSG_HASH) {
      if (channel === 'control' && data.length >= 10 && data[1] === from) this.onHashMessage(data);
    } else if (data[0] === MSG_INPUT_REQUEST) {
      if (channel !== 'control' || data.length !== 6 || data[1] !== from) return;
      this.sendInputRepair(from, readU32(data, 2));
    } else if (data[0] === MSG_INPUT_REPAIR) {
      if (channel !== 'control' || data.length < 7 || data[1] !== from || from >= this.playerCount) return;
      const startFrame = readU32(data, 2);
      const count = data[6]!;
      if (count === 0 || data.length !== 7 + count * INPUT_BYTES) return;
      for (let i = 0; i < count; i += 1) this.ingestInput(from, startFrame + i, data, 7 + i * INPUT_BYTES);
    }
  }

  private requestPeerRepair(slot: PeerSlot): void {
    if (slot >= this.playerCount || slot === this.localSlot) return;
    const packet = new Uint8Array(6);
    packet[0] = MSG_INPUT_REQUEST;
    packet[1] = this.localSlot;
    writeU32(packet, 2, this.lastKnownFrame[slot]! + 1);
    this.transport.send(slot, 'control', packet);
  }

  private sendInputRepair(to: PeerSlot, requestedFrame: number): void {
    const newest = this.nextLocalFrame - 1;
    if (newest < 0 || requestedFrame > newest) return;
    const oldestAvailable = Math.max(0, newest - INPUT_RING + 1);
    let frame = Math.max(requestedFrame, oldestAvailable);
    while (frame <= newest) {
      const count = Math.min(REPAIR_CHUNK_FRAMES, newest - frame + 1);
      const packet = new Uint8Array(7 + count * INPUT_BYTES);
      packet[0] = MSG_INPUT_REPAIR;
      packet[1] = this.localSlot;
      writeU32(packet, 2, frame);
      packet[6] = count;
      for (let i = 0; i < count; i += 1) packet.set(this.readRing(this.localSlot, frame + i), 7 + i * INPUT_BYTES);
      this.transport.send(to, 'control', packet);
      frame += count;
    }
  }

  private ingestInput(slot: number, frame: number, data: Uint8Array, offset: number): void {
    const frameIndex = frame % INPUT_RING;
    if (
      frame <= this.lastKnownFrame[slot]!
      && this.inputKnown[slot]![frameIndex] === 1
      && this.inputFrameTags[slot]![frameIndex] === frame
    ) {
      return; // already have it
    }
    if (frame < this.frame) {
      // Late input for an already-simulated frame — did we mispredict?
      const idx = (frame % INPUT_RING) * INPUT_BYTES;
      const used = this.inputBytes[slot]!;
      const differs =
        used[idx] !== data[offset] || used[idx + 1] !== data[offset + 1] || used[idx + 2] !== data[offset + 2];
      if (differs && (this.rollbackTo < 0 || frame < this.rollbackTo)) {
        this.rollbackTo = frame;
      }
    }
    this.writeRing(slot, frame, data, offset, true);
    // Advance the contiguous-known watermark (bounded by the newest frame in
    // this packet era — flags past it may belong to lapped ancient frames).
    let watermark = this.lastKnownFrame[slot]!;
    while (watermark + 1 <= frame) {
      const next = watermark + 1;
      const idx = next % INPUT_RING;
      if (this.inputKnown[slot]![idx] !== 1 || this.inputFrameTags[slot]![idx] !== next) break;
      watermark += 1;
    }
    this.lastKnownFrame[slot] = watermark;
  }

  private exchangeHashes(): void {
    const confirmed = this.confirmedFrame;
    const next = this.lastHashedFrame + HASH_INTERVAL;
    if (confirmed < next || next >= this.frame || next < 0) return;
    const ring = next % this.snapshotRingSize;
    if (this.snapshotFrames[ring] !== next) return; // evicted — skip this one
    this.lastHashedFrame = next;
    const io = this.snapshots[ring]!;
    const hash = xxHash32(new Uint8Array(io.buffer, 0, io.length));
    if (this.localSlot === 0) {
      this.recordHash(next, 0, hash);
    } else {
      const packet = new Uint8Array(10);
      packet[0] = MSG_HASH;
      packet[1] = this.localSlot;
      writeU32(packet, 2, next);
      writeU32(packet, 6, hash);
      this.transport.send(0 as PeerSlot, 'control', packet);
    }
  }

  private onHashMessage(data: Uint8Array): void {
    if (this.localSlot !== 0) return; // host compares
    const slot = data[1]!;
    const frame = readU32(data, 2);
    const hash = readU32(data, 6);
    this.recordHash(frame, slot, hash);
  }

  private recordHash(frame: number, slot: number, hash: number): void {
    let hashes = this.pendingHashes.get(frame);
    if (!hashes) {
      hashes = new Map<number, number>();
      this.pendingHashes.set(frame, hashes);
    }
    hashes.set(slot, hash);
    if (hashes.size >= this.playerCount) {
      const first = hashes.values().next().value as number;
      for (const [entrySlot, entryHash] of hashes) {
        if (entryHash !== first) {
          this.stats.desyncs += 1;
          console.error(`DESYNC at frame ${frame}: slot ${entrySlot} hash ${entryHash.toString(16)} vs ${first.toString(16)}`);
          break;
        }
      }
      this.pendingHashes.delete(frame);
    }
    // GC stale entries (peers that never reported).
    for (const key of this.pendingHashes.keys()) {
      if (key < frame - HASH_INTERVAL * 6) this.pendingHashes.delete(key);
    }
  }

  // --- ring helpers ---

  private writeRing(slot: number, frame: number, data: Uint8Array, offset: number, known: boolean): void {
    const idx = (frame % INPUT_RING) * INPUT_BYTES;
    const bytes = this.inputBytes[slot]!;
    bytes[idx] = data[offset]!;
    bytes[idx + 1] = data[offset + 1]!;
    bytes[idx + 2] = data[offset + 2]!;
    const ringIndex = frame % INPUT_RING;
    this.inputKnown[slot]![ringIndex] = known ? 1 : 0;
    this.inputFrameTags[slot]![ringIndex] = frame;
    if (known && frame === this.lastKnownFrame[slot]! + 1) {
      this.lastKnownFrame[slot] = frame;
    }
  }

  private readRing(slot: number, frame: number): Uint8Array {
    const idx = (frame % INPUT_RING) * INPUT_BYTES;
    return this.inputBytes[slot]!.subarray(idx, idx + INPUT_BYTES);
  }

  private ringFrameMatches(slot: number, frame: number): boolean {
    return this.inputFrameTags[slot]![frame % INPUT_RING] === frame;
  }
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function readU32(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0;
}
