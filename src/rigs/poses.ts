import { clamp, lerp, smoothstep } from '../core/math';

export type JointName =
  | 'hips'
  | 'torso'
  | 'head'
  | 'armL'
  | 'armR'
  | 'foreArmL'
  | 'foreArmR'
  | 'legL'
  | 'legR'
  | 'shinL'
  | 'shinR'
  | 'root';

export type JointRotation = { x?: number; y?: number; z?: number };
export type Pose = Partial<Record<JointName, JointRotation>>;

type Axis = keyof JointRotation;
type FullPose = Record<JointName, Required<JointRotation>>;
type AttackKeyframe = { at: number; pose: Pose };

const JOINTS: readonly JointName[] = [
  'hips',
  'torso',
  'head',
  'armL',
  'armR',
  'foreArmL',
  'foreArmR',
  'legL',
  'legR',
  'shinL',
  'shinR',
  'root',
];

const scratch: FullPose = {
  hips: { x: 0, y: 0, z: 0 },
  torso: { x: 0, y: 0, z: 0 },
  head: { x: 0, y: 0, z: 0 },
  armL: { x: 0, y: 0, z: 0 },
  armR: { x: 0, y: 0, z: 0 },
  foreArmL: { x: 0, y: 0, z: 0 },
  foreArmR: { x: 0, y: 0, z: 0 },
  legL: { x: 0, y: 0, z: 0 },
  legR: { x: 0, y: 0, z: 0 },
  shinL: { x: 0, y: 0, z: 0 },
  shinR: { x: 0, y: 0, z: 0 },
  root: { x: 0, y: 0, z: 0 },
};

/**
 * Pose functions return one shared module-scratch object. Use the returned pose
 * immediately, before calling another pose function.
 */
export function poseIdle(t: number): Pose {
  reset();
  const breathe = Math.sin(t * 2.4);
  scratch.hips.x = breathe * 0.035;
  scratch.torso.x = -0.08 + breathe * 0.045;
  scratch.head.x = -scratch.torso.x * 0.45;
  scratch.armL.z = 0.12 + Math.sin(t * 2.1) * 0.08;
  scratch.armR.z = -0.12 - Math.sin(t * 2.1 + 0.6) * 0.08;
  scratch.foreArmL.x = -0.18 + breathe * 0.05;
  scratch.foreArmR.x = -0.18 - breathe * 0.05;
  return scratch;
}

export function poseRun(t: number, speedNorm: number): Pose {
  reset();
  const speed = clamp(speedNorm, 0.15, 1.35);
  const stride = Math.sin(t * 10 * speed);
  const counter = Math.cos(t * 10 * speed);
  scratch.root.z = -0.06 * stride;
  scratch.hips.x = 0.08 * counter;
  scratch.torso.x = -0.28;
  scratch.head.x = 0.12;
  scratch.legL.x = 0.78 * stride;
  scratch.legR.x = -0.78 * stride;
  scratch.shinL.x = Math.max(0, -stride) * 0.75 - 0.1;
  scratch.shinR.x = Math.max(0, stride) * 0.75 - 0.1;
  scratch.armL.x = -0.85 * stride;
  scratch.armR.x = 0.85 * stride;
  scratch.foreArmL.x = -0.38 + Math.max(0, stride) * 0.35;
  scratch.foreArmR.x = -0.38 + Math.max(0, -stride) * 0.35;
  return scratch;
}

export function poseJump(): Pose {
  reset();
  scratch.torso.x = -0.18;
  scratch.armL.x = -1.25;
  scratch.armR.x = -1.35;
  scratch.armL.z = 0.22;
  scratch.armR.z = -0.22;
  scratch.foreArmL.x = -0.4;
  scratch.foreArmR.x = -0.4;
  scratch.legL.x = -0.45;
  scratch.legR.x = -0.25;
  scratch.shinL.x = 0.65;
  scratch.shinR.x = 0.45;
  return scratch;
}

export function poseFall(): Pose {
  reset();
  scratch.torso.x = 0.18;
  scratch.armL.x = -1.05;
  scratch.armR.x = -0.95;
  scratch.armL.z = 0.35;
  scratch.armR.z = -0.35;
  scratch.foreArmL.x = -0.2;
  scratch.foreArmR.x = -0.2;
  scratch.legL.x = 0.32;
  scratch.legR.x = 0.22;
  scratch.shinL.x = -0.2;
  scratch.shinR.x = -0.28;
  return scratch;
}

