/**
 * Deterministic sim RNG for netplay (lockstep/rollback).
 *
 * sfc32: 128-bit state, integer ops only (imul/shift/add) — bit-identical on
 * every JS engine, unlike transcendental Math functions. Passes PractRand;
 * chosen over mulberry32 (known output-skip / short-cycle seed flaws).
 *
 * The sim draws from NAMED STREAMS (one sfc32 each) so a stray extra draw in
 * one system can't shift another system's sequence — limits desync blast
 * radius and makes replay divergence bisectable per stream.
 *
 * RULES: sim code must NEVER call Math.random() (see scripts/check-determinism.mjs);
 * view-only code (particles, shake, audio) must NEVER draw from these streams.
 */

export class SimRng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
    // Warm up: early sfc32 outputs correlate with weak seeds.
    for (let i = 0; i < 8; i += 1) this.next();
  }

  /** Uniform float in [0, 1). Exact division by 2^32 — deterministic. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Snapshot support: 4 int32 words. */
  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(a: number, b: number, c: number, d: number): void {
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
  }
}

/** Per-system streams — see header for why they are separate. */
export interface SimRngSet {
  /** Mob/boss AI decisions (block rolls, retreats, hop timing). */
  readonly ai: SimRng;
  /** Loot: pickup gold variance, pop velocities, crate drops/contents. */
  readonly drops: SimRng;
  /** Spawn-shaped randomness (slime split velocities, spawn jitter). */
  readonly spawn: SimRng;
  /** Reserved for future modes so adding a system never shifts others. */
  readonly reserve: SimRng;
}

/** splitmix32 — expands one u32 seed into well-distributed words. */
function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) | 0;
  };
}

export function createSimRngSet(seed: number): SimRngSet {
  const mix = splitmix32(seed);
  const make = (): SimRng => new SimRng(mix(), mix(), mix(), mix());
  return { ai: make(), drops: make(), spawn: make(), reserve: make() };
}
