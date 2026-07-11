import type { JointName, Pose } from './poses';

/** A looping lobby dance plus optional motion for the rig's root wrapper. */
export interface Dance {
  pose(t: number): Pose;
  bob?(t: number): number;
  sway?(t: number): number;
  spin?(t: number): number;
}

const JOINTS: readonly JointName[] = [
  'hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR',
  'legL', 'legR', 'shinL', 'shinR', 'root',
];

const scratch = {} as Record<JointName, { x: number; y: number; z: number }>;
for (const joint of JOINTS) scratch[joint] = { x: 0, y: 0, z: 0 };

function reset(): typeof scratch {
  for (const joint of JOINTS) scratch[joint]!.x = scratch[joint]!.y = scratch[joint]!.z = 0;
  return scratch;
}

const up = (value: number): number => Math.max(0, value);

const robot: Dance = {
  pose(t) {
    const pose = reset();
    const step = Math.floor(t * 5);
    const beat = ((step % 4) + 4) % 4;
    pose.armL.x = -0.35; pose.armR.x = 0.35;
    pose.foreArmL.z = 1.5; pose.foreArmR.z = 1.5;
    if (beat === 0) { pose.armR.z = 1.5; pose.foreArmR.z = 0.1; pose.armL.z = 0.15; }
    else if (beat === 1) { pose.armL.x = -1.35; pose.armR.x = 1.35; }
    else if (beat === 2) { pose.armL.z = 1.5; pose.foreArmL.z = 0.1; pose.armR.z = 0.15; }
    else { pose.armL.z = 1.7; pose.armR.z = 1.7; pose.armL.x = 0.2; pose.armR.x = -0.2; }
    pose.head.y = (step % 2 ? 1 : -1) * 0.45;
    pose.torso.x = (beat < 2 ? 1 : -1) * 0.07;
    return pose;
  },
  bob: (t) => -Math.abs(Math.sin(Math.floor(t * 5) * 1.7)) * 0.05,
};

const ninja: Dance = {
  pose(t) {
    const pose = reset();
    const chop = Math.sin(t * 9);
    pose.armR.x = -0.25; pose.armL.x = 0.25;
    pose.armR.z = 1 + chop * 0.8; pose.armL.z = 1 - chop * 0.8;
    pose.foreArmR.z = pose.foreArmL.z = 0.25;
    const bounce = Math.abs(Math.sin(t * 6));
    pose.legL.z = pose.legR.z = 0.32 + bounce * 0.12;
    pose.shinL.z = pose.shinR.z = -0.55 - bounce * 0.2;
    pose.torso.z = 0.14; pose.head.y = chop * 0.2;
    return pose;
  },
  spin: (t) => Math.sin(t * 3.4) * 0.8,
  bob: (t) => -Math.abs(Math.sin(t * 6)) * 0.08,
};

const stomp: Dance = {
  pose(t) {
    const pose = reset();
    pose.head.z = 0.35 + Math.sin(t * 8) * 0.4;
    pose.torso.z = 0.22 + Math.sin(t * 8) * 0.12;
    const left = up(Math.sin(t * 4));
    const right = up(-Math.sin(t * 4));
    pose.legL.z = left * 0.85; pose.shinL.z = -left * 1.25;
    pose.legR.z = right * 0.85; pose.shinR.z = -right * 1.25;
    pose.armL.z = pose.armR.z = 1.9;
    pose.foreArmL.z = pose.foreArmR.z = 0.25 + Math.abs(Math.sin(t * 8)) * 0.45;
    return pose;
  },
  bob: (t) => -Math.abs(Math.sin(t * 4)) * 0.16,
  sway: (t) => Math.sin(t * 2) * 0.1,
};

const hoedown: Dance = {
  pose(t) {
    const pose = reset();
    const groove = Math.sin(t * 3);
    pose.hips.x = groove * 0.2; pose.torso.x = -groove * 0.1; pose.head.x = groove * 0.12;
    pose.armR.x = -0.45; pose.armR.z = 0.55 + up(groove); pose.foreArmR.z = 0.15;
    pose.armL.x = 0.45; pose.armL.z = 0.55 + up(-groove); pose.foreArmL.z = 0.15;
    pose.legR.z = up(groove) * 0.5; pose.shinR.z = -up(groove) * 0.75;
    pose.legL.z = up(-groove) * 0.5; pose.shinL.z = -up(-groove) * 0.75;
    return pose;
  },
  sway: (t) => Math.sin(t * 3) * 0.22,
  bob: (t) => -Math.abs(Math.sin(t * 6)) * 0.05,
};

