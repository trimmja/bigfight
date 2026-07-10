import type { JointName, Pose } from './poses';

/**
 * Signature DANCE EMOTES — one per fighter, matched to personality. Shown in
 * the "Choose your battle" roster and triggerable on your pedestal in the
 * lobby. The rig is rotation-only, so besides joint rotations a dance may add a
 * wrapper bob (vertical), sway (lateral) and spin (yaw) for real bounce — the
 * owning view applies those to the fighter's wrapper group.
 *
 * Convention (see poses.ts): profile rig faces +X. z = sagittal swing, x =
 * lateral/roll, y = yaw. In the roster/lobby the wrapper turns the rig to face
 * the camera, so `x` limb rotations read as arms-out-to-the-sides and `z` as
 * up/overhead — authored here for that front-on read.
 */
export interface Dance {
  /** Looping joint pose at time t (seconds). */
  pose(t: number): Pose;
  /** Vertical bob added to the wrapper, world units (optional). */
  bob?(t: number): number;
  /** Lateral sway added to the wrapper, world units (optional). */
  sway?(t: number): number;
  /** Extra yaw added on top of the facing turn, radians (optional). */
  spin?(t: number): number;
}

const JOINTS: readonly JointName[] = [
  'hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR', 'legL', 'legR', 'shinL', 'shinR', 'root',
];

// One shared scratch pose (consumed synchronously by setPose before the next
// fighter's dance call — same idiom as poses.ts).
const s: Record<JointName, { x: number; y: number; z: number }> = {
  hips: { x: 0, y: 0, z: 0 }, torso: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 },
  armL: { x: 0, y: 0, z: 0 }, armR: { x: 0, y: 0, z: 0 },
  foreArmL: { x: 0, y: 0, z: 0 }, foreArmR: { x: 0, y: 0, z: 0 },
  legL: { x: 0, y: 0, z: 0 }, legR: { x: 0, y: 0, z: 0 },
  shinL: { x: 0, y: 0, z: 0 }, shinR: { x: 0, y: 0, z: 0 }, root: { x: 0, y: 0, z: 0 },
};
function reset(): Record<JointName, { x: number; y: number; z: number }> {
  for (let i = 0; i < JOINTS.length; i += 1) {
    const j = s[JOINTS[i]!];
    j.x = 0; j.y = 0; j.z = 0;
  }
  return s;
}
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const up = (v: number): number => (v > 0 ? v : 0); // positive half of a wave

// ---------------------------------------------------------------- the dances

/** VOLT — THE ROBOT. Stiff, quantized servo pops; head ticks; angular arms. */
const robot: Dance = {
  pose(t) {
    const p = reset();
    const step = Math.floor(t * 5); // 5 pops/sec — setPose easing = servo glide
    const beat = ((step % 4) + 4) % 4;
    p.armL.x = -0.35; p.armR.x = 0.35;
    p.foreArmL.z = 1.5; p.foreArmR.z = 1.5;
    if (beat === 0) { p.armR.z = 1.5; p.foreArmR.z = 0.1; p.armL.z = 0.15; } // right punch out
    else if (beat === 1) { p.armL.x = -1.35; p.armR.x = 1.35; p.foreArmL.z = 1.6; p.foreArmR.z = 1.6; } // both out (T)
    else if (beat === 2) { p.armL.z = 1.5; p.foreArmL.z = 0.1; p.armR.z = 0.15; } // left punch out
    else { p.armL.z = 1.7; p.armR.z = 1.7; p.armL.x = 0.2; p.armR.x = -0.2; } // both up
    p.head.y = (step % 2 ? 1 : -1) * 0.45; // tick left/right
    p.torso.x = (beat < 2 ? 1 : -1) * 0.07;
    p.legL.z = 0.06; p.legR.z = -0.06;
    return p;
  },
  bob: (t) => -Math.abs(Math.sin(Math.floor(t * 5) * 1.7)) * 0.05, // tiny stepped hitch
};

