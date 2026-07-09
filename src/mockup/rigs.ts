/**
 * Character Lab rigs — three candidate design directions, each built for
 * Volt (robot) and Grim (monster) to judge how well the style differentiates.
 * Same joint names as the game rig, so the REAL attack animations drive them.
 *
 *  A "HEROES"  — game stature, identity-defining head shapes & gear
 *  B "CHIBI"   — giant heads, tiny bodies, huge mitts (maximum cute)
 *  C "ACTION"  — taller athletic figures, armor/muscle, small heads
 */
import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import { makeToonMaterial } from '../render/toon';
import type { JointName, Pose } from '../rigs/poses';

export type OptionId = 'A' | 'B' | 'C';
export type CharId = 'volt' | 'grim';

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 10);

const JOINTS: readonly JointName[] = [
  'hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR',
  'legL', 'legR', 'shinL', 'shinR', 'root',
];

export class MockRig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Object3D>;
  private materials: THREE.Material[] = [];
  private facingAngle = 0;
  facingTarget: 1 | -1 = 1;

  toon(color: number): THREE.MeshToonMaterial {
    const m = makeToonMaterial(color);
    this.materials.push(m);
    return m;
  }

  setPose(pose: Pose, blend: number): void {
    const amount = clamp(blend, 0, 1);
    for (const name of JOINTS) {
      const joint = this.joints[name];
      if (!joint) continue;
      const target = pose[name];
      joint.rotation.x = lerp(joint.rotation.x, target?.x ?? 0, amount);
      if (name !== 'root') joint.rotation.y = lerp(joint.rotation.y, target?.y ?? 0, amount);
      joint.rotation.z = lerp(joint.rotation.z, target?.z ?? 0, amount);
    }
  }

  update(dt: number): void {
    this.facingAngle = lerp(this.facingAngle, this.facingTarget === 1 ? 0 : Math.PI, 1 - Math.exp(-28 * dt));
    this.root.rotation.y = this.facingAngle;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
  }
}