const hype: Dance = {
  pose(t) {
    const pose = reset();
    const push = up(Math.sin(t * 4));
    pose.armL.z = pose.armR.z = 1.55 + push * 0.7;
    pose.armL.x = 0.35; pose.armR.x = -0.35;
    pose.foreArmL.z = pose.foreArmR.z = 0.45 - push * 0.35;
    pose.torso.z = 0.12 - push * 0.12; pose.head.z = 0.08 + push * 0.14;
    return pose;
  },
  bob: (t) => Math.abs(Math.sin(t * 4)) * 0.14 - 0.06,
};

const disco: Dance = {
  pose(t) {
    const pose = reset();
    const groove = Math.sin(t * 2.4);
    pose.armR.z = 1.35 + groove * 0.9; pose.armR.x = -0.55; pose.foreArmR.z = 0.1;
    pose.armL.z = 0.25 - up(groove) * 0.4; pose.armL.x = 0.35; pose.foreArmL.z = 0.45;
    pose.hips.x = -groove * 0.16; pose.torso.x = groove * 0.09; pose.head.x = groove * 0.15;
    return pose;
  },
  bob: (t) => Math.sin(t * 2.4) * 0.1,
  sway: (t) => Math.sin(t * 1.2) * 0.14,
};

const wave: Dance = {
  pose(t) {
    const pose = reset();
    const phase = t * 2.2;
    pose.armL.x = 0.55 + Math.sin(phase) * 0.3; pose.armL.z = 0.8;
    pose.armR.x = -0.55 - Math.sin(phase + 0.7) * 0.3; pose.armR.z = 0.8;
    pose.foreArmL.z = 0.55 + Math.sin(phase + 1.2) * 0.5;
    pose.foreArmR.z = 0.55 + Math.sin(phase + 1.9) * 0.5;
    pose.hips.x = Math.sin(phase) * 0.17; pose.torso.x = -Math.sin(phase - 0.4) * 0.12;
    pose.head.x = Math.sin(phase - 0.9) * 0.15;
    pose.legL.z = pose.legR.z = 0.28; pose.shinL.z = pose.shinR.z = -0.5;
    return pose;
  },
  sway: (t) => Math.sin(t * 2.2) * 0.16,
  bob: (t) => -Math.abs(Math.sin(t * 2.2)) * 0.06,
};

const sprinkler: Dance = {
  pose(t) {
    const pose = reset();
    pose.armR.x = -1.35; pose.armR.z = 0.9; pose.foreArmR.z = 0.05;
    pose.armL.x = 0.45; pose.armL.z = 1.45; pose.foreArmL.z = 1.7;
    const beat = Math.sin(t * 2);
    pose.legL.z = 0.16 + up(beat) * 0.2; pose.shinL.z = -0.35 - up(beat) * 0.2;
    pose.legR.z = -0.16 - up(-beat) * 0.2; pose.shinR.z = -0.35 - up(-beat) * 0.2;
    return pose;
  },
  spin: (t) => Math.sin(t * 1.6) * 0.55,
  bob: (t) => -Math.abs(Math.sin(t * 2)) * 0.12,
  sway: (t) => Math.cos(t * 1.6) * 0.12,
};

const DANCES: Readonly<Record<string, Dance>> = {
  volt: robot, comet: robot, kaze: ninja, grim: stomp, ace: hoedown,
  blaze: hype, nova: disco, shade: wave, titan: sprinkler,
  rex: hype, frost: stomp,
};

/** Returns the fighter's approved dance at the shared, kid-friendly tempo. */
export function danceFor(characterId: string): Dance {
  const dance = DANCES[characterId] ?? robot;
  const speed = 0.7;
  const scaled: Dance = { pose: (t) => dance.pose(t * speed) };
  if (dance.bob) scaled.bob = (t) => dance.bob!(t * speed);
  if (dance.sway) scaled.sway = (t) => dance.sway!(t * speed);
  if (dance.spin) scaled.spin = (t) => dance.spin!(t * speed);
  return scaled;
}
