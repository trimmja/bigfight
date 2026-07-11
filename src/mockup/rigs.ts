/**
 * Character Lab rigs — the full roster in the shipped "ACTION" style
 * (direction C, picked 2026-07-08; options A/B retired 2026-07-10).
 * Same joint names as the game rig, so the REAL attack animations drive them.
 *
 * ⚠️ The live designs ship from src/rigs/characterBuilders.ts — that file is
 * the source of truth. The builders below are a review snapshot; if you
 * iterate on character looks here, port the winner over there (they don't
 * share code). NEW fighters debut here FIRST for family sign-off, then port.
 */
import * as THREE from 'three';
import { clamp, lerp } from '../core/math';
import type { WeaponDef } from '../data/types';
import { makeToonMaterial } from '../render/toon';
import { buildWeaponModel } from '../rigs/weaponBuilders';
import type { JointName, Pose } from '../rigs/poses';

export type CharId = 'volt' | 'kaze' | 'grim' | 'ace' | 'blaze' | 'nova' | 'shade' | 'titan' | 'comet' | 'rex' | 'frost';
export const ALL_CHARS: readonly CharId[] = ['volt', 'kaze', 'grim', 'ace', 'blaze', 'nova', 'shade', 'titan', 'comet', 'rex', 'frost'];

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const RING = new THREE.TorusGeometry(1, 0.14, 8, 22);

const JOINTS: readonly JointName[] = [
  'hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR',
  'legL', 'legR', 'shinL', 'shinR', 'root',
];

export class MockRig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Object3D>;
  readonly weaponSocket = new THREE.Group();
  private materials: THREE.Material[] = [];
  private weaponModel: THREE.Group | null = null;
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
      joint.rotation.x = angleLerp(joint.rotation.x, target?.x ?? 0, amount);
      if (name !== 'root') joint.rotation.y = angleLerp(joint.rotation.y, target?.y ?? 0, amount);
      joint.rotation.z = angleLerp(joint.rotation.z, target?.z ?? 0, amount);
    }
  }

  update(dt: number): void {
    this.facingAngle = lerp(this.facingAngle, this.facingTarget === 1 ? 0 : Math.PI, 1 - Math.exp(-28 * dt));
    this.root.rotation.y = this.facingAngle;
  }

  equipWeapon(weapon: WeaponDef | null): void {
    this.clearWeapon();
    if (!weapon) return;
    this.weaponModel = buildWeaponModel(weapon);
    this.weaponSocket.add(this.weaponModel);
  }

  private clearWeapon(): void {
    if (!this.weaponModel) return;
    this.weaponModel.removeFromParent();
    const materials = this.weaponModel.userData.weaponMaterials as THREE.Material[] | undefined;
    for (const material of materials ?? []) material.dispose();
    this.weaponModel.traverse((child) => {
      if (!(child instanceof THREE.Sprite)) return;
      const material = child.material;
      if (!materials?.includes(material)) material.dispose();
    });
    this.weaponModel = null;
  }

  dispose(): void {
    this.clearWeapon();
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
  }
}

