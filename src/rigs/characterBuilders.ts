/**
 * The 8 playable fighters — "Action Figure" designs (direction C, picked by
 * Ryder in the Character Lab): taller athletic figures, armor & muscle,
 * signature heads and gear. HeroRig implements the full game Rig contract
 * (flash tints, ghost opacity, blob shadow, weapon socket, facing turns).
 *
 * Visual heights are normalized to each character's proportions.height so
 * physics bodies and hitboxes stay aligned.
 *
 * The Character Lab (src/mockup/rigs.ts, served at /mockup.html) holds a
 * frozen snapshot of these designs for side-by-side review — it does NOT
 * import this file. Redesign flow: iterate in the Lab, get family sign-off,
 * then port the geometry here.
 */
import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { makeToonMaterial } from '../render/toon';
import type { CharacterDef } from '../data/types';
import type { Rig } from './FighterRig';
import type { JointName, Pose } from './poses';

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const RING = new THREE.TorusGeometry(1, 0.14, 8, 22);
const SHADOW_CIRCLE = new THREE.CircleGeometry(1, 24);

const JOINTS: readonly JointName[] = [
  'hips', 'torso', 'head', 'armL', 'armR', 'foreArmL', 'foreArmR',
  'legL', 'legR', 'shinL', 'shinR', 'root',
];

/** All builders sculpt at this height; the rig scales to the character's. */
const DESIGN_HEIGHT = 2.15;

export class HeroRig implements Rig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Object3D>;
  readonly weaponSocket = new THREE.Group();

  private readonly materials: THREE.Material[] = [];
  private readonly tintMaterials: { material: THREE.MeshToonMaterial; base: THREE.Color }[] = [];
  private readonly flash = new THREE.Color(0xffffff);
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly inner = new THREE.Group();
  private flashTimer = 0;
  private flashDuration = 0;
  private facingTarget: 1 | -1 = 1;
  private facingAngle = 0;
  private ghostAlpha = 1;

  constructor(def: CharacterDef) {
    // The inner group carries the design-scale build; scaled to game height.
    const s = def.proportions.height / DESIGN_HEIGHT;
    this.inner.scale.setScalar(s);
    this.root.add(this.inner);

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1b2a3a,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.materials.push(this.shadowMat);
    this.shadow = new THREE.Mesh(SHADOW_CIRCLE, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(0.34 * def.proportions.bulk + 0.14, 0.24 * def.proportions.bulk + 0.1, 1);
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);
  }

  /** Design-space parent for builders. */
  get body(): THREE.Group {
    return this.inner;
  }

  toon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push(material);
    this.tintMaterials.push({ material, base: material.color.clone() });
    return material;
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
    this.shadow.rotation.z = -this.root.rotation.z;
  }

  setFacing(f: 1 | -1): void {
    this.facingTarget = f;
  }

  setShadow(groundLocalY: number | null, airborneT: number): void {
    if (groundLocalY === null) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    this.shadow.position.y = groundLocalY + 0.12;
    const sc = 1 - 0.45 * clamp(airborneT, 0, 1);
    this.shadow.scale.setScalar(sc);
    this.shadowMat.opacity = 0.28 * (1 - 0.6 * clamp(airborneT, 0, 1)) * this.ghostAlpha;
  }

  flashColor(color: number, seconds: number): void {
    this.flash.setHex(color, THREE.SRGBColorSpace);
    this.flashTimer = Math.max(0, seconds);
    this.flashDuration = Math.max(0.0001, seconds);
    for (const entry of this.tintMaterials) entry.material.color.copy(this.flash);
  }

  setGhostOpacity(alpha: number): void {
    this.ghostAlpha = clamp(alpha, 0, 1);
    for (const material of this.materials) {
      material.transparent = true;
      material.opacity = material === this.shadowMat ? this.shadowMat.opacity : this.ghostAlpha;
      if (material !== this.shadowMat) material.depthWrite = this.ghostAlpha >= 0.95;
    }
  }

  update(dt: number): void {
    this.facingAngle = damp(this.facingAngle, this.facingTarget === 1 ? 0 : Math.PI, 28, dt);
    this.root.rotation.y = this.facingAngle;

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = 1 - this.flashTimer / this.flashDuration;
      for (const entry of this.tintMaterials) entry.material.color.copy(this.flash).lerp(entry.base, t);
    } else {
      for (const entry of this.tintMaterials) entry.material.color.copy(entry.base);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const material of this.materials) material.dispose();
  }
}