export function poseLanding(): Pose {
  reset();
  scratch.hips.x = 0.32;
  scratch.torso.x = 0.48;
  scratch.head.x = -0.26;
  scratch.armL.x = 0.62;
  scratch.armR.x = 0.62;
  scratch.armL.z = 0.34;
  scratch.armR.z = -0.34;
  scratch.legL.x = -0.75;
  scratch.legR.x = -0.75;
  scratch.shinL.x = 1.05;
  scratch.shinR.x = 1.05;
  return scratch;
}

export function poseHit(): Pose {
  reset();
  scratch.root.z = -0.22;
  scratch.torso.x = 0.42;
  scratch.head.x = 0.25;
  scratch.armL.x = 0.7;
  scratch.armR.x = 0.45;
  scratch.armL.z = 0.52;
  scratch.armR.z = -0.52;
  scratch.foreArmL.x = -0.75;
  scratch.foreArmR.x = -0.75;
  scratch.legL.x = 0.25;
  scratch.legR.x = -0.15;
  return scratch;
}

export function poseTumble(t: number): Pose {
  reset();
  scratch.root.z = t * 10;
  scratch.torso.x = 0.28;
  scratch.armL.x = 0.85;
  scratch.armR.x = -0.75;
  scratch.armL.z = 0.7;
  scratch.armR.z = -0.7;
  scratch.legL.x = -0.55;
  scratch.legR.x = 0.45;
  scratch.shinL.x = 0.7;
  scratch.shinR.x = -0.45;
  return scratch;
}

export function poseKO(): Pose {
  reset();
  scratch.root.z = 1.25;
  scratch.torso.x = 0.65;
  scratch.head.z = -0.35;
  scratch.armL.x = 1.25;
  scratch.armR.x = -1.25;
  scratch.armL.z = 0.9;
  scratch.armR.z = -0.9;
  scratch.foreArmL.x = 0.7;
  scratch.foreArmR.x = 0.7;
  scratch.legL.x = -0.85;
  scratch.legR.x = 0.85;
  scratch.shinL.x = 0.45;
  scratch.shinR.x = -0.45;
  return scratch;
}

export function poseAttack(poseId: string, phase: number): Pose {
  const frames = attackFrames[poseId] ?? attackFrames.finisher!;
  return blendFrames(frames, phase);
}

