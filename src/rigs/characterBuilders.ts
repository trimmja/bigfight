import * as THREE from 'three';
import type { CharacterDef } from '../data/types';
import { makeToonMaterial } from '../render/toon';
import { FighterRig } from './FighterRig';

type TintEntry = { material: THREE.MeshToonMaterial; base: THREE.Color; opacity: number };
type MaterialEntry = { material: THREE.Material; opacity: number };
type RigMetrics = {
  height: number;
  bulk: number;
  depth: number;
  torsoH: number;
  torsoW: number;
  hipW: number;
  headR: number;
  foreArmLen: number;
};

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 18);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const TORUS = new THREE.TorusGeometry(1, 0.08, 8, 32);

const WHITE = 0xffffff;
const DARK = 0x252837;

export function buildCharacterRig(def: CharacterDef): FighterRig {
  const rig = new FighterRig({ palette: def.palette, proportions: def.proportions });
  const kit = new GarnishKit(rig);
  const metrics = getMetrics(def);

  switch (def.id) {
    case 'volt':
      buildVolt(rig, kit, metrics, def);
      break;
    case 'kaze':
      buildKaze(rig, kit, metrics, def);
      break;
    case 'grim':
      buildGrim(rig, kit, metrics, def);
      break;
    case 'ace':
      buildAce(rig, kit, metrics, def);
      break;
    case 'blaze':
      buildBlaze(rig, kit, metrics, def);
      break;
    case 'nova':
      buildNova(rig, kit, metrics, def);
      break;
    case 'shade':
      buildShade(rig, kit, metrics, def);
      break;
    case 'titan':
      buildTitan(rig, kit, metrics, def);
      break;
    default:
      break;
  }

  kit.patchRig();
  return rig;
}

class GarnishKit {
  private readonly materials: MaterialEntry[] = [];
  private readonly tintMaterials: TintEntry[] = [];
  private readonly flash = new THREE.Color(WHITE);
  private flashTimer = 0;
  private flashDuration = 0;
  private ghostAlpha = 1;

  constructor(private readonly rig: FighterRig) {}

  makeToon(color: number, opacity = 1): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    material.transparent = opacity < 0.98;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.95;
    this.materials.push({ material, opacity });
    this.tintMaterials.push({ material, base: material.color.clone(), opacity });
    return material;
  }

  patchRig(): void {
    const baseDispose = this.rig.dispose.bind(this.rig);
    const baseFlashColor = this.rig.flashColor.bind(this.rig);
    const baseSetGhostOpacity = this.rig.setGhostOpacity.bind(this.rig);
    const baseUpdate = this.rig.update.bind(this.rig);

    this.rig.dispose = (): void => {
      baseDispose();
      for (let i = 0; i < this.materials.length; i += 1) {
        this.materials[i]!.material.dispose();
      }
    };

    this.rig.flashColor = (color: number, seconds: number): void => {
      baseFlashColor(color, seconds);
      this.flash.setHex(color, THREE.SRGBColorSpace);
      this.flashTimer = Math.max(0, seconds);
      this.flashDuration = Math.max(0.0001, seconds);
      for (let i = 0; i < this.tintMaterials.length; i += 1) {
        this.tintMaterials[i]!.material.color.copy(this.flash);
      }
    };

    this.rig.setGhostOpacity = (alpha: number): void => {
      this.ghostAlpha = THREE.MathUtils.clamp(alpha, 0, 1);
      baseSetGhostOpacity(alpha);
      this.applyOpacity();
    };

    this.rig.update = (dt: number): void => {
      baseUpdate(dt);
      if (this.flashTimer > 0) {
        this.flashTimer = Math.max(0, this.flashTimer - dt);
        const t = 1 - this.flashTimer / this.flashDuration;
        for (let i = 0; i < this.tintMaterials.length; i += 1) {
          const entry = this.tintMaterials[i]!;
          entry.material.color.copy(this.flash).lerp(entry.base, t);
        }
      } else {
        for (let i = 0; i < this.tintMaterials.length; i += 1) {
          const entry = this.tintMaterials[i]!;
          entry.material.color.copy(entry.base);
        }
      }
      this.applyOpacity();
    };
  }

  private applyOpacity(): void {
    for (let i = 0; i < this.materials.length; i += 1) {
      const entry = this.materials[i]!;
      entry.material.transparent = this.ghostAlpha < 0.98 || entry.opacity < 0.98;
      entry.material.opacity = entry.opacity * this.ghostAlpha;
      entry.material.depthWrite = this.ghostAlpha >= 0.95 && entry.opacity >= 0.95;
    }
  }
}

