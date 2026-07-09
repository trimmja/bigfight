import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import { makeToonMaterial } from '../render/toon';
import type { Palette, Proportions } from '../data/types';
import type { JointName, Pose } from './poses';

/**
 * Bright-cartoon (Fall Guys style) fighter rig: chunky rounded primitives,
 * toon-shaded candy colors, big eyes, blob ground shadow. Same joint tree and
 * pose semantics as always: profile rig faces +X, sagittal swings on Z.
 *
 * Palette semantics (bright-toon era): core = main body color,
 * glow = limb/trim color, accent = detail pop (belly, fists, feet).
 */

type TintMaterial = THREE.MeshToonMaterial;

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

// Shared unit geometries, scaled per-mesh.
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const SHADOW_CIRCLE = new THREE.CircleGeometry(1, 24);


export class FighterRig {
  readonly root = new THREE.Group();
  readonly joints: Record<JointName, THREE.Object3D>;
  readonly weaponSocket = new THREE.Group();

  private readonly materials: THREE.Material[] = [];
  private readonly tintMaterials: { material: TintMaterial; base: THREE.Color }[] = [];
  private readonly flash = new THREE.Color(0xffffff);
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private flashTimer = 0;
  private flashDuration = 0;
  private facingTarget: 1 | -1 = 1;
  private facingAngle = 0;
  private ghostAlpha = 1;

  constructor(def: { palette: Palette; proportions: Proportions }) {
    const palette = def.palette;
    const prop = def.proportions;
    const height = prop.height;
    const bulk = prop.bulk;
    const depth = 0.26 * bulk;
    const legLen = height * 0.46;
    const torsoH = height * 0.34;
    const headH = height * 0.17 * prop.headSize;
    const torsoW = 0.54 * bulk;
    const hipW = 0.48 * bulk;
    const limbW = 0.14 * bulk;
    const upperArm = height * 0.22;
    const foreArm = height * 0.2;
    const thigh = height * 0.24;
    const shin = height * 0.23;

    const bodyMat = this.makeToon(palette.core);
    // Limbs: trim color lifted toward white so they stay lively in shade.
    const limbColor = new THREE.Color(palette.glow).lerp(new THREE.Color(0xffffff), 0.22);
    const limbMat = this.makeToon(limbColor.getHex());
    const accentMat = this.makeToon(palette.accent);
    const whiteMat = this.makeToon(0xffffff);
    const darkMat = this.makeToon(0x2a2d3a);

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

    hips.position.y = legLen;
    this.root.add(hips);

    // Hips: squashed ball.
    addBall(hips, bodyMat, hipW * 0.56, height * 0.085, depth * 1.15, 0, 0, 0);

    // Torso: chunky egg + belly patch.
    torso.position.y = height * 0.02;
    hips.add(torso);
    addBall(torso, bodyMat, torsoW * 0.62, torsoH * 0.62, depth * 1.35, 0, torsoH * 0.5, 0);
    addBall(torso, accentMat, torsoW * 0.44, torsoH * 0.46, depth * 1.0, torsoW * 0.22, torsoH * 0.44, 0);

    // Head: big ball with two big cartoon eyes (front = +X).
    head.position.y = torsoH * 1.06 + headH * 0.5;
    torso.add(head);
    const headR = headH * 0.62;
    addBall(head, bodyMat, headR, headR * 0.95, headR * 0.95, 0, 0, 0);
    for (const side of [-1, 1]) {
      addBall(head, whiteMat, headR * 0.34, headR * 0.42, headR * 0.2, headR * 0.78, headR * 0.1, side * headR * 0.36);
      addBall(head, darkMat, headR * 0.15, headR * 0.2, headR * 0.12, headR * 1.02, headR * 0.1, side * headR * 0.32);
    }

    // Arms: stubby capsules high on the egg, flared slightly outward via a
    // fixed rest group so poses (which relax joints to 0) keep the flare.
    const restL = new THREE.Group();
    const restR = new THREE.Group();
    // Shoulders at the OUTER edge of the torso egg (its z radius is
    // depth*1.35) so arms hang beside the body, not inside its silhouette —
    // critical for front views (character select, turnarounds).
    restL.position.set(0, torsoH * 0.9, -depth * 1.55);
    restR.position.set(0, torsoH * 0.9, depth * 1.55);
    // Positive-X tilt on the -Z arm points it AWAY from the body (and vice
    // versa). These were inverted originally, which made every pose read as
    // praying hands from the front.
    restL.rotation.x = 0.34;
    restR.rotation.x = -0.34;
    torso.add(restL, restR);
    restL.add(armL);
    restR.add(armR);
    buildLimb(armL, foreArmL, limbMat, accentMat, limbW * 0.92, upperArm * 0.82, foreArm * 0.82, true);
    buildLimb(armR, foreArmR, limbMat, accentMat, limbW * 0.92, upperArm * 0.82, foreArm * 0.82, true);
    foreArmR.add(this.weaponSocket);
    this.weaponSocket.position.set(0, -foreArm, depth * 0.35);

    // Legs: capsule thigh + capsule shin + shoe.
    legL.position.set(-hipW * 0.14, 0, -depth * 0.42);
    legR.position.set(hipW * 0.14, 0, depth * 0.42);
    hips.add(legL, legR);
    buildLimb(legL, shinL, limbMat, accentMat, limbW * 1.1, thigh, shin, false);
    buildLimb(legR, shinR, limbMat, accentMat, limbW * 1.1, thigh, shin, false);

    // Blob shadow (owner positions it on the ground via setShadow).
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1b2a3a,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.materials.push(this.shadowMat);
    this.shadow = new THREE.Mesh(SHADOW_CIRCLE, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(hipW * 1.15, hipW * 0.72, 1);
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);

    this.joints = {
      hips,
      torso,
      head,
      armL,
      armR,
      foreArmL,
      foreArmR,
      legL,
      legR,
      shinL,
      shinR,
      root: this.root,
    };
  }

