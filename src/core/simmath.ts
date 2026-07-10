/**
 * Cross-engine-stable math for SIM code (netplay determinism).
 *
 * IEEE-754 basics (+ − × ÷ sqrt) are exactly specified and identical on every
 * engine. Transcendentals (sin/cos/atan2/exp/pow) are NOT — V8 and JavaScript-
 * Core differ in the last ulps, which desyncs lockstep sims across devices.
 * Fix (production-proven by Rune): round transcendental OUTPUTS to float32 via
 * Math.fround — engines agree at that precision essentially always. Residual
 * risk is covered by the netcode's state-hash + resync safety net.
 *
 * RULES: sim code (entities/ai/combat/physics/GameplayScreen) uses THESE, never
 * raw Math transcendentals (enforced by scripts/check-determinism.mjs).
 * View/render/audio code should keep using Math.* — no reason to pay fround.
 */

const f = Math.fround;

export function sin(x: number): number {
  return f(Math.sin(x));
}

export function cos(x: number): number {
  return f(Math.cos(x));
}

export function atan2(y: number, x: number): number {
  return f(Math.atan2(y, x));
}

export function exp(x: number): number {
  return f(Math.exp(x));
}

export function pow(x: number, y: number): number {
  return f(Math.pow(x, y));
}

/** sqrt is IEEE-exact — strictly better than fround(Math.hypot). */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Deterministic twin of core/math damp() for sim smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - exp(-lambda * dt));
}
