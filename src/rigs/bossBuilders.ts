import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { BossDef, BossId } from '../data/types';
import { makeToonMaterial } from '../render/toon';
import type { MobRig } from './enemyBuilders';
import type { JointName, Pose } from './poses';

export type BossRig = MobRig & {
  setAngry?: (on: boolean) => void;
};

type MaterialEntry = { material: THREE.Material; opacity: number };
type TintEntry = { material: THREE.MeshToonMaterial; base: THREE.Color; opacity: number };

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

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 24, 16);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 5, 14);
const CONE = new THREE.ConeGeometry(1, 1, 22);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 28);
const SHADOW_CIRCLE = new THREE.CircleGeometry(1, 28);

const DARK = 0x242633;
const BONE = 0xfff6df;
const GOLD = 0xffd23e;
const CAPE_RED = 0xe83d55;
const ORANGE = 0xff8a1e;
const EAGLE_BROWN = 0x8b4a24;
const EAGLE_CREAM = 0xfff0bf;
const ANGRY_RED = 0xff3048;

export function buildBossRig(id: BossId, def: BossDef): MobRig {
  switch (id) {
    case 'skeletonKing':
      return new SkeletonKingRig(def);
    case 'giantGhost':
      return new GiantGhostRig(def);
    case 'giantEagle':
      return new GiantEagleRig(def);
  }
}

abstract class BossRigBase implements BossRig {
  readonly root = new THREE.Group();
  readonly joints: Partial<Record<JointName, THREE.Object3D>> = {};

  protected readonly poseRoot = new THREE.Group();
  protected readonly bodyRoot = new THREE.Group();
  protected readonly materials: MaterialEntry[] = [];
  protected readonly tintMaterials: TintEntry[] = [];
  protected readonly flash = new THREE.Color(0xffffff);
  protected readonly shadow: THREE.Mesh;
  protected readonly shadowMat: THREE.MeshBasicMaterial;

  private readonly baseShadowX: number;
  private readonly baseShadowY: number;
  private readonly baseShadowOpacity: number;
  private flashTimer = 0;
  private flashDuration = 0;
  private facingTarget: 1 | -1 = 1;
  private facingScale = 1;
  private ghostAlpha = 1;
  private animTime = 0;