function ball(parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(SPHERE, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  parent.add(m); return m;
}
function box(parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  parent.add(m); return m;
}
function cone(parent: THREE.Object3D, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(CONE, mat);
  m.scale.set(r, h, r); m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  parent.add(m); return m;
}

interface Skeleton {
  legLen: number; torsoH: number; depth: number; limbR: number;
  upperArm: number; foreArm: number; thigh: number; shin: number;
  shoulderY: number; shoulderZ: number; legZ: number;
}

/** Builds the joint tree; option builders then flesh out each part. */
function buildSkeleton(rig: MockRig, s: Skeleton): void {
  const g = (): THREE.Group => new THREE.Group();
  const hips = g(), torso = g(), head = g();
  const restL = g(), restR = g(), armL = g(), armR = g(), foreArmL = g(), foreArmR = g();
  const legL = g(), legR = g(), shinL = g(), shinR = g();

  hips.position.y = s.legLen;
  rig.root.add(hips);
  hips.add(torso);
  torso.add(head);

  restL.position.set(0, s.shoulderY, -s.shoulderZ);
  restR.position.set(0, s.shoulderY, s.shoulderZ);
  restL.rotation.x = 0.34; restR.rotation.x = -0.34;
  torso.add(restL, restR);
  restL.add(armL); restR.add(armR);
  foreArmL.position.y = -s.upperArm; foreArmR.position.y = -s.upperArm;
  armL.add(foreArmL); armR.add(foreArmR);

  legL.position.set(0, 0, -s.legZ); legR.position.set(0, 0, s.legZ);
  hips.add(legL, legR);
  shinL.position.y = -s.thigh; shinR.position.y = -s.thigh;
  legL.add(shinL); legR.add(shinR);

  Object.assign(rig.joints, { hips, torso, head, armL, armR, foreArmL, foreArmR, legL, legR, shinL, shinR, root: rig.root });
}

function limb(upper: THREE.Object3D, lower: THREE.Object3D, mat: THREE.Material, tipMat: THREE.Material, r: number, upperLen: number, lowerLen: number, tipScale: number, isArm: boolean): void {
  const u = new THREE.Mesh(CAPSULE, mat);
  u.scale.set(r, upperLen * 0.5, r); u.position.y = -upperLen * 0.5; upper.add(u);
  const l = new THREE.Mesh(CAPSULE, mat);
  l.scale.set(r * 0.92, lowerLen * 0.5, r * 0.92); l.position.y = -lowerLen * 0.5; lower.add(l);
  if (isArm) {
    const fist = new THREE.Mesh(SPHERE, tipMat);
    fist.scale.setScalar(r * tipScale); fist.position.y = -lowerLen; lower.add(fist);
  } else {
    const shoe = new THREE.Mesh(SPHERE, tipMat);
    shoe.scale.set(r * tipScale * 1.15, r * tipScale * 0.72, r * tipScale);
    shoe.position.set(r * 0.7, -lowerLen, 0); lower.add(shoe);
  }
}

// ---------------------------------------------------------------------------
// OPTION A — "HEROES": identity-defining head shapes + gear, game stature.
// ---------------------------------------------------------------------------
function buildA(rig: MockRig, chr: CharId): void {
  if (chr === 'volt') {
    const s: Skeleton = { legLen: 0.85, torsoH: 0.62, depth: 0.27, limbR: 0.13, upperArm: 0.36, foreArm: 0.33, thigh: 0.42, shin: 0.4, shoulderY: 0.56, shoulderZ: 0.42, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x3fb8ff), dark = rig.toon(0x1f6fd8), accent = rig.toon(0xffd94a), glow = rig.toon(0x9ff2ff), navy = rig.toon(0x24457d);
    const j = rig.joints;
    // Trapezoid chest (wide top), belt, core disc.
    box(j.torso, body, 0.62, 0.58, 0.42, 0, 0.3, 0);
    box(j.torso, dark, 0.68, 0.14, 0.46, 0, 0.55, 0);      // shoulder bar
    ball(j.torso, accent, 0.11, 0.11, 0.06, 0, 0.34, 0.24); // core
    box(j.hips, navy, 0.5, 0.16, 0.4, 0, 0, 0);            // belt
    // BOXY head: rounded box + full-width visor with pupils.
    j.head.position.y = 0.72;
    box(j.head, body, 0.46, 0.4, 0.42, 0, 0, 0);
    box(j.head, navy, 0.5, 0.16, 0.34, 0.06, 0.02, 0);      // visor band
    box(j.head, glow, 0.44, 0.12, 0.3, 0.09, 0.02, 0);      // glowing screen
    box(j.head, navy, 0.05, 0.08, 0.05, 0.32, 0.02, -0.08); // pupils
    box(j.head, navy, 0.05, 0.08, 0.05, 0.32, 0.02, 0.08);
    cone(j.head, accent, 0.035, 0.16, 0, 0.27, 0);          // antenna
    ball(j.head, accent, 0.05, 0.05, 0.05, 0, 0.37, 0);
    // Pauldrons + bracer forearms.
    ball(j.armL, dark, 0.16, 0.13, 0.16, 0, 0.02, 0);
    ball(j.armR, dark, 0.16, 0.13, 0.16, 0, 0.02, 0);
    limb(j.armL, j.foreArmL, rig.toon(0x2f8fe0), accent, 0.11, 0.36, 0.33, 1.6, true);
    limb(j.armR, j.foreArmR, rig.toon(0x2f8fe0), accent, 0.11, 0.36, 0.33, 1.6, true);
    limb(j.legL, j.shinL, dark, accent, 0.13, 0.42, 0.4, 1.7, false);
    limb(j.legR, j.shinR, dark, accent, 0.13, 0.42, 0.4, 1.7, false);
  } else {
    const s: Skeleton = { legLen: 0.66, torsoH: 0.7, depth: 0.34, limbR: 0.17, upperArm: 0.44, foreArm: 0.42, thigh: 0.3, shin: 0.3, shoulderY: 0.5, shoulderZ: 0.56, legZ: 0.2 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xb06ef5), dark = rig.toon(0x7a3fc4), bone = rig.toon(0xfff3e0), accent = rig.toon(0xffd23e), jawM = rig.toon(0x8a4fd0);
    const j = rig.joints;
    // Gorilla hunch: massive rounded torso, forward lean.
    ball(j.torso, body, 0.52, 0.5, 0.44, 0, 0.32, 0.04);
    j.torso.rotation.z = -0.12;
    // Spiky back ridge.
    for (let i = 0; i < 4; i += 1) cone(j.torso, dark, 0.09 - i * 0.012, 0.2, -0.32 - i * 0.1, 0.52 - i * 0.14, 0, 0, -1.9);
    // Big head thrust FORWARD of the chest (face must clear the guard fists).
    j.head.position.y = 0.82;
    j.head.position.x = 0.22;
    ball(j.head, body, 0.42, 0.34, 0.42, 0.05, 0.05, 0);
    box(j.head, dark, 0.24, 0.1, 0.5, 0.32, 0.22, 0, 0, -0.15); // brow overhang
    ball(j.head, accent, 0.06, 0.06, 0.05, 0.4, 0.08, -0.16);   // angry eyes under it
    ball(j.head, accent, 0.06, 0.06, 0.05, 0.4, 0.08, 0.16);
    box(j.head, jawM, 0.4, 0.18, 0.6, 0.26, -0.28, 0);          // underbite jaw, low & wide
    for (const zz of [-0.22, -0.08, 0.08, 0.22]) cone(j.head, bone, 0.05, 0.14, 0.42, -0.16, zz); // teeth UP
    cone(j.head, bone, 0.11, 0.44, -0.08, 0.3, -0.3, 0.55, 0.75);  // big horns
    cone(j.head, bone, 0.11, 0.44, -0.08, 0.3, 0.3, -0.55, 0.75);
    // Massive arms + knuckle spikes, stubby legs.
    limb(j.armL, j.foreArmL, dark, body, 0.17, 0.44, 0.42, 1.45, true);
    limb(j.armR, j.foreArmR, dark, body, 0.17, 0.44, 0.42, 1.45, true);
    for (const side of [j.foreArmL, j.foreArmR]) {
      cone(side, bone, 0.05, 0.12, 0.12, -0.42, 0, 0, -1.57);
      cone(side, bone, 0.05, 0.1, 0.1, -0.32, 0, 0, -1.57);
    }
    limb(j.legL, j.shinL, dark, accent, 0.16, 0.3, 0.3, 1.5, false);
    limb(j.legR, j.shinR, dark, accent, 0.16, 0.3, 0.3, 1.5, false);
  }
}

// ---------------------------------------------------------------------------
// OPTION B — "CHIBI": giant heads, tiny bodies, huge mitts. Maximum cute.
// ---------------------------------------------------------------------------
function buildB(rig: MockRig, chr: CharId): void {
  const s: Skeleton = { legLen: 0.42, torsoH: 0.4, depth: 0.24, limbR: 0.11, upperArm: 0.24, foreArm: 0.22, thigh: 0.2, shin: 0.2, shoulderY: 0.34, shoulderZ: 0.34, legZ: 0.14 };
  buildSkeleton(rig, s);
  const j = rig.joints;
  if (chr === 'volt') {
    const body = rig.toon(0x3fb8ff), dark = rig.toon(0x1f6fd8), accent = rig.toon(0xffd94a), glow = rig.toon(0x9ff2ff), navy = rig.toon(0x24457d), white = rig.toon(0xffffff);
    ball(j.torso, body, 0.3, 0.34, 0.3, 0, 0.16, 0);
    ball(j.torso, accent, 0.2, 0.24, 0.22, 0.08, 0.14, 0);
    // GIANT dome head (over half the character).
    j.head.position.y = 0.52;
    ball(j.head, body, 0.55, 0.5, 0.52, 0, 0.28, 0);
    box(j.head, navy, 0.5, 0.3, 0.62, 0.2, 0.3, 0);
    // Two huge rounded screen-eyes with happy pupils.
    for (const zz of [-0.22, 0.22]) {
      ball(j.head, glow, 0.16, 0.2, 0.1, 0.42, 0.3, zz);
      ball(j.head, navy, 0.06, 0.09, 0.05, 0.53, 0.32, zz);
      ball(j.head, white, 0.025, 0.03, 0.02, 0.56, 0.38, zz + 0.02);
    }
    cone(j.head, accent, 0.05, 0.22, 0, 0.78, 0);
    ball(j.head, accent, 0.08, 0.08, 0.08, 0, 0.94, 0);
    limb(j.armL, j.foreArmL, dark, accent, 0.11, 0.24, 0.22, 2.2, true);
    limb(j.armR, j.foreArmR, dark, accent, 0.11, 0.24, 0.22, 2.2, true);
    limb(j.legL, j.shinL, dark, accent, 0.12, 0.2, 0.2, 2.0, false);
    limb(j.legR, j.shinR, dark, accent, 0.12, 0.2, 0.2, 2.0, false);
  } else {
    const body = rig.toon(0xb06ef5), dark = rig.toon(0x7a3fc4), bone = rig.toon(0xfff3e0), accent = rig.toon(0xffd23e), maw = rig.toon(0x4a2470);
    ball(j.torso, body, 0.32, 0.3, 0.32, 0, 0.14, 0);
    // The head IS the monster: giant sphere, mouth across the whole front.
    j.head.position.y = 0.46;
    ball(j.head, body, 0.58, 0.52, 0.55, 0, 0.3, 0);
    ball(j.head, maw, 0.4, 0.26, 0.42, 0.28, 0.16, 0);       // gaping maw
    for (const zz of [-0.26, -0.09, 0.09, 0.26]) cone(j.head, bone, 0.06, 0.16, 0.5, 0.3, zz, 0, 3.14); // top teeth DOWN
    for (const zz of [-0.18, 0.18]) cone(j.head, bone, 0.07, 0.18, 0.52, 0.02, zz);                      // underbite UP
    for (const zz of [-0.2, 0.2]) ball(j.head, accent, 0.07, 0.08, 0.05, 0.42, 0.56, zz);                 // angry eyes
    for (const zz of [-0.2, 0.2]) box(j.head, dark, 0.16, 0.06, 0.1, 0.44, 0.66, zz, 0, zz < 0 ? -0.4 : 0.4); // brows
    cone(j.head, bone, 0.12, 0.42, -0.12, 0.68, -0.3, 0.55, 0.6);
    cone(j.head, bone, 0.12, 0.42, -0.12, 0.68, 0.3, -0.55, 0.6);
    limb(j.armL, j.foreArmL, dark, body, 0.13, 0.24, 0.22, 2.4, true);
    limb(j.armR, j.foreArmR, dark, body, 0.13, 0.24, 0.22, 2.4, true);
    limb(j.legL, j.shinL, dark, accent, 0.13, 0.2, 0.2, 1.9, false);
    limb(j.legR, j.shinR, dark, accent, 0.13, 0.2, 0.2, 1.9, false);
  }
}

// ---------------------------------------------------------------------------
// OPTION C — "ACTION": tall athletic figures, armor & muscle, small heads.
// ---------------------------------------------------------------------------
function buildC(rig: MockRig, chr: CharId): void {
  if (chr === 'volt') {
    const s: Skeleton = { legLen: 1.05, torsoH: 0.72, depth: 0.26, limbR: 0.115, upperArm: 0.42, foreArm: 0.4, thigh: 0.52, shin: 0.5, shoulderY: 0.64, shoulderZ: 0.44, legZ: 0.17 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x3fb8ff), dark = rig.toon(0x1f6fd8), accent = rig.toon(0xffd94a), glow = rig.toon(0x9ff2ff), navy = rig.toon(0x24457d);
    const j = rig.joints;
    // V-taper chest armor: wide plate narrowing to the waist.
    box(j.torso, body, 0.6, 0.44, 0.46, 0, 0.44, 0);
    box(j.torso, dark, 0.44, 0.26, 0.4, 0, 0.14, 0);
    box(j.torso, glow, 0.06, 0.34, 0.5, 0.24, 0.4, 0);       // glowing seam
    box(j.hips, navy, 0.44, 0.16, 0.38, 0, 0, 0);
    // Angular shoulder pads.
    for (const arm of [j.armL, j.armR]) box(arm, dark, 0.24, 0.16, 0.26, 0, 0.06, 0, 0, 0.15);
    // Small helmet head with visor slit.
    j.head.position.y = 0.86;
    ball(j.head, body, 0.24, 0.26, 0.24, 0, 0, 0);
    box(j.head, navy, 0.2, 0.09, 0.3, 0.12, 0.03, 0);
    box(j.head, glow, 0.18, 0.05, 0.26, 0.15, 0.03, 0);
    cone(j.head, accent, 0.03, 0.14, -0.08, 0.24, 0, 0.3, 0);
    // Jet vents on back.
    for (const zz of [-0.12, 0.12]) box(j.torso, accent, 0.08, 0.18, 0.08, -0.3, 0.4, zz);
    limb(j.armL, j.foreArmL, rig.toon(0x2f8fe0), dark, 0.115, 0.42, 0.4, 1.45, true);
    limb(j.armR, j.foreArmR, rig.toon(0x2f8fe0), dark, 0.115, 0.42, 0.4, 1.45, true);
    limb(j.legL, j.shinL, dark, navy, 0.13, 0.52, 0.5, 1.6, false);
    limb(j.legR, j.shinR, dark, navy, 0.13, 0.52, 0.5, 1.6, false);
  } else {
    const s: Skeleton = { legLen: 0.9, torsoH: 0.78, depth: 0.32, limbR: 0.15, upperArm: 0.5, foreArm: 0.48, thigh: 0.44, shin: 0.42, shoulderY: 0.7, shoulderZ: 0.5, legZ: 0.19 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xb06ef5), dark = rig.toon(0x7a3fc4), bone = rig.toon(0xfff3e0), accent = rig.toon(0xffd23e);
    const j = rig.joints;
    // Bruiser: barrel chest leaning forward, spiked pads, tail.
    ball(j.torso, body, 0.5, 0.52, 0.44, 0, 0.4, 0.06);
    j.torso.rotation.z = -0.14;
    for (const arm of [j.armL, j.armR]) {
      ball(arm, dark, 0.2, 0.16, 0.2, 0, 0.04, 0);
      cone(arm, bone, 0.06, 0.16, 0, 0.2, 0);
    }
    // Tail with spike.
    const tail = box(j.hips, dark, 0.5, 0.12, 0.12, -0.4, -0.05, 0, 0, 0.5);
    cone(tail, bone, 0.8, 1.2, -0.62, 0.4, 0, 0, -1.2);
    // Head held clear ABOVE the chest on a thick neck, big jaw, heavy horns.
    ball(j.torso, dark, 0.16, 0.18, 0.16, 0.06, 0.92, 0); // neck
    j.head.position.y = 1.18;
    j.head.position.x = 0.1;
    ball(j.head, body, 0.28, 0.26, 0.28, 0.04, 0, 0);
    box(j.head, dark, 0.32, 0.13, 0.36, 0.14, -0.14, 0);
    for (const zz of [-0.11, 0.11]) cone(j.head, bone, 0.04, 0.1, 0.26, -0.05, zz);
    for (const zz of [-0.13, 0.13]) ball(j.head, accent, 0.05, 0.055, 0.04, 0.26, 0.08, zz);
    cone(j.head, bone, 0.09, 0.32, -0.06, 0.22, -0.22, 0.5, 0.7);
    cone(j.head, bone, 0.09, 0.32, -0.06, 0.22, 0.22, -0.5, 0.7);
    // Muscle arms bigger than legs.
    limb(j.armL, j.foreArmL, dark, body, 0.16, 0.5, 0.48, 1.7, true);
    limb(j.armR, j.foreArmR, dark, body, 0.16, 0.5, 0.48, 1.7, true);
    limb(j.legL, j.shinL, dark, accent, 0.14, 0.44, 0.42, 1.5, false);
    limb(j.legR, j.shinR, dark, accent, 0.14, 0.44, 0.42, 1.5, false);
  }
}

export function buildMockRig(option: OptionId, chr: CharId): MockRig {
  const rig = new MockRig();
  if (option === 'A') buildA(rig, chr);
  else if (option === 'B') buildB(rig, chr);
  else buildC(rig, chr);
  return rig;
}

export const OPTION_LABELS: Record<OptionId, string> = {
  A: 'A · HEROES — same size as now, but every fighter gets a signature head & gear',
  B: 'B · CHIBI — giant heads, tiny bodies, huge fists (maximum cute)',
  C: 'C · ACTION — taller athletic figures with armor & muscle (most like Smash)',
};