/** Lerp between angles along the SHORTEST arc (2π-aware). */
function angleLerp(current: number, target: number, amount: number): number {
  const TWO_PI = Math.PI * 2;
  let delta = (target - current) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return current + delta * amount;
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

/** Builds the joint tree; character builders then flesh out each part. */
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
  foreArmR.add(rig.weaponSocket);
  rig.weaponSocket.position.set(0, -s.foreArm, s.depth * 0.5);

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
// The roster — "ACTION" style: tall athletic figures, armor & muscle.
// ---------------------------------------------------------------------------
function cylinder(parent: THREE.Object3D, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(CYL, mat);
  m.scale.set(r, h, r); m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  parent.add(m); return m;
}

function buildC(rig: MockRig, chr: CharId): void {
  if (chr === 'kaze') {
    // Lean speedster ninja (clean v1 look): hood, eye slit, gold headband,
    // katana slung fully BEHIND the back.
    const s: Skeleton = { legLen: 1.0, torsoH: 0.66, depth: 0.22, limbR: 0.095, upperArm: 0.4, foreArm: 0.38, thigh: 0.5, shin: 0.48, shoulderY: 0.58, shoulderZ: 0.36, legZ: 0.15 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x54d964), dark = rig.toon(0x2fa348), wrap = rig.toon(0x1e5a30), white = rig.toon(0xf2fff4), gold = rig.toon(0xffd94a);
    const j = rig.joints;
    ball(j.torso, body, 0.36, 0.4, 0.3, 0, 0.36, 0);             // slim chest
    box(j.torso, wrap, 0.3, 0.1, 0.34, 0.08, 0.2, 0, 0, -0.5);   // cross sash
    box(j.hips, wrap, 0.34, 0.13, 0.3, 0, 0, 0);                 // belt
    // Hooded head: dark eye-slit band + white eyes + BOLD gold headband.
    j.head.position.y = 0.82;
    ball(j.head, dark, 0.24, 0.25, 0.24, 0, 0, 0);
    box(j.head, wrap, 0.22, 0.1, 0.32, 0.1, 0.02, 0);            // slit band
    for (const zz of [-0.1, 0.1]) ball(j.head, white, 0.045, 0.05, 0.03, 0.24, 0.02, zz);
    box(j.head, gold, 0.3, 0.08, 0.36, 0.02, 0.15, 0);           // thick gold headband
    ball(j.head, gold, 0.07, 0.07, 0.07, -0.24, 0.13, 0);        // knot
    box(j.head, gold, 0.34, 0.07, 0.09, -0.42, 0.02, -0.05, 0, 0.5);  // gold tails flowing
    box(j.head, gold, 0.42, 0.06, 0.08, -0.48, -0.1, 0.06, 0, 0.75);
    // Katana sheath: vertical-diagonal in the BACK plane, clear of the body.
    const sheath = cylinder(j.torso, wrap, 0.05, 0.8, -0.44, 0.36, 0, 0.5, 0);
    ball(sheath, gold, 1.3, 0.05, 1.3, 0, 0.42, 0);              // sheath ring
    cylinder(j.torso, white, 0.035, 0.2, -0.44, 0.74, -0.2, 0.5, 0); // hilt over the shoulder
    limb(j.armL, j.foreArmL, dark, wrap, 0.095, 0.4, 0.38, 1.4, true);
    limb(j.armR, j.foreArmR, dark, wrap, 0.095, 0.4, 0.38, 1.4, true);
    limb(j.legL, j.shinL, dark, wrap, 0.105, 0.5, 0.48, 1.5, false);
    limb(j.legR, j.shinR, dark, wrap, 0.105, 0.5, 0.48, 1.5, false);
    // Shin wraps.
    for (const shin of [j.shinL, j.shinR]) box(shin, white, 0.12, 0.08, 0.12, 0, -0.3, 0, 0, 0.2);
    return;
  }
  if (chr === 'ace') {
    // Gunslinger: cowboy hat, poncho, star badge, holster.
    const s: Skeleton = { legLen: 1.02, torsoH: 0.7, depth: 0.25, limbR: 0.11, upperArm: 0.41, foreArm: 0.39, thigh: 0.51, shin: 0.49, shoulderY: 0.6, shoulderZ: 0.4, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xffa02e), dark = rig.toon(0xd4661a), leather = rig.toon(0x8a4a1e), sky = rig.toon(0x7adfff), gold = rig.toon(0xffe08a);
    const j = rig.joints;
    ball(j.torso, body, 0.4, 0.42, 0.34, 0, 0.38, 0);
    // Poncho: flat cone draped over the shoulders.
    cone(j.torso, dark, 0.52, 0.34, 0, 0.52, 0);
    ball(j.torso, gold, 0.06, 0.06, 0.03, 0.3, 0.44, -0.12);      // star badge spot
    box(j.hips, leather, 0.4, 0.14, 0.34, 0, 0, 0);               // gun belt
    ball(j.hips, gold, 0.07, 0.06, 0.03, 0.2, 0, 0);              // buckle
    box(j.hips, leather, 0.12, 0.2, 0.12, 0, -0.1, 0.22);         // holster
    // Head + magnificent hat.
    j.head.position.y = 0.88;
    ball(j.head, rig.toon(0xffd9a8), 0.22, 0.23, 0.22, 0, 0, 0);  // face
    for (const zz of [-0.09, 0.09]) ball(j.head, rig.toon(0x24457d), 0.035, 0.045, 0.03, 0.21, 0.04, zz);
    box(j.head, sky, 0.2, 0.06, 0.28, 0.02, -0.14, 0);            // bandana
    cylinder(j.head, leather, 0.34, 0.05, 0, 0.18, 0);            // hat brim
    cylinder(j.head, leather, 0.19, 0.18, 0, 0.28, 0);            // hat dome
    box(j.head, gold, 0.2, 0.045, 0.2, 0, 0.21, 0);               // hat band
    limb(j.armL, j.foreArmL, dark, leather, 0.11, 0.41, 0.39, 1.45, true);
    limb(j.armR, j.foreArmR, dark, leather, 0.11, 0.41, 0.39, 1.45, true);
    limb(j.legL, j.shinL, leather, dark, 0.12, 0.51, 0.49, 1.55, false);
    limb(j.legR, j.shinR, leather, dark, 0.12, 0.51, 0.49, 1.55, false);
    return;
  }
  if (chr === 'blaze') {
    // Fire dragonling: snout, swept horns, wing stubs, flame-tipped tail.
    const s: Skeleton = { legLen: 0.98, torsoH: 0.68, depth: 0.26, limbR: 0.105, upperArm: 0.42, foreArm: 0.4, thigh: 0.49, shin: 0.47, shoulderY: 0.58, shoulderZ: 0.4, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xff5a3c), dark = rig.toon(0xd42a1a), belly = rig.toon(0xffc93e), flame = rig.toon(0xffa03c);
    const j = rig.joints;
    ball(j.torso, body, 0.4, 0.44, 0.34, 0, 0.38, 0);
    ball(j.torso, belly, 0.28, 0.32, 0.26, 0.14, 0.32, 0);        // belly plate
    // Wing stubs off the back.
    for (const side of [-1, 1]) {
      box(j.torso, dark, 0.3, 0.06, 0.16, -0.3, 0.52, side * 0.2, side * -0.5, 0.6);
      box(j.torso, body, 0.2, 0.05, 0.12, -0.44, 0.62, side * 0.28, side * -0.5, 0.8);
    }
    // Flame-tipped tail.
    const tail = box(j.hips, dark, 0.5, 0.1, 0.1, -0.38, -0.04, 0, 0, 0.45);
    cone(tail, flame, 1.1, 2.2, -0.6, 0.35, 0, 0, -1.3);
    // Dragon head: snout + nostrils + swept horns + fire crest.
    j.head.position.y = 0.86;
    ball(j.head, body, 0.24, 0.22, 0.24, 0, 0, 0);
    box(j.head, body, 0.2, 0.12, 0.2, 0.22, -0.05, 0);            // snout
    box(j.head, dark, 0.06, 0.04, 0.05, 0.32, 0, -0.06);          // nostrils
    box(j.head, dark, 0.06, 0.04, 0.05, 0.32, 0, 0.06);
    for (const zz of [-0.1, 0.1]) ball(j.head, belly, 0.045, 0.05, 0.035, 0.18, 0.12, zz);
    cone(j.head, dark, 0.06, 0.24, -0.12, 0.14, -0.12, 0.5, 2.2); // swept horns
    cone(j.head, dark, 0.06, 0.24, -0.12, 0.14, 0.12, -0.5, 2.2);
    for (let i = 0; i < 3; i += 1) cone(j.head, flame, 0.05 - i * 0.01, 0.14, -0.04 - i * 0.09, 0.22 - i * 0.02, 0, 0, -0.5 - i * 0.4); // crest
    limb(j.armL, j.foreArmL, dark, belly, 0.105, 0.42, 0.4, 1.5, true);
    limb(j.armR, j.foreArmR, dark, belly, 0.105, 0.42, 0.4, 1.5, true);
    limb(j.legL, j.shinL, dark, belly, 0.115, 0.49, 0.47, 1.55, false);
    limb(j.legR, j.shinR, dark, belly, 0.115, 0.49, 0.47, 1.55, false);
    return;
  }
  if (chr === 'nova') {
    // COSMIC STAR HERO: cape, gold star emblem, crest-fin helmet, glowing
    // energy fists, big tilted halo. The floaty uppercut specialist.
    const s: Skeleton = { legLen: 1.06, torsoH: 0.7, depth: 0.24, limbR: 0.1, upperArm: 0.42, foreArm: 0.4, thigh: 0.53, shin: 0.51, shoulderY: 0.62, shoulderZ: 0.38, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xf5e9c8), gold = rig.toon(0xe8b93e), glow = rig.toon(0x66d9ff), white = rig.toon(0xffffff), navy = rig.toon(0x24457d);
    const j = rig.joints;
    ball(j.torso, white, 0.38, 0.44, 0.3, 0, 0.38, 0);
    box(j.torso, gold, 0.42, 0.1, 0.38, 0, 0.6, 0);               // gold collar
    box(j.hips, gold, 0.36, 0.12, 0.32, 0, 0, 0);                 // gold belt
    // 4-point STAR emblem on the chest.
    for (const r of [0, Math.PI / 2]) {
      const spike = new THREE.Mesh(CONE, gold);
      spike.scale.set(0.06, 0.14, 0.04); spike.position.set(0.28, 0.4, 0); spike.rotation.x = r;
      j.torso.add(spike);
      const spike2 = spike.clone(); spike2.rotation.x = r + Math.PI; j.torso.add(spike2);
    }
    ball(j.torso, glow, 0.07, 0.07, 0.05, 0.3, 0.4, 0);           // star core
    // CAPE: trailing angled panel off the shoulders.
    box(j.torso, gold, 0.1, 0.72, 0.5, -0.3, 0.16, 0, 0, 0.25);
    box(j.torso, rig.toon(0xd9a52e), 0.08, 0.5, 0.42, -0.42, -0.06, 0, 0, 0.35); // cape underside tier
    // Crest-fin helmet + visor + big tilted halo.
    j.head.position.y = 0.9;
    ball(j.head, body, 0.23, 0.24, 0.23, 0, 0, 0);
    box(j.head, navy, 0.2, 0.1, 0.34, 0.1, 0.02, 0);
    box(j.head, glow, 0.18, 0.06, 0.3, 0.13, 0.02, 0);            // visor glow
    box(j.head, gold, 0.26, 0.16, 0.05, -0.04, 0.2, 0, 0, -0.35); // crest fin
    const halo = new THREE.Mesh(RING, gold);
    halo.scale.setScalar(0.26); halo.rotation.x = Math.PI / 2.4; halo.position.set(-0.04, 0.44, 0);
    j.head.add(halo);
    // Gold gauntlets with GLOWING energy fists, gold boots.
    limb(j.armL, j.foreArmL, body, glow, 0.1, 0.42, 0.4, 1.55, true);
    limb(j.armR, j.foreArmR, body, glow, 0.1, 0.42, 0.4, 1.55, true);
    for (const fore of [j.foreArmL, j.foreArmR]) box(fore, gold, 0.14, 0.16, 0.14, 0, -0.18, 0);
    limb(j.legL, j.shinL, body, gold, 0.11, 0.53, 0.51, 1.5, false);
    limb(j.legR, j.shinR, body, gold, 0.11, 0.53, 0.51, 1.5, false);
    ball(j.armL, gold, 0.13, 0.11, 0.13, 0, 0.03, 0);             // shoulder orbs
    ball(j.armR, gold, 0.13, 0.11, 0.13, 0, 0.03, 0);
    return;
  }
  if (chr === 'shade') {
    // Phantom ninja: hood cone, void face with glowing pink eyes, tatters.
    const s: Skeleton = { legLen: 1.0, torsoH: 0.66, depth: 0.22, limbR: 0.09, upperArm: 0.4, foreArm: 0.38, thigh: 0.5, shin: 0.48, shoulderY: 0.58, shoulderZ: 0.36, legZ: 0.15 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x6f4fd8), dark = rig.toon(0x3a2a80), voidM = rig.toon(0x14102e), pink = rig.toon(0xff4fd8);
    const j = rig.joints;
    ball(j.torso, body, 0.36, 0.4, 0.3, 0, 0.36, 0);
    box(j.torso, dark, 0.3, 0.1, 0.34, 0.06, 0.18, 0, 0, 0.5);    // cross sash
    // Tattered cloak points hanging from the hips.
    for (const zz of [-0.14, 0, 0.14]) cone(j.hips, dark, 0.09, 0.26, -0.16, -0.16, zz, 0, 3.14);
    // Hood: cone over a void face, only glowing eyes visible.
    j.head.position.y = 0.84;
    cone(j.head, dark, 0.27, 0.4, -0.03, 0.12, 0);                // hood peak
    ball(j.head, voidM, 0.2, 0.21, 0.2, 0.04, -0.02, 0);          // void face
    for (const zz of [-0.09, 0.09]) ball(j.head, pink, 0.045, 0.055, 0.03, 0.2, 0, zz);
    // Twin dagger sheaths crossed on the back.
    cylinder(j.torso, voidM, 0.035, 0.4, -0.22, 0.34, 0.08, 0.4, 0.7);
    cylinder(j.torso, voidM, 0.035, 0.4, -0.22, 0.34, -0.08, -0.4, 0.7);
    limb(j.armL, j.foreArmL, dark, pink, 0.09, 0.4, 0.38, 1.35, true);
    limb(j.armR, j.foreArmR, dark, pink, 0.09, 0.4, 0.38, 1.35, true);
    limb(j.legL, j.shinL, dark, voidM, 0.1, 0.5, 0.48, 1.45, false);
    limb(j.legR, j.shinR, dark, voidM, 0.1, 0.5, 0.48, 1.45, false);
    return;
  }
  if (chr === 'titan') {
    // Industrial mech: the biggest — box chest, pistons, rivets, stripe head.
    const s: Skeleton = { legLen: 1.0, torsoH: 0.82, depth: 0.34, limbR: 0.16, upperArm: 0.48, foreArm: 0.46, thigh: 0.48, shin: 0.46, shoulderY: 0.7, shoulderZ: 0.56, legZ: 0.2 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x9aa7b8), dark = rig.toon(0x5a6a7d), orange = rig.toon(0xff8a3c), steel = rig.toon(0x3d4654);
    const j = rig.joints;
    box(j.torso, body, 0.72, 0.56, 0.56, 0, 0.42, 0);
    // Chest grill.
    for (let i = 0; i < 3; i += 1) box(j.torso, steel, 0.06, 0.34, 0.4, 0.34, 0.42, -0.14 + i * 0.14);
    box(j.hips, steel, 0.56, 0.18, 0.48, 0, 0, 0);
    // Rivets.
    for (const zz of [-0.24, 0.24]) for (const yy of [0.22, 0.62]) ball(j.torso, orange, 0.035, 0.035, 0.03, 0.36, yy, zz);
    // Flat-top head with warning stripe.
    j.head.position.y = 0.92;
    box(j.head, body, 0.32, 0.24, 0.34, 0, 0.02, 0);
    box(j.head, orange, 0.34, 0.06, 0.36, 0, 0.16, 0);            // stripe
    box(j.head, steel, 0.24, 0.09, 0.3, 0.14, -0.02, 0);
    box(j.head, orange, 0.22, 0.05, 0.26, 0.16, -0.02, 0);        // visor
    // Piston arms: cylinders alongside the upper arms; slab fists.
    limb(j.armL, j.foreArmL, dark, steel, 0.16, 0.48, 0.46, 1.6, true);
    limb(j.armR, j.foreArmR, dark, steel, 0.16, 0.48, 0.46, 1.6, true);
    for (const arm of [j.armL, j.armR]) {
      box(arm, body, 0.24, 0.2, 0.26, 0, 0.04, 0);
      cylinder(arm, orange, 0.05, 0.3, 0.14, -0.24, 0);
    }
    limb(j.legL, j.shinL, dark, steel, 0.17, 0.48, 0.46, 1.6, false);
    limb(j.legR, j.shinR, dark, steel, 0.17, 0.48, 0.46, 1.6, false);
    return;
  }
  if (chr === 'comet') {
    // Approved ninth fighter: a bright space cadet whose silhouette
    // is defined by a bubble helmet, compact jetpack, and puffy flight suit.
    const s: Skeleton = { legLen: 1.02, torsoH: 0.7, depth: 0.28, limbR: 0.12, upperArm: 0.4, foreArm: 0.38, thigh: 0.5, shin: 0.48, shoulderY: 0.62, shoulderZ: 0.42, legZ: 0.17 };
    buildSkeleton(rig, s);
    const suit = rig.toon(0xeaf0ff);
    const shell = rig.toon(0xc7d0f2);
    const blue = rig.toon(0x6578e8);
    const orange = rig.toon(0xff7a32);
    const visor = rig.toon(0x26345f);
    const glow = rig.toon(0x8fe9ff);
    const skin = rig.toon(0xffd4ad);
    const j = rig.joints;

    // Puffy flight suit, strong shoulder yoke, and a small chest controller.
    ball(j.torso, suit, 0.42, 0.46, 0.4, 0, 0.4, 0);
    box(j.torso, blue, 0.5, 0.1, 0.42, 0, 0.62, 0);
    box(j.torso, orange, 0.16, 0.16, 0.08, 0.28, 0.42, 0);
    ball(j.torso, glow, 0.05, 0.05, 0.03, 0.34, 0.46, 0);
    box(j.hips, blue, 0.44, 0.14, 0.36, 0, 0, 0);

    // Compact backpack and twin downward nozzles make the jetpack readable
    // from the same three-quarter angle used by the shipped roster.
    box(j.torso, shell, 0.24, 0.44, 0.32, -0.34, 0.42, 0);
    box(j.torso, orange, 0.12, 0.1, 0.14, -0.34, 0.56, 0);
    for (const zz of [-0.13, 0.13]) {
      cone(j.torso, orange, 0.07, 0.16, -0.42, 0.14, zz, Math.PI, 0);
    }

    // Bubble helmet with a visible face under a broad glowing visor.
    j.head.position.y = 0.86;
    ball(j.head, shell, 0.25, 0.25, 0.25, -0.03, 0.02, 0);
    ball(j.head, skin, 0.15, 0.16, 0.15, 0.11, -0.02, 0);
    box(j.head, visor, 0.14, 0.12, 0.3, 0.12, 0.05, 0);
    box(j.head, glow, 0.1, 0.06, 0.26, 0.16, 0.05, 0);
    box(j.head, orange, 0.18, 0.06, 0.24, -0.05, 0.2, 0);
    ball(j.head, orange, 0.045, 0.045, 0.045, -0.03, 0.25, 0);

    limb(j.armL, j.foreArmL, suit, orange, 0.12, 0.4, 0.38, 1.5, true);
    limb(j.armR, j.foreArmR, suit, orange, 0.12, 0.4, 0.38, 1.5, true);
    limb(j.legL, j.shinL, suit, orange, 0.13, 0.5, 0.48, 1.6, false);
    limb(j.legR, j.shinR, suit, orange, 0.13, 0.5, 0.48, 1.6, false);
    ball(j.armL, blue, 0.14, 0.12, 0.14, 0, 0.03, 0);
    ball(j.armR, blue, 0.14, 0.12, 0.14, 0, 0.03, 0);
    return;
  }
  if (chr === 'rex') {
    // NEW (awaiting family sign-off): teal T-rex bruiser — big jaws, orange
    // back-ridge plates, striped tail with a spike tip. Tail-spin finisher.
    const s: Skeleton = { legLen: 0.96, torsoH: 0.72, depth: 0.28, limbR: 0.12, upperArm: 0.44, foreArm: 0.42, thigh: 0.48, shin: 0.46, shoulderY: 0.6, shoulderZ: 0.44, legZ: 0.17 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x2fbf8f), dark = rig.toon(0x1a8a5f), belly = rig.toon(0xffe08a), accent = rig.toon(0xff8a3c), bone = rig.toon(0xfff3e0);
    const j = rig.joints;
    ball(j.torso, body, 0.42, 0.46, 0.36, 0, 0.38, 0);
    ball(j.torso, belly, 0.3, 0.34, 0.28, 0.16, 0.32, 0);
    for (let i = 0; i < 3; i += 1) cone(j.torso, accent, 0.07 - i * 0.01, 0.18, -0.34 - i * 0.08, 0.52 - i * 0.16, 0, 0, -1.8);
    const tail = box(j.hips, dark, 0.55, 0.13, 0.13, -0.42, -0.04, 0, 0, 0.45);
    cone(tail, accent, 0.9, 1.6, -0.62, 0.4, 0, 0, -1.25);
    // Dino head: skull + snout + underbite jaw full of teeth.
    j.head.position.y = 0.84;
    ball(j.head, body, 0.26, 0.24, 0.26, 0, 0.02, 0);
    box(j.head, body, 0.26, 0.13, 0.22, 0.24, 0, 0);
    box(j.head, dark, 0.24, 0.09, 0.2, 0.24, -0.13, 0);
    for (const zz of [-0.07, 0, 0.07]) cone(j.head, bone, 0.03, 0.08, 0.3, -0.055, zz, 3.14, 0);
    for (const zz of [-0.09, 0.09]) cone(j.head, bone, 0.035, 0.09, 0.34, -0.1, zz);
    ball(j.head, dark, 0.03, 0.025, 0.025, 0.37, 0.05, -0.05);
    ball(j.head, dark, 0.03, 0.025, 0.025, 0.37, 0.05, 0.05);
    for (const zz of [-0.12, 0.12]) ball(j.head, accent, 0.05, 0.055, 0.04, 0.16, 0.12, zz);
    box(j.head, dark, 0.14, 0.05, 0.28, 0.14, 0.17, 0);
    cone(j.head, accent, 0.05, 0.16, -0.14, 0.16, 0, 0, -0.6);
    limb(j.armL, j.foreArmL, body, dark, 0.12, 0.44, 0.42, 1.5, true);
    limb(j.armR, j.foreArmR, body, dark, 0.12, 0.44, 0.42, 1.5, true);
    limb(j.legL, j.shinL, dark, accent, 0.13, 0.48, 0.46, 1.6, false);
    limb(j.legR, j.shinR, dark, accent, 0.13, 0.48, 0.46, 1.6, false);
    return;
  }
  if (chr === 'frost') {
    // NEW (awaiting family sign-off): ice yeti heavy — huge furry shoulders,
    // blue face, icicle back spikes. Ground-slam finisher.
    const s: Skeleton = { legLen: 0.92, torsoH: 0.8, depth: 0.33, limbR: 0.155, upperArm: 0.5, foreArm: 0.48, thigh: 0.45, shin: 0.43, shoulderY: 0.7, shoulderZ: 0.54, legZ: 0.2 };
    buildSkeleton(rig, s);
    const fur = rig.toon(0xeef8ff), shade = rig.toon(0xc9e2f2), skin = rig.toon(0x7fc4e8), deep = rig.toon(0x3d78a8), ice = rig.toon(0x9df3ff);
    const j = rig.joints;
    ball(j.torso, fur, 0.5, 0.54, 0.46, 0, 0.4, 0.04);
    j.torso.rotation.z = -0.1;
    ball(j.torso, shade, 0.32, 0.38, 0.3, 0.2, 0.34, 0);
    ball(j.torso, ice, 0.07, 0.07, 0.045, 0.42, 0.42, 0);
    for (let i = 0; i < 3; i += 1) cone(j.torso, ice, 0.08 - i * 0.015, 0.22 - i * 0.04, -0.34 - i * 0.09, 0.56 - i * 0.16, 0, 0, -1.9);
    for (const arm of [j.armL, j.armR]) {
      ball(arm, fur, 0.21, 0.17, 0.21, 0, 0.04, 0);
      cone(arm, ice, 0.05, 0.14, 0, 0.21, 0);
    }
    // Blue face sunk into the fur, heavy brow, icicle-fang underbite.
    j.head.position.y = 1.02;
    j.head.position.x = 0.06;
    ball(j.head, fur, 0.27, 0.25, 0.27, 0, 0.02, 0);
    ball(j.head, skin, 0.17, 0.16, 0.18, 0.16, 0, 0);
    for (const zz of [-0.1, 0.1]) ball(j.head, deep, 0.045, 0.05, 0.03, 0.28, 0.06, zz);
    box(j.head, fur, 0.14, 0.07, 0.3, 0.2, 0.15, 0, 0, -0.1);
    box(j.head, skin, 0.2, 0.1, 0.28, 0.2, -0.16, 0);
    for (const zz of [-0.1, 0.1]) cone(j.head, ice, 0.035, 0.1, 0.28, -0.09, zz);
    cone(j.head, fur, 0.08, 0.18, -0.02, 0.26, 0, 0, -0.3);
    limb(j.armL, j.foreArmL, fur, skin, 0.155, 0.5, 0.48, 1.7, true);
    limb(j.armR, j.foreArmR, fur, skin, 0.155, 0.5, 0.48, 1.7, true);
    limb(j.legL, j.shinL, shade, skin, 0.15, 0.45, 0.43, 1.55, false);
    limb(j.legR, j.shinR, shade, skin, 0.15, 0.45, 0.43, 1.55, false);
    return;
  }
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
    // Head raised clear of the chest (no neck), underbite jaw at the chin.
    j.head.position.y = 1.1;
    j.head.position.x = 0.08;
    ball(j.head, body, 0.28, 0.26, 0.28, 0.04, 0, 0);
    box(j.head, dark, 0.24, 0.11, 0.34, 0.16, -0.2, 0);      // jaw under the chin
    for (const zz of [-0.11, 0.11]) cone(j.head, bone, 0.04, 0.1, 0.26, -0.12, zz); // teeth up past the lip
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

export function buildMockRig(chr: CharId): MockRig {
  const rig = new MockRig();
  buildC(rig, chr);
  return rig;
}