  protected constructor(
    shadowX: number,
    shadowY: number,
    shadowOpacity: number,
    private readonly bobAmp: number,
    private readonly bobSpeed: number,
  ) {
    this.baseShadowX = shadowX;
    this.baseShadowY = shadowY;
    this.baseShadowOpacity = shadowOpacity;
    this.root.add(this.poseRoot);
    this.poseRoot.add(this.bodyRoot);
    this.joints.root = this.poseRoot;

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1b2a3a,
      transparent: true,
      opacity: shadowOpacity,
      depthWrite: false,
    });
    this.materials.push({ material: this.shadowMat, opacity: shadowOpacity });
    this.shadow = new THREE.Mesh(SHADOW_CIRCLE, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(shadowX, shadowY, 1);
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);
  }

  setPose(pose: Pose, blend: number): void {
    const amount = clamp(blend, 0, 1);
    for (let i = 0; i < JOINTS.length; i += 1) {
      const name = JOINTS[i]!;
      const joint = this.joints[name];
      if (!joint) continue;
      const target = pose[name];
      joint.rotation.x = lerp(joint.rotation.x, target?.x ?? 0, amount);
      joint.rotation.y = lerp(joint.rotation.y, target?.y ?? 0, amount);
      joint.rotation.z = lerp(joint.rotation.z, target?.z ?? 0, amount);
    }

    const torsoZ = pose.torso?.z ?? 0;
    const rootZ = pose.root?.z ?? 0;
    const armLZ = pose.armL?.z ?? 0;
    const armRZ = pose.armR?.z ?? 0;
    const windup = torsoZ > 0.3 || armLZ > 1.5 || armRZ > 1.5 ? 1 : 0;
    const active = torsoZ < -0.25 || rootZ > 0.18 || rootZ < -0.18 ? 1 : 0;
    this.poseRoot.scale.x = lerp(this.poseRoot.scale.x, 1 + windup * 0.1 + active * 0.14, amount);
    this.poseRoot.scale.y = lerp(this.poseRoot.scale.y, 1 - windup * 0.12 + active * 0.12, amount);
    this.poseRoot.scale.z = lerp(this.poseRoot.scale.z, 1 + windup * 0.08, amount);
    this.afterPose(pose, amount);
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
    const air = clamp(airborneT, 0, 1);
    const s = 1 - 0.45 * air;
    this.shadow.position.y = groundLocalY + 0.08;
    this.shadow.scale.set(this.baseShadowX * s, this.baseShadowY * s, 1);
    this.shadowMat.opacity = this.baseShadowOpacity * (1 - 0.55 * air) * this.ghostAlpha;
  }

  flashColor(color: number, seconds: number): void {
    this.flash.setHex(color, THREE.SRGBColorSpace);
    this.flashTimer = Math.max(0, seconds);
    this.flashDuration = Math.max(0.0001, seconds);
    for (let i = 0; i < this.tintMaterials.length; i += 1) {
      this.tintMaterials[i]!.material.color.copy(this.flash);
    }
  }

  setGhostOpacity(alpha: number): void {
    this.ghostAlpha = clamp(alpha, 0, 1);
    this.syncMaterialOpacity();
  }

  update(dt: number): void {
    this.animTime += dt;
    this.facingScale = damp(this.facingScale, this.facingTarget, 28, dt);
    this.root.scale.x = this.facingScale;
    this.bodyRoot.position.y = Math.sin(this.animTime * this.bobSpeed) * this.bobAmp;
    this.updateCustom(dt, this.animTime);

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = 1 - this.flashTimer / this.flashDuration;
      for (let i = 0; i < this.tintMaterials.length; i += 1) {
        const entry = this.tintMaterials[i]!;
        entry.material.color.copy(this.flash).lerp(entry.base, t);
        entry.material.opacity = entry.opacity * this.ghostAlpha;
      }
      return;
    }

    for (let i = 0; i < this.tintMaterials.length; i += 1) {
      const entry = this.tintMaterials[i]!;
      entry.material.color.copy(entry.base);
      entry.material.opacity = entry.opacity * this.ghostAlpha;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (let i = 0; i < this.materials.length; i += 1) {
      this.materials[i]!.material.dispose();
    }
  }

  protected makeToon(color: number, opacity = 1): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    material.transparent = opacity < 0.98;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.95;
    this.materials.push({ material, opacity });
    this.tintMaterials.push({ material, base: material.color.clone(), opacity });
    return material;
  }

  protected makeBasic(color: number, opacity = 1): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 0.98,
      opacity,
      depthWrite: opacity >= 0.95,
    });
    this.materials.push({ material, opacity });
    return material;
  }

  protected afterPose(_pose: Pose, _amount: number): void {}

  protected updateCustom(_dt: number, _time: number): void {}

  private syncMaterialOpacity(): void {
    for (let i = 0; i < this.materials.length; i += 1) {
      const entry = this.materials[i]!;
      entry.material.transparent = this.ghostAlpha < 0.98 || entry.opacity < 0.98;
      entry.material.opacity = entry.material === this.shadowMat
        ? this.shadowMat.opacity
        : entry.opacity * this.ghostAlpha;
      entry.material.depthWrite = this.ghostAlpha >= 0.95 && entry.opacity >= 0.95;
    }
  }
}

class SkeletonKingRig extends BossRigBase {
  private readonly sword: THREE.Group;