/** KAZE — NINJA FLURRY. Fast crouched bounce, alternating chops, quick twists. */
const ninja: Dance = {
  pose(t) {
    const p = reset();
    const chop = Math.sin(t * 9);
    p.armR.x = -0.25; p.armL.x = 0.25;
    p.armR.z = 1.0 + chop * 0.8; p.foreArmR.z = 0.25;
    p.armL.z = 1.0 - chop * 0.8; p.foreArmL.z = 0.25;
    const b = Math.abs(Math.sin(t * 6));
    p.legL.z = 0.32 + b * 0.12; p.legR.z = 0.32 + b * 0.12;
    p.shinL.z = -0.55 - b * 0.2; p.shinR.z = -0.55 - b * 0.2;
    p.torso.z = 0.14; p.head.z = -0.08;
    p.head.y = chop * 0.2;
    return p;
  },
  spin: (t) => Math.sin(t * 3.4) * 0.8, // whip back and forth
  bob: (t) => -Math.abs(Math.sin(t * 6)) * 0.08,
};

/** GRIM — MONSTER STOMP. Headbang, fists raised, heavy alternating stomps. */
const stomp: Dance = {
  pose(t) {
    const p = reset();
    p.head.z = 0.35 + Math.sin(t * 8) * 0.4; // headbang
    p.torso.z = 0.22 + Math.sin(t * 8) * 0.12;
    const l = up(Math.sin(t * 4)), r = up(-Math.sin(t * 4));
    p.legL.z = l * 0.85; p.shinL.z = -l * 1.25;
    p.legR.z = r * 0.85; p.shinR.z = -r * 1.25;
    p.armL.z = 1.9; p.armR.z = 1.9; p.armL.x = 0.3; p.armR.x = -0.3; // fists up (horns)
    const fist = Math.abs(Math.sin(t * 8));
    p.foreArmL.z = 0.25 + fist * 0.45; p.foreArmR.z = 0.25 + fist * 0.45;
    return p;
  },
  bob: (t) => -Math.abs(Math.sin(t * 4)) * 0.16, // heavy on-beat drop
  sway: (t) => Math.sin(t * 2) * 0.1,
};

/** ACE — HOEDOWN. Two-step hip sway, finger-gun points, heel kicks. */
const hoedown: Dance = {
  pose(t) {
    const p = reset();
    const g = Math.sin(t * 3);
    p.hips.x = g * 0.2; p.torso.x = -g * 0.1; p.head.x = g * 0.12;
    p.armR.x = -0.45; p.armR.z = 0.55 + up(g) * 1.0; p.foreArmR.z = 0.15; // point up-right
    p.armL.x = 0.45; p.armL.z = 0.55 + up(-g) * 1.0; p.foreArmL.z = 0.15; // point up-left
    p.legR.z = up(g) * 0.5; p.shinR.z = -up(g) * 0.75; // kick heels
    p.legL.z = up(-g) * 0.5; p.shinL.z = -up(-g) * 0.75;
    return p;
  },
  sway: (t) => Math.sin(t * 3) * 0.22, // big cowboy two-step
  bob: (t) => -Math.abs(Math.sin(t * 6)) * 0.05,
};

/** BLAZE — HYPE. Bouncy raise-the-roof pushes, fired-up bounce. */
const hype: Dance = {
  pose(t) {
    const p = reset();
    const push = up(Math.sin(t * 4));
    p.armL.z = 1.55 + push * 0.7; p.armR.z = 1.55 + push * 0.7;
    p.armL.x = 0.35; p.armR.x = -0.35;
    p.foreArmL.z = 0.45 - push * 0.35; p.foreArmR.z = 0.45 - push * 0.35;
    p.torso.z = 0.12 - push * 0.12; p.head.z = 0.08 + push * 0.14;
    p.legL.z = 0.14; p.legR.z = -0.14;
    return p;
  },
  bob: (t) => Math.abs(Math.sin(t * 4)) * 0.14 - 0.06, // springy up-bounce
};