  setPose(pose: Pose, blend: number): void {
    const amount = clamp(blend, 0, 1);
    for (let i = 0; i < JOINTS.length; i += 1) {
      const name = JOINTS[i]!;
      const joint = this.joints[name];
      const target = pose[name];
      joint.rotation.x = lerp(joint.rotation.x, target?.x ?? 0, amount);
      // Root yaw belongs to the facing turn, never to poses.
      if (name !== 'root') joint.rotation.y = lerp(joint.rotation.y, target?.y ?? 0, amount);
      joint.rotation.z = lerp(joint.rotation.z, target?.z ?? 0, amount);
    }
    // The shadow must not inherit the tumble spin visually — counteract root z.
    this.shadow.rotation.z = -this.root.rotation.z;
  }

  setFacing(f: 1 | -1): void {
    this.facingTarget = f;
  }

  /**
   * Places the blob shadow. groundLocalY = ground world Y minus body Y (root-
   * local). airborneT 0 = on ground, 1 = high in the air (shrinks/fades).
   * Pass groundLocalY = null to hide (over a pit).
   */
  setShadow(groundLocalY: number | null, airborneT: number): void {
    if (groundLocalY === null) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    this.shadow.position.y = groundLocalY + 0.12;
    const s = 1 - 0.45 * clamp(airborneT, 0, 1);
    this.shadow.scale.setScalar(s);
    this.shadowMat.opacity = 0.28 * (1 - 0.6 * clamp(airborneT, 0, 1)) * this.ghostAlpha;
  }

  flashColor(color: number, seconds: number): void {
    this.flash.setHex(color, THREE.SRGBColorSpace);
    this.flashTimer = Math.max(0, seconds);
    this.flashDuration = Math.max(0.0001, seconds);
    for (const entry of this.tintMaterials) {
      entry.material.color.copy(this.flash);
    }
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
    // Turn, don't mirror: a real 180° spin around Y. Mirroring via scale.x
    // squashed the rig paper-thin mid-flip (and you glimpse the face mid-turn
    // this way, which is charming).
    this.facingAngle = damp(this.facingAngle, this.facingTarget === 1 ? 0 : Math.PI, 28, dt);
    this.root.rotation.y = this.facingAngle;

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = 1 - this.flashTimer / this.flashDuration;
      for (const entry of this.tintMaterials) {
        entry.material.color.copy(this.flash).lerp(entry.base, t);
      }
    } else {
      for (const entry of this.tintMaterials) {
        entry.material.color.copy(entry.base);
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const material of this.materials) material.dispose();
    // Geometries are shared module-level constants — never disposed per rig.
  }

  private makeToon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push(material);
    this.tintMaterials.push({ material, base: material.color.clone() });
    return material;
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

/** Capsule limb hanging -Y from its pivot, with a ball hand/shoe at the end. */
function buildLimb(
  upperGroup: THREE.Group,
  lowerGroup: THREE.Group,
  limbMat: THREE.Material,
  tipMat: THREE.Material,
  radius: number,
  upperLen: number,
  lowerLen: number,
  isArm: boolean,
): void {
  const upper = new THREE.Mesh(CAPSULE, limbMat);
  upper.scale.set(radius, upperLen * 0.5, radius);
  upper.position.y = -upperLen * 0.5;
  upperGroup.add(upper);

  lowerGroup.position.y = -upperLen;
  upperGroup.add(lowerGroup);

  const lower = new THREE.Mesh(CAPSULE, limbMat);
  lower.scale.set(radius * 0.92, lowerLen * 0.5, radius * 0.92);
  lower.position.y = -lowerLen * 0.5;
  lowerGroup.add(lower);

  if (isArm) {
    const fist = new THREE.Mesh(SPHERE, tipMat);
    fist.scale.setScalar(radius * 1.5);
    fist.position.y = -lowerLen;
    lowerGroup.add(fist);
  } else {
    const shoe = new THREE.Mesh(SPHERE, tipMat);
    shoe.scale.set(radius * 1.7, radius * 1.1, radius * 1.5);
    shoe.position.set(radius * 0.8, -lowerLen, 0);
    lowerGroup.add(shoe);
  }
}