  constructor(def: BossDef) {
    const h = 1.8 * def.scale;
    super(1.55, 0.9, 0.32, 0.015, 2.0);

    const bone = this.makeToon(BONE);
    const boneShade = this.makeToon(def.palette.glow);
    const dark = this.makeToon(DARK);
    const gold = this.makeToon(GOLD);
    const red = this.makeToon(CAPE_RED, 0.78);
    const whiteHot = this.makeToon(0xffffff);

    const hips = new THREE.Group();
    const torso = new THREE.Group();
    const head = new THREE.Group();
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    const foreArmL = new THREE.Group();
    const foreArmR = new THREE.Group();
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    const shinL = new THREE.Group();
    const shinR = new THREE.Group();
    this.joints.hips = hips;
    this.joints.torso = torso;
    this.joints.head = head;
    this.joints.armL = armL;
    this.joints.armR = armR;
    this.joints.foreArmL = foreArmL;
    this.joints.foreArmR = foreArmR;
    this.joints.legL = legL;
    this.joints.legR = legR;
    this.joints.shinL = shinL;
    this.joints.shinR = shinR;

    hips.position.y = h * 0.31;
    torso.position.y = h * 0.24;
    head.position.y = h * 0.42;
    this.bodyRoot.add(hips);
    hips.add(torso);
    torso.add(head);

    addBall(hips, boneShade, 0.52, 0.28, 0.42, 0, 0, 0);
    addBall(torso, bone, 0.6, 0.74, 0.45, 0, h * 0.11, 0);
    addBall(torso, dark, 0.43, 0.45, 0.33, 0.09, h * 0.16, 0);

    for (let i = 0; i < 5; i += 1) {
      const rib = addCapsule(torso, boneShade, 0.045, 0.76 - i * 0.055, 0.03, 0.12, h * (0.23 - i * 0.035), 0);
      rib.rotation.x = Math.PI / 2;
      rib.rotation.z = -0.08;
    }

    const cape = addBox(torso, red, 0.9, 1.45, 0.08, -0.28, h * 0.02, -0.52);
    cape.rotation.z = -0.12;

    const headR = h * 0.135;
    addBall(head, bone, headR * 1.14, headR * 0.98, headR, 0.02, 0, 0);
    addBall(head, dark, headR * 0.28, headR * 0.38, headR * 0.14, headR * 0.78, headR * 0.08, -headR * 0.28);
    addBall(head, dark, headR * 0.28, headR * 0.38, headR * 0.14, headR * 0.78, headR * 0.08, headR * 0.28);
    addBall(head, dark, headR * 0.28, headR * 0.05, headR * 0.08, headR * 0.82, -headR * 0.3, 0);

    const crownBand = addCylinder(head, gold, headR * 0.82, headR * 0.16, 0, headR * 0.8, 0);
    crownBand.rotation.z = Math.PI / 2;
    for (let i = 0; i < 5; i += 1) {
      const x = (i - 2) * headR * 0.36;
      const spike = addCone(head, i % 2 === 0 ? bone : gold, headR * 0.14, headR * 0.42, x, headR * 1.12, 0, 0);
      spike.rotation.z = 0;
      addBall(head, i % 2 === 0 ? gold : bone, headR * 0.11, headR * 0.11, headR * 0.11, x, headR * 1.38, 0);
    }

    const shoulderY = h * 0.28;
    armL.position.set(0, shoulderY, -0.48);
    armR.position.set(0.1, shoulderY, 0.48);
    torso.add(armL, armR);
    buildBoneArm(armL, foreArmL, bone, boneShade, 0.42, 0.54);
    buildBoneArm(armR, foreArmR, bone, boneShade, 0.46, 0.6);

    legL.position.set(-0.22, 0, -0.22);
    legR.position.set(0.22, 0, 0.22);
    hips.add(legL, legR);
    buildBoneLeg(legL, shinL, bone, boneShade, 0.68, 0.7);
    buildBoneLeg(legR, shinR, bone, boneShade, 0.68, 0.7);

    this.sword = new THREE.Group();
    this.sword.position.set(0.18, -0.58, 0.06);
    this.sword.rotation.z = -0.42;
    foreArmR.add(this.sword);
    const shaft = addCapsule(this.sword, bone, 0.1, 1.36, 0.1, 0.48, 0.72, 0);
    shaft.rotation.z = -0.2;
    addBall(this.sword, bone, 0.22, 0.22, 0.22, 0.22, -0.02, 0);
    addBall(this.sword, bone, 0.26, 0.24, 0.24, 0.7, 1.44, 0);
    const cross = addCapsule(this.sword, whiteHot, 0.065, 0.8, 0.065, 0.36, 0.26, 0);
    cross.rotation.z = Math.PI / 2;
    addBall(this.sword, whiteHot, 0.15, 0.15, 0.15, -0.04, 0.26, 0);
    addBall(this.sword, whiteHot, 0.15, 0.15, 0.15, 0.76, 0.26, 0);
  }

  protected override afterPose(pose: Pose, amount: number): void {
    const active = (pose.root?.z ?? 0) > 0.18 || (pose.torso?.z ?? 0) < -0.38;
    const windup = (pose.armR?.z ?? 0) > 1.3 || (pose.torso?.z ?? 0) > 0.36;
    const target = active ? 0.92 : windup ? -0.95 : -0.42;
    this.sword.rotation.z = lerp(this.sword.rotation.z, target, amount);
  }
}

class GiantGhostRig extends BossRigBase {
  private readonly pupilMats: THREE.MeshToonMaterial[] = [];
  private angry = false;