function angleLerp(current: number, target: number, amount: number): number {
  const TWO_PI = Math.PI * 2;
  let delta = (target - current) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return current + delta * amount;
}

// ---------------------------------------------------------------------------
// Geometry helpers (design space)
// ---------------------------------------------------------------------------
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
function cylinder(parent: THREE.Object3D, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(CYL, mat);
  m.scale.set(r, h, r); m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  parent.add(m); return m;
}

interface Skeleton {
  legLen: number; torsoH: number; depth: number; limbR: number;
  upperArm: number; foreArm: number; thigh: number; shin: number;
  shoulderY: number; shoulderZ: number; legZ: number;
}

function buildSkeleton(rig: HeroRig, s: Skeleton): void {
  const g = (): THREE.Group => new THREE.Group();
  const hips = g(), torso = g(), head = g();
  const restL = g(), restR = g(), armL = g(), armR = g(), foreArmL = g(), foreArmR = g();
  const legL = g(), legR = g(), shinL = g(), shinR = g();

  hips.position.y = s.legLen;
  rig.body.add(hips);
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

  // Weapon socket at the right fist.
  foreArmR.add(rig.weaponSocket);
  rig.weaponSocket.position.set(0, -s.foreArm, s.depth * 0.5);

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
// The nine fighters (geometry approved in the Character Lab)
// ---------------------------------------------------------------------------
type Builder = (rig: HeroRig) => void;

const BUILDERS: Record<string, Builder> = {
  volt(rig) {
    const s: Skeleton = { legLen: 1.05, torsoH: 0.72, depth: 0.26, limbR: 0.115, upperArm: 0.42, foreArm: 0.4, thigh: 0.52, shin: 0.5, shoulderY: 0.64, shoulderZ: 0.44, legZ: 0.17 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x3fb8ff), dark = rig.toon(0x1f6fd8), accent = rig.toon(0xffd94a), glow = rig.toon(0x9ff2ff), navy = rig.toon(0x24457d);
    const j = rig.joints;
    box(j.torso, body, 0.6, 0.44, 0.46, 0, 0.44, 0);
    box(j.torso, dark, 0.44, 0.26, 0.4, 0, 0.14, 0);
    box(j.torso, glow, 0.06, 0.34, 0.5, 0.24, 0.4, 0);
    box(j.hips, navy, 0.44, 0.16, 0.38, 0, 0, 0);
    for (const arm of [j.armL, j.armR]) box(arm, dark, 0.24, 0.16, 0.26, 0, 0.06, 0, 0, 0.15);
    j.head.position.y = 0.86;
    ball(j.head, body, 0.24, 0.26, 0.24, 0, 0, 0);
    box(j.head, navy, 0.2, 0.09, 0.3, 0.12, 0.03, 0);
    box(j.head, glow, 0.18, 0.05, 0.26, 0.15, 0.03, 0);
    cone(j.head, accent, 0.03, 0.14, -0.08, 0.24, 0, 0.3, 0);
    for (const zz of [-0.12, 0.12]) box(j.torso, accent, 0.08, 0.18, 0.08, -0.3, 0.4, zz);
    limb(j.armL, j.foreArmL, rig.toon(0x2f8fe0), dark, 0.115, 0.42, 0.4, 1.45, true);
    limb(j.armR, j.foreArmR, rig.toon(0x2f8fe0), dark, 0.115, 0.42, 0.4, 1.45, true);
    limb(j.legL, j.shinL, dark, navy, 0.13, 0.52, 0.5, 1.6, false);
    limb(j.legR, j.shinR, dark, navy, 0.13, 0.52, 0.5, 1.6, false);
  },

  kaze(rig) {
    const s: Skeleton = { legLen: 1.0, torsoH: 0.66, depth: 0.22, limbR: 0.095, upperArm: 0.4, foreArm: 0.38, thigh: 0.5, shin: 0.48, shoulderY: 0.58, shoulderZ: 0.36, legZ: 0.15 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x54d964), dark = rig.toon(0x2fa348), wrap = rig.toon(0x1e5a30), white = rig.toon(0xf2fff4), gold = rig.toon(0xffd94a);
    const j = rig.joints;
    ball(j.torso, body, 0.36, 0.4, 0.3, 0, 0.36, 0);
    box(j.torso, wrap, 0.3, 0.1, 0.34, 0.08, 0.2, 0, 0, -0.5);
    box(j.hips, wrap, 0.34, 0.13, 0.3, 0, 0, 0);
    j.head.position.y = 0.82;
    ball(j.head, dark, 0.24, 0.25, 0.24, 0, 0, 0);
    box(j.head, wrap, 0.22, 0.1, 0.32, 0.1, 0.02, 0);
    for (const zz of [-0.1, 0.1]) ball(j.head, white, 0.045, 0.05, 0.03, 0.24, 0.02, zz);
    box(j.head, gold, 0.3, 0.08, 0.36, 0.02, 0.15, 0);
    ball(j.head, gold, 0.07, 0.07, 0.07, -0.24, 0.13, 0);
    box(j.head, gold, 0.34, 0.07, 0.09, -0.42, 0.02, -0.05, 0, 0.5);
    box(j.head, gold, 0.42, 0.06, 0.08, -0.48, -0.1, 0.06, 0, 0.75);
    const sheath = cylinder(j.torso, wrap, 0.05, 0.8, -0.44, 0.36, 0, 0.5, 0);
    ball(sheath, gold, 1.3, 0.05, 1.3, 0, 0.42, 0);
    cylinder(j.torso, white, 0.035, 0.2, -0.44, 0.74, -0.2, 0.5, 0);
    limb(j.armL, j.foreArmL, dark, wrap, 0.095, 0.4, 0.38, 1.4, true);
    limb(j.armR, j.foreArmR, dark, wrap, 0.095, 0.4, 0.38, 1.4, true);
    limb(j.legL, j.shinL, dark, wrap, 0.105, 0.5, 0.48, 1.5, false);
    limb(j.legR, j.shinR, dark, wrap, 0.105, 0.5, 0.48, 1.5, false);
    for (const shin of [j.shinL, j.shinR]) box(shin, white, 0.12, 0.08, 0.12, 0, -0.3, 0, 0, 0.2);
  },

  grim(rig) {
    const s: Skeleton = { legLen: 0.9, torsoH: 0.78, depth: 0.32, limbR: 0.15, upperArm: 0.5, foreArm: 0.48, thigh: 0.44, shin: 0.42, shoulderY: 0.7, shoulderZ: 0.5, legZ: 0.19 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xb06ef5), dark = rig.toon(0x7a3fc4), bone = rig.toon(0xfff3e0), accent = rig.toon(0xffd23e);
    const j = rig.joints;
    ball(j.torso, body, 0.5, 0.52, 0.44, 0, 0.4, 0.06);
    j.torso.rotation.z = -0.14;
    for (const arm of [j.armL, j.armR]) {
      ball(arm, dark, 0.2, 0.16, 0.2, 0, 0.04, 0);
      cone(arm, bone, 0.06, 0.16, 0, 0.2, 0);
    }
    const tail = box(j.hips, dark, 0.5, 0.12, 0.12, -0.4, -0.05, 0, 0, 0.5);
    cone(tail, bone, 0.8, 1.2, -0.62, 0.4, 0, 0, -1.2);
    j.head.position.y = 1.1;
    j.head.position.x = 0.08;
    ball(j.head, body, 0.28, 0.26, 0.28, 0.04, 0, 0);
    box(j.head, dark, 0.24, 0.11, 0.34, 0.16, -0.2, 0);
    for (const zz of [-0.11, 0.11]) cone(j.head, bone, 0.04, 0.1, 0.26, -0.12, zz);
    for (const zz of [-0.13, 0.13]) ball(j.head, accent, 0.05, 0.055, 0.04, 0.26, 0.08, zz);
    cone(j.head, bone, 0.09, 0.32, -0.06, 0.22, -0.22, 0.5, 0.7);
    cone(j.head, bone, 0.09, 0.32, -0.06, 0.22, 0.22, -0.5, 0.7);
    limb(j.armL, j.foreArmL, dark, body, 0.16, 0.5, 0.48, 1.7, true);
    limb(j.armR, j.foreArmR, dark, body, 0.16, 0.5, 0.48, 1.7, true);
    limb(j.legL, j.shinL, dark, accent, 0.14, 0.44, 0.42, 1.5, false);
    limb(j.legR, j.shinR, dark, accent, 0.14, 0.44, 0.42, 1.5, false);
  },

  ace(rig) {
    const s: Skeleton = { legLen: 1.02, torsoH: 0.7, depth: 0.25, limbR: 0.11, upperArm: 0.41, foreArm: 0.39, thigh: 0.51, shin: 0.49, shoulderY: 0.6, shoulderZ: 0.4, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xffa02e), dark = rig.toon(0xd4661a), leather = rig.toon(0x8a4a1e), sky = rig.toon(0x7adfff), gold = rig.toon(0xffe08a);
    const j = rig.joints;
    ball(j.torso, body, 0.4, 0.42, 0.34, 0, 0.38, 0);
    cone(j.torso, dark, 0.52, 0.34, 0, 0.52, 0);
    ball(j.torso, gold, 0.06, 0.06, 0.03, 0.3, 0.44, -0.12);
    box(j.hips, leather, 0.4, 0.14, 0.34, 0, 0, 0);
    ball(j.hips, gold, 0.07, 0.06, 0.03, 0.2, 0, 0);
    box(j.hips, leather, 0.12, 0.2, 0.12, 0, -0.1, 0.22);
    j.head.position.y = 0.88;
    ball(j.head, rig.toon(0xffd9a8), 0.22, 0.23, 0.22, 0, 0, 0);
    for (const zz of [-0.09, 0.09]) ball(j.head, rig.toon(0x24457d), 0.035, 0.045, 0.03, 0.21, 0.04, zz);
    box(j.head, sky, 0.2, 0.06, 0.28, 0.02, -0.14, 0);
    cylinder(j.head, leather, 0.34, 0.05, 0, 0.18, 0);
    cylinder(j.head, leather, 0.19, 0.18, 0, 0.28, 0);
    box(j.head, gold, 0.2, 0.045, 0.2, 0, 0.21, 0);
    limb(j.armL, j.foreArmL, dark, leather, 0.11, 0.41, 0.39, 1.45, true);
    limb(j.armR, j.foreArmR, dark, leather, 0.11, 0.41, 0.39, 1.45, true);
    limb(j.legL, j.shinL, leather, dark, 0.12, 0.51, 0.49, 1.55, false);
    limb(j.legR, j.shinR, leather, dark, 0.12, 0.51, 0.49, 1.55, false);
  },

  blaze(rig) {
    const s: Skeleton = { legLen: 0.98, torsoH: 0.68, depth: 0.26, limbR: 0.105, upperArm: 0.42, foreArm: 0.4, thigh: 0.49, shin: 0.47, shoulderY: 0.58, shoulderZ: 0.4, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xff5a3c), dark = rig.toon(0xd42a1a), belly = rig.toon(0xffc93e), flame = rig.toon(0xffa03c);
    const j = rig.joints;
    ball(j.torso, body, 0.4, 0.44, 0.34, 0, 0.38, 0);
    ball(j.torso, belly, 0.28, 0.32, 0.26, 0.14, 0.32, 0);
    for (const side of [-1, 1]) {
      box(j.torso, dark, 0.3, 0.06, 0.16, -0.3, 0.52, side * 0.2, side * -0.5, 0.6);
      box(j.torso, body, 0.2, 0.05, 0.12, -0.44, 0.62, side * 0.28, side * -0.5, 0.8);
    }
    const tail = box(j.hips, dark, 0.5, 0.1, 0.1, -0.38, -0.04, 0, 0, 0.45);
    cone(tail, flame, 1.1, 2.2, -0.6, 0.35, 0, 0, -1.3);
    j.head.position.y = 0.86;
    ball(j.head, body, 0.24, 0.22, 0.24, 0, 0, 0);
    box(j.head, body, 0.2, 0.12, 0.2, 0.22, -0.05, 0);
    box(j.head, dark, 0.06, 0.04, 0.05, 0.32, 0, -0.06);
    box(j.head, dark, 0.06, 0.04, 0.05, 0.32, 0, 0.06);
    for (const zz of [-0.1, 0.1]) ball(j.head, belly, 0.045, 0.05, 0.035, 0.18, 0.12, zz);
    cone(j.head, dark, 0.06, 0.24, -0.12, 0.14, -0.12, 0.5, 2.2);
    cone(j.head, dark, 0.06, 0.24, -0.12, 0.14, 0.12, -0.5, 2.2);
    for (let i = 0; i < 3; i += 1) cone(j.head, flame, 0.05 - i * 0.01, 0.14, -0.04 - i * 0.09, 0.22 - i * 0.02, 0, 0, -0.5 - i * 0.4);
    limb(j.armL, j.foreArmL, dark, belly, 0.105, 0.42, 0.4, 1.5, true);
    limb(j.armR, j.foreArmR, dark, belly, 0.105, 0.42, 0.4, 1.5, true);
    limb(j.legL, j.shinL, dark, belly, 0.115, 0.49, 0.47, 1.55, false);
    limb(j.legR, j.shinR, dark, belly, 0.115, 0.49, 0.47, 1.55, false);
  },

  nova(rig) {
    const s: Skeleton = { legLen: 1.06, torsoH: 0.7, depth: 0.24, limbR: 0.1, upperArm: 0.42, foreArm: 0.4, thigh: 0.53, shin: 0.51, shoulderY: 0.62, shoulderZ: 0.38, legZ: 0.16 };
    buildSkeleton(rig, s);
    const body = rig.toon(0xf5e9c8), gold = rig.toon(0xe8b93e), glow = rig.toon(0x66d9ff), white = rig.toon(0xffffff), navy = rig.toon(0x24457d);
    const j = rig.joints;
    ball(j.torso, white, 0.38, 0.44, 0.3, 0, 0.38, 0);
    box(j.torso, gold, 0.42, 0.1, 0.38, 0, 0.6, 0);
    box(j.hips, gold, 0.36, 0.12, 0.32, 0, 0, 0);
    for (const r of [0, Math.PI / 2]) {
      const spike = new THREE.Mesh(CONE, gold);
      spike.scale.set(0.06, 0.14, 0.04); spike.position.set(0.28, 0.4, 0); spike.rotation.x = r;
      j.torso.add(spike);
      const spike2 = spike.clone(); spike2.rotation.x = r + Math.PI; j.torso.add(spike2);
    }
    ball(j.torso, glow, 0.07, 0.07, 0.05, 0.3, 0.4, 0);
    box(j.torso, gold, 0.1, 0.72, 0.5, -0.3, 0.16, 0, 0, 0.25);
    box(j.torso, rig.toon(0xd9a52e), 0.08, 0.5, 0.42, -0.42, -0.06, 0, 0, 0.35);
    j.head.position.y = 0.9;
    ball(j.head, body, 0.23, 0.24, 0.23, 0, 0, 0);
    box(j.head, navy, 0.2, 0.1, 0.34, 0.1, 0.02, 0);
    box(j.head, glow, 0.18, 0.06, 0.3, 0.13, 0.02, 0);
    box(j.head, gold, 0.26, 0.16, 0.05, -0.04, 0.2, 0, 0, -0.35);
    const halo = new THREE.Mesh(RING, gold);
    halo.scale.setScalar(0.26); halo.rotation.x = Math.PI / 2.4; halo.position.set(-0.04, 0.44, 0);
    j.head.add(halo);
    limb(j.armL, j.foreArmL, body, glow, 0.1, 0.42, 0.4, 1.55, true);
    limb(j.armR, j.foreArmR, body, glow, 0.1, 0.42, 0.4, 1.55, true);
    for (const fore of [j.foreArmL, j.foreArmR]) box(fore, gold, 0.14, 0.16, 0.14, 0, -0.18, 0);
    limb(j.legL, j.shinL, body, gold, 0.11, 0.53, 0.51, 1.5, false);
    limb(j.legR, j.shinR, body, gold, 0.11, 0.53, 0.51, 1.5, false);
    ball(j.armL, gold, 0.13, 0.11, 0.13, 0, 0.03, 0);
    ball(j.armR, gold, 0.13, 0.11, 0.13, 0, 0.03, 0);
  },

  shade(rig) {
    const s: Skeleton = { legLen: 1.0, torsoH: 0.66, depth: 0.22, limbR: 0.09, upperArm: 0.4, foreArm: 0.38, thigh: 0.5, shin: 0.48, shoulderY: 0.58, shoulderZ: 0.36, legZ: 0.15 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x6f4fd8), dark = rig.toon(0x3a2a80), voidM = rig.toon(0x14102e), pink = rig.toon(0xff4fd8);
    const j = rig.joints;
    ball(j.torso, body, 0.36, 0.4, 0.3, 0, 0.36, 0);
    box(j.torso, dark, 0.3, 0.1, 0.34, 0.06, 0.18, 0, 0, 0.5);
    for (const zz of [-0.14, 0, 0.14]) cone(j.hips, dark, 0.09, 0.26, -0.16, -0.16, zz, 0, 3.14);
    j.head.position.y = 0.84;
    cone(j.head, dark, 0.27, 0.4, -0.03, 0.12, 0);
    ball(j.head, voidM, 0.2, 0.21, 0.2, 0.04, -0.02, 0);
    for (const zz of [-0.09, 0.09]) ball(j.head, pink, 0.045, 0.055, 0.03, 0.2, 0, zz);
    cylinder(j.torso, voidM, 0.035, 0.4, -0.22, 0.34, 0.08, 0.4, 0.7);
    cylinder(j.torso, voidM, 0.035, 0.4, -0.22, 0.34, -0.08, -0.4, 0.7);
    limb(j.armL, j.foreArmL, dark, pink, 0.09, 0.4, 0.38, 1.35, true);
    limb(j.armR, j.foreArmR, dark, pink, 0.09, 0.4, 0.38, 1.35, true);
    limb(j.legL, j.shinL, dark, voidM, 0.1, 0.5, 0.48, 1.45, false);
    limb(j.legR, j.shinR, dark, voidM, 0.1, 0.5, 0.48, 1.45, false);
  },

  titan(rig) {
    const s: Skeleton = { legLen: 1.0, torsoH: 0.82, depth: 0.34, limbR: 0.16, upperArm: 0.48, foreArm: 0.46, thigh: 0.48, shin: 0.46, shoulderY: 0.7, shoulderZ: 0.56, legZ: 0.2 };
    buildSkeleton(rig, s);
    const body = rig.toon(0x9aa7b8), dark = rig.toon(0x5a6a7d), orange = rig.toon(0xff8a3c), steel = rig.toon(0x3d4654);
    const j = rig.joints;
    box(j.torso, body, 0.72, 0.56, 0.56, 0, 0.42, 0);
    for (let i = 0; i < 3; i += 1) box(j.torso, steel, 0.06, 0.34, 0.4, 0.34, 0.42, -0.14 + i * 0.14);
    box(j.hips, steel, 0.56, 0.18, 0.48, 0, 0, 0);
    for (const zz of [-0.24, 0.24]) for (const yy of [0.22, 0.62]) ball(j.torso, orange, 0.035, 0.035, 0.03, 0.36, yy, zz);
    j.head.position.y = 0.92;
    box(j.head, body, 0.32, 0.24, 0.34, 0, 0.02, 0);
    box(j.head, orange, 0.34, 0.06, 0.36, 0, 0.16, 0);
    box(j.head, steel, 0.24, 0.09, 0.3, 0.14, -0.02, 0);
    box(j.head, orange, 0.22, 0.05, 0.26, 0.16, -0.02, 0);
    limb(j.armL, j.foreArmL, dark, steel, 0.16, 0.48, 0.46, 1.6, true);
    limb(j.armR, j.foreArmR, dark, steel, 0.16, 0.48, 0.46, 1.6, true);
    for (const arm of [j.armL, j.armR]) {
      box(arm, body, 0.24, 0.2, 0.26, 0, 0.04, 0);
      cylinder(arm, orange, 0.05, 0.3, 0.14, -0.24, 0);
    }
    limb(j.legL, j.shinL, dark, steel, 0.17, 0.48, 0.46, 1.6, false);
    limb(j.legR, j.shinR, dark, steel, 0.17, 0.48, 0.46, 1.6, false);
  },

  comet(rig) {
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

    ball(j.torso, suit, 0.42, 0.46, 0.4, 0, 0.4, 0);
    box(j.torso, blue, 0.5, 0.1, 0.42, 0, 0.62, 0);
    box(j.torso, orange, 0.16, 0.16, 0.08, 0.28, 0.42, 0);
    ball(j.torso, glow, 0.05, 0.05, 0.03, 0.34, 0.46, 0);
    box(j.hips, blue, 0.44, 0.14, 0.36, 0, 0, 0);

    box(j.torso, shell, 0.24, 0.44, 0.32, -0.34, 0.42, 0);
    box(j.torso, orange, 0.12, 0.1, 0.14, -0.34, 0.56, 0);
    for (const zz of [-0.13, 0.13]) {
      cone(j.torso, orange, 0.07, 0.16, -0.42, 0.14, zz, Math.PI, 0);
    }

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
  },
};

/** Build a playable character's rig (falls back to volt's builder shape). */
export function buildCharacterRig(def: CharacterDef): Rig {
  const rig = new HeroRig(def);
  (BUILDERS[def.id] ?? BUILDERS.volt!)(rig);
  return rig;
}