const attackFrames: Record<string, readonly AttackKeyframe[]> = {
  jab1: [
    { at: 0, pose: { torso: { x: -0.22, z: 0.18 }, armR: { x: 0.8, z: -0.45 }, foreArmR: { x: -1.1 } } },
    { at: 0.45, pose: { torso: { x: -0.08, z: -0.18 }, armR: { x: -1.42, z: -0.08 }, foreArmR: { x: -0.1 }, armL: { x: 0.55, z: 0.35 }, legR: { x: -0.28 } } },
    { at: 1, pose: { torso: { x: 0.18 }, armR: { x: 0.2, z: -0.25 }, foreArmR: { x: -0.55 }, armL: { x: -0.1 }, legL: { x: 0.1 } } },
  ],
  jab2: [
    { at: 0, pose: { torso: { x: -0.16, z: -0.2 }, armL: { x: 0.7, z: 0.5 }, foreArmL: { x: -1.0 }, armR: { x: -0.2 } } },
    { at: 0.44, pose: { torso: { x: -0.1, z: 0.22 }, armL: { x: -1.38, z: 0.1 }, foreArmL: { x: -0.08 }, armR: { x: 0.35, z: -0.32 }, legL: { x: -0.2 } } },
    { at: 1, pose: { torso: { x: 0.12 }, armL: { x: 0.12, z: 0.22 }, foreArmL: { x: -0.48 }, armR: { x: -0.05 }, legR: { x: 0.12 } } },
  ],
  finisher: [
    { at: 0, pose: { root: { z: -0.18 }, torso: { x: -0.38, z: 0.45 }, armR: { x: 0.85, z: -0.95 }, foreArmR: { x: -1.25 }, legR: { x: -0.55 } } },
    { at: 0.52, pose: { root: { z: 0.32 }, torso: { x: -0.08, z: -0.72 }, armR: { x: -1.35, z: -0.38 }, foreArmR: { x: 0.35 }, armL: { x: 0.85, z: 0.4 }, legL: { x: -0.35 } } },
    { at: 1, pose: { torso: { x: 0.2, z: -0.2 }, armR: { x: 0.25, z: -0.35 }, foreArmR: { x: -0.55 }, legL: { x: 0.1 } } },
  ],
  uppercut: [
    { at: 0, pose: { hips: { x: 0.28 }, torso: { x: 0.45 }, armR: { x: 0.75, z: -0.25 }, foreArmR: { x: -1.05 }, legL: { x: -0.7 }, legR: { x: -0.7 }, shinL: { x: 0.95 }, shinR: { x: 0.95 } } },
    { at: 0.48, pose: { root: { z: -0.08 }, torso: { x: -0.35 }, armR: { x: -2.55, z: -0.12 }, foreArmR: { x: -0.15 }, armL: { x: 0.55, z: 0.4 }, legR: { x: 0.35 } } },
    { at: 1, pose: { torso: { x: -0.1 }, armR: { x: -1.0, z: -0.18 }, foreArmR: { x: -0.25 }, armL: { x: 0.1 } } },
  ],
  slam: [
    { at: 0, pose: { torso: { x: -0.55 }, armL: { x: -2.25, z: 0.18 }, armR: { x: -2.25, z: -0.18 }, foreArmL: { x: -0.65 }, foreArmR: { x: -0.65 }, legL: { x: -0.25 }, legR: { x: -0.25 } } },
    { at: 0.55, pose: { torso: { x: 0.72 }, armL: { x: 1.28, z: 0.24 }, armR: { x: 1.28, z: -0.24 }, foreArmL: { x: 0.4 }, foreArmR: { x: 0.4 }, hips: { x: 0.22 } } },
    { at: 1, pose: { torso: { x: 0.18 }, armL: { x: 0.3, z: 0.25 }, armR: { x: 0.3, z: -0.25 }, foreArmL: { x: -0.3 }, foreArmR: { x: -0.3 } } },
  ],
  spin: [
    { at: 0, pose: { root: { z: 0 }, torso: { x: -0.2 }, armL: { x: -0.5, z: 1.15 }, armR: { x: -0.55, z: -1.15 }, legL: { x: -0.25 } } },
    { at: 0.5, pose: { root: { z: Math.PI }, torso: { x: -0.1 }, armL: { x: -0.75, z: -1.2 }, armR: { x: -0.7, z: 1.2 }, legR: { x: -0.25 } } },
    { at: 1, pose: { root: { z: Math.PI * 2 }, armL: { x: -0.25, z: 0.6 }, armR: { x: -0.25, z: -0.6 } } },
  ],
  poke: [
    { at: 0, pose: { torso: { x: -0.15 }, armR: { x: 0.45, z: -0.15 }, foreArmR: { x: -0.9 }, armL: { x: 0.2 } } },
    { at: 0.42, pose: { torso: { x: -0.32 }, armR: { x: -1.62, z: -0.02 }, foreArmR: { x: -0.02 }, legR: { x: 0.32 }, legL: { x: -0.2 } } },
    { at: 1, pose: { torso: { x: 0.08 }, armR: { x: -0.25, z: -0.08 }, foreArmR: { x: -0.35 } } },
  ],
  lunge: [
    { at: 0, pose: { torso: { x: -0.28 }, armL: { x: -0.15, z: 0.3 }, armR: { x: -0.15, z: -0.3 }, foreArmL: { x: -0.6 }, foreArmR: { x: -0.6 } } },
    { at: 0.5, pose: { root: { z: -0.08 }, torso: { x: -0.78 }, armL: { x: -1.05, z: 0.4 }, armR: { x: -1.05, z: -0.4 }, foreArmL: { x: -0.25 }, foreArmR: { x: -0.25 }, legR: { x: 0.65 }, legL: { x: -0.65 } } },
    { at: 1, pose: { torso: { x: 0.12 }, armL: { x: 0.15, z: 0.2 }, armR: { x: 0.15, z: -0.2 } } },
  ],
  swoop: [
    { at: 0, pose: { root: { z: 0.12 }, torso: { x: -0.45 }, armL: { x: -0.85, z: 0.5 }, armR: { x: -0.85, z: -0.5 }, legL: { x: 0.4 }, legR: { x: 0.25 } } },
    { at: 0.5, pose: { root: { z: -0.28 }, torso: { x: -1.05 }, armL: { x: -1.65, z: 0.25 }, armR: { x: -1.65, z: -0.25 }, legL: { x: 0.82 }, legR: { x: 0.7 } } },
    { at: 1, pose: { torso: { x: 0.1 }, armL: { x: -0.2, z: 0.2 }, armR: { x: -0.2, z: -0.2 } } },
  ],
  shoot: [
    { at: 0, pose: { torso: { x: -0.12, z: 0.18 }, armR: { x: 0.1, z: -0.22 }, foreArmR: { x: -0.85 }, armL: { x: 0.45, z: 0.32 } } },
    { at: 0.35, pose: { torso: { x: -0.18, z: -0.08 }, armR: { x: -1.48, z: -0.02 }, foreArmR: { x: -0.05 }, armL: { x: -0.75, z: 0.18 }, foreArmL: { x: -0.5 } } },
    { at: 1, pose: { torso: { x: 0.08 }, armR: { x: -0.8, z: -0.02 }, foreArmR: { x: -0.15 }, armL: { x: 0.05 } } },
  ],
  slash: [
    { at: 0, pose: { root: { z: -0.18 }, torso: { x: -0.2, z: 0.65 }, armR: { x: -0.8, z: -1.2 }, foreArmR: { x: -0.45 }, armL: { x: 0.55, z: 0.3 } } },
    { at: 0.5, pose: { root: { z: 0.25 }, torso: { x: -0.12, z: -0.85 }, armR: { x: -1.15, z: 1.0 }, foreArmR: { x: 0.15 }, armL: { x: 0.65, z: -0.28 } } },
    { at: 1, pose: { torso: { x: 0.16, z: -0.25 }, armR: { x: -0.2, z: 0.28 }, foreArmR: { x: -0.35 } } },
  ],
  throw: [
    { at: 0, pose: { torso: { x: -0.42 }, armR: { x: -2.0, z: -0.18 }, foreArmR: { x: -0.65 }, armL: { x: 0.3, z: 0.35 }, legR: { x: -0.25 } } },
    { at: 0.52, pose: { torso: { x: -0.1 }, armR: { x: -0.78, z: -0.08 }, foreArmR: { x: 0.75 }, armL: { x: 0.75, z: 0.25 }, legL: { x: 0.3 } } },
    { at: 1, pose: { torso: { x: 0.18 }, armR: { x: 0.25, z: -0.1 }, foreArmR: { x: -0.25 } } },
  ],
  cast: [
    { at: 0, pose: { torso: { x: -0.12 }, armL: { x: 0.35, z: 0.45 }, armR: { x: 0.35, z: -0.45 }, foreArmL: { x: -0.85 }, foreArmR: { x: -0.85 } } },
    { at: 0.45, pose: { torso: { x: -0.35 }, armL: { x: -1.35, z: 0.18 }, armR: { x: -1.35, z: -0.18 }, foreArmL: { x: -0.05 }, foreArmR: { x: -0.05 }, head: { x: -0.14 } } },
    { at: 1, pose: { torso: { x: 0.08 }, armL: { x: -0.55, z: 0.2 }, armR: { x: -0.55, z: -0.2 }, foreArmL: { x: -0.25 }, foreArmR: { x: -0.25 } } },
  ],
};

