/**
 * xxHash32 — fast non-cryptographic hash, integer ops only (bit-identical on
 * every JS engine). Used for sim-state digests: replay verification (M0) and
 * the rollback session's cross-peer desync checks (M1+).
 */

const P1 = 0x9e3779b1;
const P2 = 0x85ebca77;
const P3 = 0xc2b2ae3d;
const P4 = 0x27d4eb2f;
const P5 = 0x165667b1;

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

export function xxHash32(data: Uint8Array, seed = 0): number {
  const len = data.length;
  let i = 0;
  let h: number;

  if (len >= 16) {
    let v1 = (seed + P1 + P2) | 0;
    let v2 = (seed + P2) | 0;
    let v3 = seed | 0;
    let v4 = (seed - P1) | 0;
    const limit = len - 16;
    while (i <= limit) {
      v1 = Math.imul(rotl((v1 + Math.imul(readU32(data, i), P2)) | 0, 13), P1);
      v2 = Math.imul(rotl((v2 + Math.imul(readU32(data, i + 4), P2)) | 0, 13), P1);
      v3 = Math.imul(rotl((v3 + Math.imul(readU32(data, i + 8), P2)) | 0, 13), P1);
      v4 = Math.imul(rotl((v4 + Math.imul(readU32(data, i + 12), P2)) | 0, 13), P1);
      i += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h = (seed + P5) | 0;
  }

  h = (h + len) | 0;
  while (i + 4 <= len) {
    h = Math.imul(rotl((h + Math.imul(readU32(data, i), P3)) | 0, 17), P4);
    i += 4;
  }
  while (i < len) {
    h = Math.imul(rotl((h + Math.imul(data[i]!, P5)) | 0, 11), P1);
    i += 1;
  }

  h ^= h >>> 15;
  h = Math.imul(h, P2);
  h ^= h >>> 13;
  h = Math.imul(h, P3);
  h ^= h >>> 16;
  return h >>> 0;
}

function readU32(data: Uint8Array, i: number): number {
  return data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24);
}

// Scratch reused across calls — digests are single-threaded and synchronous.
let scratchF64 = new Float64Array(1024);
let scratchU8 = new Uint8Array(scratchF64.buffer);

/** Hash a list of numbers via their exact float64 bit patterns. */
export function hashNumbers(values: readonly number[], seed = 0): number {
  if (values.length > scratchF64.length) {
    scratchF64 = new Float64Array(values.length * 2);
    scratchU8 = new Uint8Array(scratchF64.buffer);
  }
  for (let i = 0; i < values.length; i += 1) scratchF64[i] = values[i]!;
  return xxHash32(scratchU8.subarray(0, values.length * 8), seed);
}
