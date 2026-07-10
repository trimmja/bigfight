/**
 * Rollback snapshots: full sim state → preallocated ArrayBuffer and back.
 *
 * Entities implement ONE `syncState(io)` method that both writes and reads —
 * `io.f64(this.x)` returns the stored value when reading and echoes the
 * argument when writing, so `this.x = io.f64(this.x)` round-trips. A single
 * field list serves both directions: order mismatches are impossible.
 *
 * Object references (alreadyHit members, AI targets) serialize as net ids via
 * the SimRegistry (fighters → entity id, projectile slots → 0x10000 | index).
 */

const SNAPSHOT_BYTES = 96 * 1024; // worst case ~40KB — generous headroom

export class StateIO {
  private view: DataView;
  private offset = 0;
  private mode: 'write' | 'read' = 'write';

  constructor(readonly buffer: ArrayBuffer = new ArrayBuffer(SNAPSHOT_BYTES)) {
    this.view = new DataView(buffer);
  }

  get reading(): boolean {
    return this.mode === 'read';
  }

  /** Bytes used by the last write pass. */
  get length(): number {
    return this.offset;
  }

  beginWrite(): void {
    this.mode = 'write';
    this.offset = 0;
  }

  beginRead(): void {
    this.mode = 'read';
    this.offset = 0;
  }

  f64(value: number): number {
    if (this.mode === 'write') {
      this.view.setFloat64(this.offset, value, true);
      this.offset += 8;
      return value;
    }
    const out = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return out;
  }

  i32(value: number): number {
    if (this.mode === 'write') {
      this.view.setInt32(this.offset, value | 0, true);
      this.offset += 4;
      return value | 0;
    }
    const out = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return out;
  }

  bool(value: boolean): boolean {
    return this.i32(value ? 1 : 0) !== 0;
  }

  /**
   * Sync a list of net ids (e.g. an alreadyHit set). Write: pulls ids via
   * `collect`; read: returns the stored ids for the caller to resolve.
   */
  idList(collect: () => number[]): number[] {
    if (this.mode === 'write') {
      const ids = collect();
      this.i32(ids.length);
      for (let i = 0; i < ids.length; i += 1) this.i32(ids[i]!);
      return ids;
    }
    const count = this.i32(0);
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) ids.push(this.i32(0));
    return ids;
  }

  /** Copy the used region into a compact Uint8Array (resync transfers). */
  toBytes(): Uint8Array {
    return new Uint8Array(this.buffer.slice(0, this.offset));
  }
}

/** Net-id space: fighters use their entity id; projectile slots are offset. */
export const PROJECTILE_ID_BASE = 0x10000;

export interface NetIdentified {
  readonly id: number;
}

/** Resolve net ids back to live objects after a snapshot restore. */
export class SimRegistry {
  private readonly byId = new Map<number, object>();

  register(id: number, obj: object): void {
    this.byId.set(id, obj);
  }

  resolve(id: number): object | null {
    return this.byId.get(id) ?? null;
  }

  clear(): void {
    this.byId.clear();
  }
}

/** Shared helper: net id for an alreadyHit member (or -1 if unknown). */
export function netIdOf(obj: object): number {
  const maybe = obj as { id?: number; poolIndex?: number };
  if (typeof maybe.poolIndex === 'number') return PROJECTILE_ID_BASE | maybe.poolIndex;
  if (typeof maybe.id === 'number') return maybe.id;
  return -1;
}

/** Shared helper: rebuild a Set<object> from stored ids via the registry. */
export function restoreIdSet(target: Set<object>, ids: readonly number[], registry: SimRegistry): void {
  target.clear();
  for (let i = 0; i < ids.length; i += 1) {
    const obj = registry.resolve(ids[i]!);
    if (obj) target.add(obj);
  }
}