function reset(): void {
  for (let i = 0; i < JOINTS.length; i += 1) {
    const joint = scratch[JOINTS[i]!];
    joint.x = 0;
    joint.y = 0;
    joint.z = 0;
  }
}

function blendFrames(frames: readonly AttackKeyframe[], phase: number): Pose {
  const p = clamp(phase, 0, 1);
  let a = frames[0]!;
  let b = frames[frames.length - 1]!;
  for (let i = 0; i < frames.length - 1; i += 1) {
    const next = frames[i + 1]!;
    if (p <= next.at) {
      a = frames[i]!;
      b = next;
      break;
    }
  }

  const local = smoothstep((p - a.at) / Math.max(0.0001, b.at - a.at));
  reset();
  for (let i = 0; i < JOINTS.length; i += 1) {
    const joint = JOINTS[i]!;
    scratch[joint].x = lerp(read(a.pose, joint, 'x'), read(b.pose, joint, 'x'), local);
    scratch[joint].y = lerp(read(a.pose, joint, 'y'), read(b.pose, joint, 'y'), local);
    scratch[joint].z = lerp(read(a.pose, joint, 'z'), read(b.pose, joint, 'z'), local);
  }
  return scratch;
}

function read(pose: Pose, joint: JointName, axis: Axis): number {
  return pose[joint]?.[axis] ?? 0;
}