function buildVolt(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const accent = kit.makeToon(def.palette.accent);
  const glow = kit.makeToon(def.palette.glow, 0.7);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  addCapsule(rig.joints.head, accent, m.headR * 0.06, m.headR * 0.34, 0, m.headR * 1.06, 0);
  addBall(rig.joints.head, white, m.headR * 0.16, m.headR * 0.16, m.headR * 0.16, 0, m.headR * 1.28, 0);
  addBox(rig.joints.head, glow, m.headR * 0.22, m.headR * 0.18, m.headR * 1.12, m.headR * 0.86, m.headR * 0.42, 0);
  addBox(rig.joints.torso, white, m.torsoW * 0.5, m.torsoH * 0.26, m.depth * 0.16, m.torsoW * 0.4, m.torsoH * 0.5, 0);
  addBox(rig.joints.torso, dark, m.torsoW * 0.08, m.torsoH * 0.34, m.depth * 0.18, m.torsoW * 0.62, m.torsoH * 0.55, -m.depth * 0.12, 0, 0, -0.55);
  addBox(rig.joints.torso, accent, m.torsoW * 0.08, m.torsoH * 0.32, m.depth * 0.18, m.torsoW * 0.62, m.torsoH * 0.42, m.depth * 0.1, 0, 0, 0.55);
}

function buildKaze(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  addBox(rig.joints.head, accent, m.headR * 0.18, m.headR * 0.18, m.headR * 1.22, m.headR * 0.28, m.headR * 0.45, 0);
  addBox(rig.joints.head, glow, m.headR * 0.12, m.headR * 0.58, m.headR * 0.16, -m.headR * 0.72, m.headR * 0.36, -m.headR * 0.24, 0.2, 0, 0.78);
  addBox(rig.joints.head, glow, m.headR * 0.1, m.headR * 0.48, m.headR * 0.14, -m.headR * 0.78, m.headR * 0.32, m.headR * 0.12, -0.16, 0, 0.55);
  addBox(rig.joints.head, dark, m.headR * 0.3, m.headR * 0.34, m.headR * 1.08, m.headR * 0.82, -m.headR * 0.28, 0);
  addBox(rig.joints.torso, white, m.torsoW * 1.16, m.torsoH * 0.12, m.depth * 1.85, 0, m.torsoH * 0.88, 0, 0, 0, -0.16);
  addCapsule(rig.joints.torso, dark, m.depth * 0.12, m.torsoH * 1.12, -m.torsoW * 0.6, m.torsoH * 0.5, m.depth * 0.48, 0, 0, -0.68);
}

function buildGrim(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  for (const side of [-1, 1] as const) {
    addCone(rig.joints.head, white, m.headR * 0.22, m.headR * 0.62, 0, m.headR * 0.78, side * m.headR * 0.45, side * 0.34, 0, side * 0.24);
    addCone(rig.joints.head, white, m.headR * 0.11, m.headR * 0.28, m.headR * 0.86, -m.headR * 0.32, side * m.headR * 0.26, 0, 0, Math.PI);
  }
  for (let i = 0; i < 3; i += 1) {
    addCone(rig.joints.torso, glow, m.bulk * (0.12 - i * 0.01), m.bulk * 0.28, -m.torsoW * 0.55, m.torsoH * (0.78 - i * 0.22), 0, 0, 0, Math.PI / 2);
  }
  // Oversized brawler fists — both in the accent color (dark read as a blob).
  addBall(rig.joints.foreArmL, accent, m.bulk * 0.15, m.bulk * 0.15, m.bulk * 0.15, 0, -m.foreArmLen, 0);
  addBall(rig.joints.foreArmR, accent, m.bulk * 0.15, m.bulk * 0.15, m.bulk * 0.15, 0, -m.foreArmLen, 0);
  void dark;
}

