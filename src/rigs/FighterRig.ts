import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { Palette, Proportions } from '../data/types';
import { attachGlow } from '../render/GlowSprites';
import type { JointName, Pose } from './poses';

type TintMaterial = THREE.MeshBasicMaterial | THREE.LineBasicMaterial | THREE.SpriteMaterial;

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BOX_EDGES = new THREE.EdgesGeometry(BOX);
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

export class FighterRig {
  readonly root = new THREE.Group();
  readonly joints: Record<JointName, THREE.Object3D>;
  readonly weaponSocket = new THREE.Group();

  private readonly materials: THREE.Material[] = [];
  private readonly tintMaterials: { material: TintMaterial; base: THREE.Color }[] = [];
  private readonly flash = new THREE.Color(0xffffff);
  private flashTimer = 0;
  private flashDuration = 0;
  private facingTarget: 1 | -1 = 1;
  private facingScale = 1;
  private ghostAlpha = 1;

  constructor(def: { palette: Palette; proportions: Proportions }) {
    const palette = def.palette;
    const prop = def.proportions;
    const height = prop.height;
    const bulk = prop.bulk;
    const depth = 0.24 * bulk;
    const legLen = height * 0.46;
    const torsoH = height * 0.34;
    const headH = height * 0.17 * prop.headSize;
    const torsoW = 0.54 * bulk;
    const hipW = 0.48 * bulk;
    const limbW = 0.13 * bulk;
    const upperArm = height * 0.22;
    const foreArm = height * 0.2;
    const thigh = height * 0.24;
    const shin = height * 0.23;

    const bodyMat = this.makeBodyMaterial(palette.core);
    const glowMat = this.makeGlowMaterial(palette.glow);
    const edgeMat = this.makeLineMaterial(palette.glow);
    const accentMat = this.makeGlowMaterial(palette.accent);

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

    this.root.position.z = 0;
    hips.position.y = legLen;
    this.root.add(hips);

    addBox(hips, bodyMat, hipW, height * 0.11, depth, 0, 0, 0);
    addEdge(hips, edgeMat, hipW * 1.04, height * 0.12, depth * 1.04, 0, 0, 0);

    torso.position.y = height * 0.02;
    hips.add(torso);
    addBox(torso, bodyMat, torsoW, torsoH, depth, 0, torsoH * 0.5, 0);
    addEdge(torso, edgeMat, torsoW * 1.04, torsoH * 1.04, depth * 1.04, 0, torsoH * 0.5, 0);
    addBox(torso, accentMat, torsoW * 0.42, torsoH * 0.18, depth * 1.08, 0, torsoH * 0.54, depth * 0.54);

    head.position.y = torsoH + headH * 0.58;
    torso.add(head);
    addBox(head, bodyMat, headH * 0.9, headH, depth * 0.95, 0, 0, 0);
    addEdge(head, edgeMat, headH * 0.95, headH * 1.05, depth, 0, 0, 0);
    addBox(head, glowMat, headH * 0.62, headH * 0.12, depth * 1.08, 0, headH * 0.08, depth * 0.54);

    armL.position.set(0, torsoH * 0.78, -depth * 0.58);
    armR.position.set(0, torsoH * 0.78, depth * 0.58);
    torso.add(armL, armR);
    buildArm(armL, foreArmL, bodyMat, glowMat, edgeMat, limbW, upperArm, foreArm, depth * 0.8);
    buildArm(armR, foreArmR, bodyMat, glowMat, edgeMat, limbW, upperArm, foreArm, depth * 0.8);
    foreArmR.add(this.weaponSocket);
    this.weaponSocket.position.set(0, -foreArm, depth * 0.35);

    legL.position.set(-hipW * 0.23, 0, -depth * 0.32);
    legR.position.set(hipW * 0.23, 0, depth * 0.32);
    hips.add(legL, legR);
    buildLeg(legL, shinL, bodyMat, glowMat, edgeMat, limbW * 1.08, thigh, shin, depth * 0.86);
    buildLeg(legR, shinR, bodyMat, glowMat, edgeMat, limbW * 1.08, thigh, shin, depth * 0.86);

    const chestGlow = attachGlow(torso, palette.glow, torsoW * 1.25, 0.55);
    chestGlow.position.set(0, torsoH * 0.55, depth * 0.75);
    this.ownSpriteMaterial(chestGlow);
    const headGlow = attachGlow(head, palette.glow, headH * 1.3, 0.35);
    headGlow.position.set(0, headH * 0.03, depth * 0.72);
    this.ownSpriteMaterial(headGlow);

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
      joint.rotation.y = lerp(joint.rotation.y, target?.y ?? 0, amount);
      joint.rotation.z = lerp(joint.rotation.z, target?.z ?? 0, amount);
    }
  }

  setFacing(f: 1 | -1): void {
    this.facingTarget = f;
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
      material.opacity = this.ghostAlpha;
      material.depthWrite = this.ghostAlpha >= 0.95;
    }
  }

  update(dt: number): void {
    this.facingScale = damp(this.facingScale, this.facingTarget, 28, dt);
    this.root.scale.x = this.facingScale;

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

    if (this.ghostAlpha < 0.99) {
      const pulse = 0.55 + Math.sin(performance.now() * 0.025) * 0.18;
      for (const material of this.materials) {
        material.opacity = Math.min(this.ghostAlpha, pulse);
      }
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    const unique = new Set(this.materials);
    for (const material of unique) {
      material.dispose();
    }
  }

  private makeBodyMaterial(color: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 1,
    });
    this.materials.push(material);
    return material;
  }

  private makeGlowMaterial(color: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 1,
      toneMapped: false,
    });
    this.materials.push(material);
    this.tintMaterials.push({ material, base: material.color.clone() });
    return material;
  }

  private makeLineMaterial(color: number): THREE.LineBasicMaterial {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 1,
      toneMapped: false,
    });
    this.materials.push(material);
    this.tintMaterials.push({ material, base: material.color.clone() });
    return material;
  }

  private ownSpriteMaterial(sprite: THREE.Sprite): void {
    const material = sprite.material.clone();
    sprite.material = material;
    this.materials.push(material);
    this.tintMaterials.push({ material, base: material.color.clone() });
  }
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.MeshBasicMaterial,
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

