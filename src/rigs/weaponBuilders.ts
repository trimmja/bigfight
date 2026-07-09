import * as THREE from 'three';
import type { WeaponDef } from '../data/types';
import { attachGlow } from '../render/GlowSprites';
import { makeToonMaterial } from '../render/toon';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const CONE = new THREE.ConeGeometry(1, 1, 20);
const TORUS = new THREE.TorusGeometry(1, 0.07, 8, 28);

type Mats = {
  body: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  dark: THREE.MeshToonMaterial;
  white: THREE.MeshToonMaterial;
  glow: THREE.MeshToonMaterial;
};

export function buildWeaponModel(weapon: WeaponDef): THREE.Group {
  const group = new THREE.Group();
  group.name = `weapon:${weapon.id}`;
  group.position.set(0, -0.08, 0);

  const mats: Mats = {
    body: makeToonMaterial(0x586173),
    accent: makeToonMaterial(weapon.color),
    dark: makeToonMaterial(0x262936),
    white: makeToonMaterial(0xffffff),
    glow: makeToonMaterial(weapon.color),
  };
  mats.glow.emissive.setHex(weapon.color);
  mats.glow.emissiveIntensity = 0.35;
  group.userData.weaponMaterials = [mats.body, mats.accent, mats.dark, mats.white, mats.glow];

  switch (weapon.model) {
    case 'rustyPistol':
      buildRustyPistol(group, mats);
      break;
    case 'practiceSword':
      buildPracticeSword(group, mats);
      break;
    case 'laserRifle':
      buildLaserRifle(group, mats);
      break;
    case 'rocketLauncher':
      buildRocketLauncher(group, mats);
      break;
    case 'energyKatana':
      buildEnergyKatana(group, mats, weapon.color);
      break;
    case 'thunderHammer':
      buildThunderHammer(group, mats);
      break;
    case 'stickyBomb':
      buildStickyBomb(group, mats);
      break;
    case 'mineLayer':
      buildMineLayer(group, mats);
      break;
    case 'lightningStaff':
      buildLightningStaff(group, mats, weapon.color);
      break;
    case 'freezeWand':
      buildFreezeWand(group, mats, weapon.color);
      break;
    case 'fireWave':
      buildFireWave(group, mats);
      break;
    case 'blackHoleOrb':
      buildBlackHoleOrb(group, mats, weapon.color);
      break;
    default:
      buildRustyPistol(group, mats);
      break;
  }

  return group;
}

function buildRustyPistol(root: THREE.Group, mats: Mats): void {
  addBox(root, mats.body, 0.28, 0.26, 0.22, 0, -0.1, 0);
  addBox(root, mats.dark, 0.16, 0.52, 0.16, 0, -0.46, 0, 0.35);
  addBox(root, mats.accent, 0.14, 0.42, 0.14, 0, -0.57, 0, Math.PI / 2);
  addBox(root, mats.white, 0.1, 0.08, 0.08, 0.12, -0.05, 0);
}

function buildPracticeSword(root: THREE.Group, mats: Mats): void {
  addBox(root, mats.white, 0.1, 0.78, 0.06, 0, -0.46, 0);
  addBox(root, mats.accent, 0.42, 0.08, 0.08, 0, -0.08, 0);
  addBox(root, mats.dark, 0.13, 0.28, 0.13, 0, 0.12, 0);
  addSphere(root, mats.accent, 0.11, 0.11, 0.11, 0, 0.29, 0);
}

function buildLaserRifle(root: THREE.Group, mats: Mats): void {
  addBox(root, mats.body, 0.22, 0.72, 0.22, 0, -0.32, 0);
  addBox(root, mats.accent, 0.13, 0.84, 0.13, 0, -0.78, 0);
  addBox(root, mats.dark, 0.36, 0.12, 0.18, 0, -0.22, 0);
  addBox(root, mats.accent, 0.38, 0.08, 0.08, 0, -0.56, -0.12, -0.3);
  attachGlow(root, mats.accent.color.getHex(), 0.5, 0.55).position.set(0, -0.95, 0);
}

function buildRocketLauncher(root: THREE.Group, mats: Mats): void {
  const tube = addCylinder(root, mats.body, 0.22, 0.78, 0, -0.42, 0);
  tube.rotation.z = Math.PI / 2;
  const mouth = addCylinder(root, mats.dark, 0.25, 0.08, 0, -0.84, 0);
  mouth.rotation.z = Math.PI / 2;
  addBox(root, mats.accent, 0.18, 0.16, 0.36, 0, -0.42, 0);
  addBox(root, mats.dark, 0.14, 0.28, 0.14, 0, -0.08, 0.14, -0.2);
}