  constructor(def: BossDef) {
    const h = 1.8 * def.scale;
    const w = h * 0.36;
    super(w * 1.25, w * 0.82, 0.18, 0.12, 2.2);

    const body = this.makeToon(def.palette.core, 0.88);
    const shade = this.makeToon(def.palette.glow, 0.74);
    const white = this.makeToon(0xffffff, 0.95);
    const dark = this.makeToon(DARK, 0.92);

    const bodyY = h * 0.52;
    addBall(this.bodyRoot, body, w * 1.15, h * 0.34, w, 0, bodyY, 0);
    addBall(this.bodyRoot, shade, w * 0.68, h * 0.16, w * 0.55, 0.26, bodyY + h * 0.08, 0);

    for (let i = 0; i < 7; i += 1) {
      const x = (i - 3) * w * 0.24;
      const z = (i % 2 === 0 ? -1 : 1) * w * 0.26;
      addBall(this.bodyRoot, body, w * 0.2, h * 0.08, w * 0.18, x, h * 0.18, z);
    }
    addBall(this.bodyRoot, body, w * 0.28, h * 0.16, w * 0.22, w * 0.72, bodyY - h * 0.02, -w * 0.92);
    addBall(this.bodyRoot, body, w * 0.28, h * 0.16, w * 0.22, w * 0.72, bodyY - h * 0.02, w * 0.92);

    for (const side of [-1, 1] as const) {
      addBall(this.bodyRoot, white, w * 0.24, h * 0.13, w * 0.09, w * 0.84, bodyY + h * 0.1, side * w * 0.28);
      addBall(this.bodyRoot, dark, w * 0.11, h * 0.075, w * 0.045, w * 0.98, bodyY + h * 0.09, side * w * 0.28);
      this.pupilMats.push(dark);
    }
  }

  setAngry(on: boolean): void {
    if (this.angry === on) return;
    this.angry = on;
    const color = on ? ANGRY_RED : DARK;
    for (let i = 0; i < this.pupilMats.length; i += 1) {
      const material = this.pupilMats[i]!;
      material.color.setHex(color, THREE.SRGBColorSpace);
      for (let entryIndex = 0; entryIndex < this.tintMaterials.length; entryIndex += 1) {
        const entry = this.tintMaterials[entryIndex]!;
        if (entry.material === material) entry.base.setHex(color, THREE.SRGBColorSpace);
      }
    }
  }

  protected override updateCustom(_dt: number, time: number): void {
    const pulse = 1 + Math.sin(time * 3.1) * 0.035;
    this.bodyRoot.scale.x = pulse;
    this.bodyRoot.scale.y = 1 / pulse;
  }
}

class GiantEagleRig extends BossRigBase {
  private readonly wingL: THREE.Group;
  private readonly wingR: THREE.Group;
  private readonly tail: THREE.Group;

  constructor(def: BossDef) {
    const h = 1.8 * def.scale;
    const w = h * 0.34;
    super(w * 1.3, w * 0.85, 0.25, 0.035, 3.8);

    const body = this.makeToon(EAGLE_BROWN);
    const wing = this.makeToon(def.palette.glow);
    const gold = this.makeToon(def.palette.accent);
    const cream = this.makeToon(EAGLE_CREAM);
    const orange = this.makeToon(ORANGE);
    const dark = this.makeToon(DARK);
    const white = this.makeToon(0xffffff);

    const torso = new THREE.Group();
    const head = new THREE.Group();
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    this.joints.torso = torso;
    this.joints.head = head;
    this.joints.legL = legL;
    this.joints.legR = legR;
    torso.position.y = h * 0.24;
    head.position.set(w * 0.5, h * 0.42, 0);
    this.bodyRoot.add(torso);
    torso.add(head);

    addBall(torso, body, w * 0.84, h * 0.3, w * 0.74, 0, h * 0.18, 0);
    addBall(torso, cream, w * 0.52, h * 0.2, w * 0.45, w * 0.2, h * 0.12, 0);
    addBall(head, cream, w * 0.44, h * 0.16, w * 0.38, 0, 0, 0);
    addBall(head, white, w * 0.22, h * 0.11, w * 0.12, w * 0.24, h * 0.06, -w * 0.2);
    addBall(head, white, w * 0.22, h * 0.11, w * 0.12, w * 0.24, h * 0.06, w * 0.2);
    addBall(head, dark, w * 0.08, h * 0.045, w * 0.05, w * 0.4, h * 0.05, -w * 0.2);
    addBall(head, dark, w * 0.08, h * 0.045, w * 0.05, w * 0.4, h * 0.05, w * 0.2);
    const beakTop = addCone(head, orange, w * 0.18, w * 0.62, w * 0.6, -h * 0.015, 0, -Math.PI / 2);
    beakTop.scale.z = 0.62;
    const beakLow = addCone(head, gold, w * 0.13, w * 0.42, w * 0.52, -h * 0.08, 0, -Math.PI / 2);
    beakLow.scale.z = 0.52;

    this.wingL = new THREE.Group();
    this.wingR = new THREE.Group();
    this.wingL.position.set(-w * 0.12, h * 0.27, -w * 0.62);
    this.wingR.position.set(-w * 0.12, h * 0.27, w * 0.62);
    torso.add(this.wingL, this.wingR);
    buildWing(this.wingL, wing, gold, -1, w, h);
    buildWing(this.wingR, wing, gold, 1, w, h);

    this.tail = new THREE.Group();
    this.tail.position.set(-w * 0.72, h * 0.14, 0);
    torso.add(this.tail);
    for (let i = 0; i < 5; i += 1) {
      const feather = addBox(this.tail, wing, w * 0.16, h * 0.42, w * 0.08, -w * 0.08, 0, (i - 2) * w * 0.15);
      feather.rotation.z = 0.95 + (i - 2) * 0.14;
    }

    legL.position.set(w * 0.18, h * 0.03, -w * 0.22);
    legR.position.set(w * 0.18, h * 0.03, w * 0.22);
    this.bodyRoot.add(legL, legR);
    buildTalons(legL, gold, dark, w);
    buildTalons(legR, gold, dark, w);
  }