function addEdge(
  parent: THREE.Object3D,
  material: THREE.LineBasicMaterial,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): void {
  const edges = new THREE.LineSegments(BOX_EDGES, material);
  edges.scale.set(sx, sy, sz);
  edges.position.set(x, y, z);
  parent.add(edges);
}

function buildArm(
  shoulder: THREE.Group,
  foreGroup: THREE.Group,
  bodyMat: THREE.MeshBasicMaterial,
  glowMat: THREE.MeshBasicMaterial,
  edgeMat: THREE.LineBasicMaterial,
  limbW: number,
  upperLen: number,
  foreLen: number,
  depth: number,
): void {
  addBox(shoulder, bodyMat, limbW, upperLen, depth, 0, -upperLen * 0.5, 0);
  addEdge(shoulder, edgeMat, limbW * 1.05, upperLen * 1.02, depth * 1.05, 0, -upperLen * 0.5, 0);
  foreGroup.position.y = -upperLen;
  shoulder.add(foreGroup);
  addBox(foreGroup, bodyMat, limbW * 0.88, foreLen, depth, 0, -foreLen * 0.5, 0);
  addEdge(foreGroup, edgeMat, limbW * 0.92, foreLen * 1.02, depth * 1.05, 0, -foreLen * 0.5, 0);
  addBox(foreGroup, glowMat, limbW * 1.35, limbW * 1.15, depth * 1.05, 0, -foreLen - limbW * 0.15, 0);
}

function buildLeg(
  hip: THREE.Group,
  shinGroup: THREE.Group,
  bodyMat: THREE.MeshBasicMaterial,
  glowMat: THREE.MeshBasicMaterial,
  edgeMat: THREE.LineBasicMaterial,
  limbW: number,
  thighLen: number,
  shinLen: number,
  depth: number,
): void {
  addBox(hip, bodyMat, limbW, thighLen, depth, 0, -thighLen * 0.5, 0);
  addEdge(hip, edgeMat, limbW * 1.05, thighLen * 1.02, depth * 1.05, 0, -thighLen * 0.5, 0);
  shinGroup.position.y = -thighLen;
  hip.add(shinGroup);
  addBox(shinGroup, bodyMat, limbW * 0.92, shinLen, depth, 0, -shinLen * 0.5, 0);
  addEdge(shinGroup, edgeMat, limbW * 0.96, shinLen * 1.02, depth * 1.05, 0, -shinLen * 0.5, 0);
  addBox(shinGroup, glowMat, limbW * 1.55, limbW * 0.42, depth * 1.05, limbW * 0.34, -shinLen, 0);
}