function buildEnergyKatana(root: THREE.Group, mats: Mats, color: number): void {
  addBox(root, mats.glow, 0.08, 0.9, 0.045, 0, -0.5, 0);
  addBox(root, mats.dark, 0.11, 0.28, 0.1, 0, 0.11, 0);
  addBox(root, mats.accent, 0.42, 0.06, 0.08, 0, -0.04, 0);
  attachGlow(root, color, 0.72, 0.45).position.set(0, -0.5, 0);
}

function buildThunderHammer(root: THREE.Group, mats: Mats): void {
  addBox(root, mats.dark, 0.12, 0.66, 0.12, 0, -0.2, 0);
  addBox(root, mats.body, 0.66, 0.34, 0.34, 0, -0.76, 0);
  addBox(root, mats.accent, 0.72, 0.1, 0.38, 0, -0.76, 0);
  addSphere(root, mats.white, 0.11, 0.11, 0.11, -0.36, -0.76, 0);
  addSphere(root, mats.white, 0.11, 0.11, 0.11, 0.36, -0.76, 0);
}

function buildStickyBomb(root: THREE.Group, mats: Mats): void {
  addSphere(root, mats.accent, 0.28, 0.28, 0.28, 0, -0.22, 0);
  addCylinder(root, mats.white, 0.29, 0.035, 0, -0.22, 0).rotation.z = Math.PI / 2;
  addBox(root, mats.dark, 0.1, 0.16, 0.1, 0, 0.02, 0);
}

function buildMineLayer(root: THREE.Group, mats: Mats): void {
  addBox(root, mats.body, 0.38, 0.42, 0.28, 0, -0.24, 0);
  addBox(root, mats.dark, 0.28, 0.1, 0.18, 0, -0.48, 0);
  addSphere(root, mats.accent, 0.08, 0.08, 0.08, 0.16, -0.18, 0.12);
  addBox(root, mats.accent, 0.26, 0.06, 0.06, 0, -0.04, 0);
}

function buildLightningStaff(root: THREE.Group, mats: Mats, color: number): void {
  addCylinder(root, mats.dark, 0.045, 0.95, 0, -0.35, 0);
  addSphere(root, mats.accent, 0.15, 0.15, 0.15, 0, -0.9, 0);
  addBox(root, mats.glow, 0.38, 0.06, 0.06, 0, -0.9, 0, 0.6);
  addBox(root, mats.glow, 0.38, 0.06, 0.06, 0, -0.9, 0, -0.6);
  attachGlow(root, color, 0.62, 0.6).position.set(0, -0.9, 0);
}

function buildFreezeWand(root: THREE.Group, mats: Mats, color: number): void {
  addCylinder(root, mats.body, 0.055, 0.72, 0, -0.25, 0);
  addSphere(root, mats.white, 0.12, 0.18, 0.12, 0, -0.68, 0);
  addCone(root, mats.accent, 0.16, 0.28, 0, -0.86, 0, Math.PI);
  attachGlow(root, color, 0.58, 0.55).position.set(0, -0.75, 0);
}

function buildFireWave(root: THREE.Group, mats: Mats): void {
  addSphere(root, mats.accent, 0.24, 0.2, 0.22, 0, -0.18, 0);
  addSphere(root, mats.accent, 0.1, 0.12, 0.09, -0.16, -0.4, 0.1);
  addSphere(root, mats.accent, 0.1, 0.12, 0.09, 0, -0.45, 0.12);
  addSphere(root, mats.accent, 0.1, 0.12, 0.09, 0.16, -0.4, 0.1);
  addBox(root, mats.dark, 0.25, 0.18, 0.2, 0, 0.02, 0);
}

function buildBlackHoleOrb(root: THREE.Group, mats: Mats, color: number): void {
  addSphere(root, mats.dark, 0.26, 0.26, 0.26, 0, -0.22, 0);
  const ring = new THREE.Mesh(TORUS, mats.accent);
  ring.scale.setScalar(0.32);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.22;
  root.add(ring);
  attachGlow(root, color, 0.72, 0.62).position.set(0, -0.22, 0);
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
  rotZ = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotZ;
  parent.add(mesh);
  return mesh;
}

function addSphere(
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