  protected override afterPose(pose: Pose, amount: number): void {
    const swoop = (pose.root?.z ?? 0) < -0.18 || (pose.torso?.z ?? 0) > 0.8;
    const target = swoop ? -0.45 : 0;
    this.poseRoot.rotation.z = lerp(this.poseRoot.rotation.z, target, amount);
  }

  protected override updateCustom(_dt: number, time: number): void {
    const flap = Math.sin(time * 8.5) * 0.5;
    this.wingL.rotation.x = -0.2 + flap;
    this.wingR.rotation.x = 0.2 - flap;
    this.wingL.rotation.z = -0.08 + flap * 0.18;
    this.wingR.rotation.z = 0.08 - flap * 0.18;
    this.tail.rotation.z = Math.sin(time * 2.5) * 0.08;
  }
}

function buildBoneArm(
  upper: THREE.Group,
  lower: THREE.Group,
  bone: THREE.Material,
  jointMat: THREE.Material,
  upperLen: number,
  lowerLen: number,
): void {
  addCapsule(upper, bone, 0.075, upperLen, 0.075, 0, -upperLen * 0.5, 0);
  addBall(upper, jointMat, 0.14, 0.14, 0.14, 0, 0, 0);
  lower.position.y = -upperLen;
  upper.add(lower);
  addCapsule(lower, bone, 0.07, lowerLen, 0.07, 0, -lowerLen * 0.5, 0);
  addBall(lower, jointMat, 0.18, 0.16, 0.16, 0, -lowerLen, 0);
}

function buildBoneLeg(
  upper: THREE.Group,
  lower: THREE.Group,
  bone: THREE.Material,
  jointMat: THREE.Material,
  upperLen: number,
  lowerLen: number,
): void {
  addCapsule(upper, bone, 0.095, upperLen, 0.095, 0, -upperLen * 0.5, 0);
  addBall(upper, jointMat, 0.16, 0.16, 0.16, 0, 0, 0);
  lower.position.y = -upperLen;
  upper.add(lower);
  addCapsule(lower, bone, 0.088, lowerLen, 0.088, 0, -lowerLen * 0.5, 0);
  addBall(lower, jointMat, 0.24, 0.12, 0.18, 0.08, -lowerLen, 0);
}

function buildWing(
  parent: THREE.Group,
  wing: THREE.Material,
  accent: THREE.Material,
  side: 1 | -1,
  w: number,
  h: number,
): void {
  for (let i = 0; i < 5; i += 1) {
    const feather = addBox(parent, i === 0 ? accent : wing, w * (0.64 - i * 0.06), h * 0.08, w * 0.08, -w * (0.12 + i * 0.16), -h * (0.02 + i * 0.035), side * w * (0.18 + i * 0.12));
    feather.rotation.z = -0.16 - i * 0.08;
    feather.rotation.x = side * (0.22 + i * 0.08);
  }
}

function buildTalons(parent: THREE.Group, legMat: THREE.Material, clawMat: THREE.Material, w: number): void {
  addCapsule(parent, legMat, w * 0.045, w * 0.34, w * 0.045, 0, w * 0.1, 0);
  for (let i = 0; i < 3; i += 1) {
    const claw = addCone(parent, clawMat, w * 0.035, w * 0.18, w * 0.09, -w * 0.08, (i - 1) * w * 0.08, -Math.PI / 2);
    claw.rotation.x = (i - 1) * 0.28;
  }
}

function addBall(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(SPHERE, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addCapsule(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CAPSULE, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addCone(
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CONE, material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotZ;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CYLINDER, material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