function buildAce(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  addCylinder(rig.joints.head, dark, m.headR * 1.14, m.headR * 0.08, m.headR * 0.74, 0, m.headR * 0.72, 0);
  addBall(rig.joints.head, glow, m.headR * 0.56, m.headR * 0.36, m.headR * 0.5, 0, m.headR * 0.98, 0);
  addBox(rig.joints.torso, accent, m.torsoW * 0.12, m.torsoH * 0.2, m.depth * 0.18, m.torsoW * 0.58, m.torsoH * 0.6, 0, 0, 0, 0);
  addBox(rig.joints.torso, accent, m.torsoW * 0.3, m.torsoH * 0.06, m.depth * 0.18, m.torsoW * 0.58, m.torsoH * 0.6, 0, 0, 0, 0.8);
  addBox(rig.joints.torso, accent, m.torsoW * 0.3, m.torsoH * 0.06, m.depth * 0.18, m.torsoW * 0.58, m.torsoH * 0.6, 0, 0, 0, -0.8);
  addBox(rig.joints.torso, dark, m.torsoW * 1.1, m.torsoH * 0.12, m.depth * 1.4, 0, m.torsoH * 0.18, 0);
  addBox(rig.joints.torso, white, m.torsoW * 0.22, m.torsoH * 0.14, m.depth * 0.2, m.torsoW * 0.45, m.torsoH * 0.18, 0);
  addBox(rig.joints.torso, glow, m.torsoW * 1.24, m.torsoH * 0.2, m.depth * 1.92, 0, m.torsoH * 0.78, 0, 0, 0, -0.08);
}

function buildBlaze(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const core = kit.makeToon(def.palette.core);
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  addBall(rig.joints.head, core, m.headR * 0.34, m.headR * 0.2, m.headR * 0.26, m.headR * 0.92, -m.headR * 0.1, 0);
  addCone(rig.joints.torso, dark, m.bulk * 0.18, m.bulk * 0.46, -m.torsoW * 0.58, m.torsoH * 0.64, -m.depth * 0.7, 0.45, 0, Math.PI / 2);
  addCone(rig.joints.torso, dark, m.bulk * 0.18, m.bulk * 0.46, -m.torsoW * 0.58, m.torsoH * 0.64, m.depth * 0.7, -0.45, 0, Math.PI / 2);
  addCone(rig.joints.hips, glow, m.bulk * 0.13, m.bulk * 0.36, -m.hipW * 0.62, 0.02, 0, 0, 0, Math.PI / 2);
  addCone(rig.joints.hips, core, m.bulk * 0.11, m.bulk * 0.32, -m.hipW * 0.88, -m.bulk * 0.02, 0, 0, 0, Math.PI / 2);
  addCone(rig.joints.hips, accent, m.bulk * 0.1, m.bulk * 0.3, -m.hipW * 1.1, 0.01, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 3; i += 1) {
    addCone(rig.joints.head, accent, m.headR * (0.14 - i * 0.018), m.headR * 0.38, m.headR * (0.34 - i * 0.22), m.headR * (0.72 + i * 0.1), 0, 0, 0, 0);
  }
  addBall(rig.joints.head, white, m.headR * 0.08, m.headR * 0.06, m.headR * 0.04, m.headR * 1.12, -m.headR * 0.16, 0);
}

function buildNova(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent, 0.78);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  addTorus(rig.joints.head, glow, m.headR * 0.74, 0, m.headR * 1.55, 0, 0, 0, 0);
  addBox(rig.joints.head, dark, m.headR * 0.2, m.headR * 0.18, m.headR * 1.02, m.headR * 0.9, m.headR * 0.16, 0);
  addBall(rig.joints.torso, accent, m.bulk * 0.22, m.bulk * 0.22, m.bulk * 0.12, m.torsoW * 0.52, m.torsoH * 0.5, 0);
  addBall(rig.joints.torso, white, m.bulk * 0.12, m.bulk * 0.12, m.bulk * 0.08, m.torsoW * 0.58, m.torsoH * 0.5, 0);
  addBall(rig.joints.armL, glow, m.bulk * 0.22, m.bulk * 0.12, m.bulk * 0.24, 0, 0, 0);
  addBall(rig.joints.armR, glow, m.bulk * 0.22, m.bulk * 0.12, m.bulk * 0.24, 0, 0, 0);
}