/** NOVA — DISCO STAR. Saturday-night point, graceful sway, floaty drift. */
const disco: Dance = {
  pose(t) {
    const p = reset();
    const q = Math.sin(t * 2.4);
    p.armR.z = 1.35 + q * 0.9; p.armR.x = -0.55; p.foreArmR.z = 0.1; // up-right point
    p.armL.z = 0.25 - up(q) * 0.4; p.armL.x = 0.35; p.foreArmL.z = 0.45; // across-low
    p.hips.x = -q * 0.16; p.torso.x = q * 0.09; p.head.x = q * 0.15;
    return p;
  },
  bob: (t) => Math.sin(t * 2.4) * 0.1, // slow float
  sway: (t) => Math.sin(t * 1.2) * 0.14,
};

/** SHADE — SMOOTH WAVE. Body roll, rippling arm wave, sneaky low slink. */
const wave: Dance = {
  pose(t) {
    const p = reset();
    const w = t * 2.2;
    p.armL.x = 0.55 + Math.sin(w) * 0.3; p.armL.z = 0.8;
    p.armR.x = -0.55 - Math.sin(w + 0.7) * 0.3; p.armR.z = 0.8;
    p.foreArmL.z = 0.55 + Math.sin(w + 1.2) * 0.5;
    p.foreArmR.z = 0.55 + Math.sin(w + 1.9) * 0.5;
    p.hips.x = Math.sin(w) * 0.17; p.torso.x = -Math.sin(w - 0.4) * 0.12; p.head.x = Math.sin(w - 0.9) * 0.15;
    p.torso.z = 0.14; p.legL.z = 0.28; p.legR.z = 0.28; p.shinL.z = -0.5; p.shinR.z = -0.5;
    return p;
  },
  sway: (t) => Math.sin(t * 2.2) * 0.16,
  bob: (t) => -Math.abs(Math.sin(t * 2.2)) * 0.06,
};

/** TITAN — THE SPRINKLER. One arm locked straight, sweeping in a big slow arc. */
const sprinkler: Dance = {
  pose(t) {
    const p = reset();
    p.armR.x = -1.35; p.armR.z = 0.9; p.foreArmR.z = 0.05; // locked straight out
    p.armL.x = 0.45; p.armL.z = 1.45; p.foreArmL.z = 1.7; // hand behind the head
    const b = Math.sin(t * 2);
    p.legL.z = 0.16 + up(b) * 0.2; p.shinL.z = -0.35 - up(b) * 0.2;
    p.legR.z = -0.16 - up(-b) * 0.2; p.shinR.z = -0.35 - up(-b) * 0.2;
    p.torso.z = 0.12; p.head.z = 0.1;
    return p;
  },
  spin: (t) => Math.sin(t * 1.6) * 0.55, // the sprinkler arc
  bob: (t) => -Math.abs(Math.sin(t * 2)) * 0.12, // heavy groove
  sway: (t) => Math.cos(t * 1.6) * 0.12,
};

const DANCES: Record<string, Dance> = {
  volt: robot,
  kaze: ninja,
  grim: stomp,
  ace: hoedown,
  blaze: hype,
  nova: disco,
  shade: wave,
  titan: sprinkler,
};

/** Global dance tempo — a t multiplier applied to every dance. <1 = slower. */
const DANCE_SPEED = 0.7;

/** The fighter's signature dance (falls back to the robot), slowed to the
 * house tempo. One wrapper per lookup (called on pick/spawn, not per frame). */
export function danceFor(characterId: string): Dance {
  const d = DANCES[characterId] ?? robot;
  const s = DANCE_SPEED;
  const scaled: Dance = { pose: (t) => d.pose(t * s) };
  if (d.bob) scaled.bob = (t) => d.bob!(t * s);
  if (d.sway) scaled.sway = (t) => d.sway!(t * s);
  if (d.spin) scaled.spin = (t) => d.spin!(t * s);
  return scaled;
}

void clamp01; // reserved for future eased phases