function buildShade(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK, 0.92);
  const aura = kit.makeToon(DARK, 0.3);

  addCone(rig.joints.head, dark, m.headR * 0.86, m.headR * 1.18, -m.headR * 0.04, m.headR * 0.22, 0, 0, 0, 0);
  for (const side of [-1, 1] as const) {
    addBall(rig.joints.head, white, m.headR * 0.1, m.headR * 0.05, m.headR * 0.035, m.headR * 0.96, m.headR * 0.04, side * m.headR * 0.22);
    addCapsule(rig.joints.torso, dark, m.depth * 0.08, m.torsoH * 0.92, -m.torsoW * 0.58, m.torsoH * 0.34, side * m.depth * 0.48, 0, 0, side * 0.46);
  }
  addBox(rig.joints.head, accent, m.headR * 0.13, m.headR * 0.86, m.headR * 0.18, -m.headR * 0.56, -m.headR * 0.16, m.headR * 0.34, 0.15, 0, 0.42);
  addBall(rig.joints.root, aura, m.bulk * 0.48, m.bulk * 0.12, m.bulk * 0.26, -m.bulk * 0.18, 0.08, -m.bulk * 0.26);
  addBall(rig.joints.root, aura, m.bulk * 0.36, m.bulk * 0.1, m.bulk * 0.24, m.bulk * 0.16, 0.06, m.bulk * 0.22);
  addBall(rig.joints.root, glow, m.bulk * 0.22, m.bulk * 0.06, m.bulk * 0.16, 0, 0.1, 0);
}

function buildTitan(rig: FighterRig, kit: GarnishKit, m: RigMetrics, def: CharacterDef): void {
  const glow = kit.makeToon(def.palette.glow);
  const accent = kit.makeToon(def.palette.accent);
  const white = kit.makeToon(WHITE);
  const dark = kit.makeToon(DARK);

  addBox(rig.joints.armL, glow, m.bulk * 0.38, m.bulk * 0.24, m.bulk * 0.34, 0, 0.02, 0);
  addBox(rig.joints.armR, glow, m.bulk * 0.38, m.bulk * 0.24, m.bulk * 0.34, 0, 0.02, 0);
  addCylinder(rig.joints.foreArmL, white, m.bulk * 0.07, m.foreArmLen * 0.72, m.bulk * 0.07, 0.03, -m.foreArmLen * 0.42, -m.bulk * 0.11, 0, 0, Math.PI / 2);
  addCylinder(rig.joints.foreArmR, white, m.bulk * 0.07, m.foreArmLen * 0.72, m.bulk * 0.07, 0.03, -m.foreArmLen * 0.42, m.bulk * 0.11, 0, 0, Math.PI / 2);
  for (let i = 0; i < 3; i += 1) {
    addBox(rig.joints.torso, dark, m.torsoW * 0.42, m.torsoH * 0.045, m.depth * 0.2, m.torsoW * 0.58, m.torsoH * (0.62 - i * 0.11), 0);
  }
  addBall(rig.joints.torso, accent, m.bulk * 0.055, m.bulk * 0.055, m.bulk * 0.04, m.torsoW * 0.62, m.torsoH * 0.24, -m.depth * 0.26);
  addBall(rig.joints.torso, accent, m.bulk * 0.055, m.bulk * 0.055, m.bulk * 0.04, m.torsoW * 0.62, m.torsoH * 0.24, m.depth * 0.26);
  addBox(rig.joints.head, accent, m.headR * 1.14, m.headR * 0.18, m.headR * 1.02, 0, m.headR * 0.76, 0);
}

function getMetrics(def: CharacterDef): RigMetrics {
  const height = def.proportions.height;
  const bulk = def.proportions.bulk;
  const depth = 0.26 * bulk;
  const torsoH = height * 0.34;
  const headH = height * 0.17 * def.proportions.headSize;
  return {
    height,
    bulk,
    depth,
    torsoH,
    torsoW: 0.54 * bulk,
    hipW: 0.48 * bulk,
    headR: headH * 0.62,
    foreArmLen: height * 0.2 * 0.82,
  };
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
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function addCapsule(
  parent: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  length: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CAPSULE, material);
  mesh.scale.set(radius, length * 0.5, radius);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
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
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CONE, material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(CYLINDER, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function addTorus(
  parent: THREE.Object3D,
  material: THREE.Material,
  scale: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(TORUS, material);
  mesh.scale.setScalar(scale);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}
