import * as THREE from 'three';
import type { StageDef } from '../data/types';
import { makeToonMaterial } from '../render/toon';

const SPHERE = new THREE.SphereGeometry(1, 18, 12);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 18);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const TORUS = new THREE.TorusGeometry(1, 0.06, 8, 32);
const HALF_TORUS = new THREE.TorusGeometry(1, 0.06, 8, 32, Math.PI);
const OCTA = new THREE.OctahedronGeometry(1, 0);

const WHITE = 0xffffff;
const DARK = 0x283044;
const GOLD = 0xffd45a;

export function decorateStage(group: THREE.Group, def: StageDef): { dispose(): void } {
  const kit = new DecorationKit(group);

  switch (def.theme) {
    case 'rooftop':
      decorateRooftop(kit, def);
      break;
    case 'cavern':
      decorateCavern(kit, def);
      break;
    case 'graveyard':
      decorateGraveyard(kit, def);
      break;
    case 'ghostship':
      decorateGhostship(kit, def);
      break;
    case 'peak':
      decoratePeak(kit, def);
      break;
    case 'finale':
      decorateFinale(kit, def);
      break;
  }

  return { dispose: () => kit.dispose() };
}

class DecorationKit {
  readonly root = new THREE.Group();
  private readonly materials: THREE.Material[] = [];

  constructor(parent: THREE.Group) {
    parent.add(this.root);
  }

  makeToon(color: number, opacity = 1): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    material.transparent = opacity < 0.98;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.95;
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (let i = 0; i < this.materials.length; i += 1) {
      this.materials[i]!.dispose();
    }
  }
}

function decorateRooftop(kit: DecorationKit, def: StageDef): void {
  const buildingMats = [
    kit.makeToon(mix(def.skyColor, 0x4e8fd9, 0.45)),
    kit.makeToon(mix(def.glowColor, 0x6f9be8, 0.45)),
    kit.makeToon(mix(def.skyColor, 0xa7daf5, 0.35)),
  ] as const;
  const windowMat = kit.makeToon(WHITE);
  const tankMat = kit.makeToon(mix(def.glowColor, WHITE, 0.35));
  const metalMat = kit.makeToon(DARK);
  const blimpMat = kit.makeToon(mix(def.skyColor, WHITE, 0.55));
  const flagMat = kit.makeToon(def.glowColor);

  const buildings = [
    { x: -16, h: 7.2, w: 4.4, z: -12.5 },
    { x: -10, h: 5.6, w: 4.8, z: -13.2 },
    { x: 10, h: 6.4, w: 5.2, z: -12.8 },
    { x: 16, h: 8.4, w: 4.2, z: -13.6 },
  ] as const;
  for (let i = 0; i < buildings.length; i += 1) {
    const building = buildings[i]!;
    const mat = buildingMats[i % buildingMats.length]!;
    addBox(kit.root, mat, building.w, building.h, 0.48, building.x, -3.7 + building.h * 0.5, building.z);
    for (const side of [-1, 1] as const) {
      addBox(kit.root, windowMat, 0.28, 0.36, 0.08, building.x + side * building.w * 0.24, building.h * 0.14, building.z + 0.3);
      addBox(kit.root, windowMat, 0.28, 0.36, 0.08, building.x + side * building.w * 0.24, building.h * 0.5, building.z + 0.3);
    }
  }

  addCylinder(kit.root, tankMat, 0.72, 0.44, 0.72, -13.8, 4.2, -11.9, 0, 0, Math.PI / 2);
  addBox(kit.root, metalMat, 0.08, 1.5, 0.08, -14.25, 3.2, -11.9, 0, 0, 0.16);
  addBox(kit.root, metalMat, 0.08, 1.5, 0.08, -13.35, 3.2, -11.9, 0, 0, -0.16);
  addCylinder(kit.root, tankMat, 0.62, 0.38, 0.62, 14.6, 5.9, -12.3, 0, 0, Math.PI / 2);
  addBox(kit.root, metalMat, 0.08, 1.4, 0.08, 14.15, 4.95, -12.3, 0, 0, 0.16);
  addBox(kit.root, metalMat, 0.08, 1.4, 0.08, 15.05, 4.95, -12.3, 0, 0, -0.16);

  addBall(kit.root, blimpMat, 1.8, 0.58, 0.5, 2.5, 10.5, -14.6);
  addCone(kit.root, blimpMat, 0.32, 0.58, 0.85, 10.5, -14.6, 0, 0, -Math.PI / 2);
  addBox(kit.root, flagMat, 0.72, 0.36, 0.06, 4.55, 10.2, -14.2, 0, 0, -0.1);
  addBar(kit.root, metalMat, -4.4, 5.6, -12.6, -3.9, 7.0, 0.04);
  addBar(kit.root, metalMat, -3.4, 5.6, -12.6, -3.9, 7.0, 0.04);
  addBar(kit.root, metalMat, 8.4, 4.5, -12.4, 9.1, 5.8, 0.04);
}

function decorateCavern(kit: DecorationKit, def: StageDef): void {
  const stoneMat = kit.makeToon(mix(def.skyColor, 0x5bc6c1, 0.4));
  const darkStoneMat = kit.makeToon(mix(def.glowColor, 0x208477, 0.35));
  const gooMat = kit.makeToon(def.glowColor, 0.72);
  const crystalMat = kit.makeToon(mix(def.glowColor, WHITE, 0.28));
  const vineMat = kit.makeToon(0x54bf70);

  const ceilingYs = [10.4, 11.5, 9.6, 12.0] as const;
  for (let i = 0; i < 4; i += 1) {
    const x = -12 + i * 8;
    addCone(kit.root, stoneMat, 0.7, 2.2 + i * 0.2, x, ceilingYs[i]!, -10.8 - i * 0.8, 0, 0, Math.PI);
  }
  for (let i = 0; i < 4; i += 1) {
    const x = -14 + i * 9;
    addCone(kit.root, darkStoneMat, 0.64, 1.9 + (i % 2) * 0.35, x, -1.15, -5.2 - i * 1.3);
  }
  addCylinder(kit.root, gooMat, 1.5, 0.06, 0.36, -7.5, -0.92, -3.4);
  addCylinder(kit.root, gooMat, 1.2, 0.06, 0.32, 8.3, -0.88, -3.8);
  addOcta(kit.root, crystalMat, 0.58, 0.96, 0.58, -2.8, -0.12, -5.5, 0.1, 0.2, 0.22);
  addOcta(kit.root, crystalMat, 0.38, 0.7, 0.38, -1.9, -0.2, -5.2, -0.2, 0.1, -0.25);
  addOcta(kit.root, crystalMat, 0.46, 0.86, 0.46, 5.8, 1.1, -9.2, 0.3, 0.2, 0.1);
  addOcta(kit.root, crystalMat, 0.34, 0.62, 0.34, 6.7, 0.72, -9.0, -0.2, 0.2, -0.22);
  addOcta(kit.root, crystalMat, 0.3, 0.55, 0.3, -9.6, 1.0, -8.2, -0.2, 0.1, 0.18);
  for (let i = 0; i < 4; i += 1) {
    addCapsule(kit.root, vineMat, 0.06, 2.1 + (i % 2) * 0.7, -10 + i * 6.4, 7.9 - (i % 2) * 0.5, -4.8 - i * 1.6, 0, 0, 0.1 * (i - 1));
  }
}

function decorateGraveyard(kit: DecorationKit, def: StageDef): void {
  const stoneMat = kit.makeToon(mix(def.skyColor, WHITE, 0.18));
  const darkStoneMat = kit.makeToon(mix(def.glowColor, DARK, 0.35));
  const barkMat = kit.makeToon(0x80614a);
  const wispMat = kit.makeToon(def.glowColor, 0.72);
  const fogMat = kit.makeToon(WHITE, 0.34);
  const moonMat = kit.makeToon(0xfff4c6);

  const stones = [
    [-11.4, -0.35, -3.3, 0.18],
    [-7.3, -0.45, -6.6, -0.14],
    [3.8, -0.35, -4.8, 0.1],
    [9.2, -0.44, -6.0, -0.2],
    [-4.8, -0.72, 2.0, 0.12],
    [11.8, -0.74, 2.2, -0.16],
  ] as const;
  for (const stone of stones) {
    addCapsule(kit.root, stoneMat, 0.34, 0.52, stone[0], stone[1], stone[2], 0, 0, stone[3]);
    addBox(kit.root, darkStoneMat, 0.34, 0.04, 0.06, stone[0] + 0.08, stone[1] + 0.08, stone[2] + 0.08, 0, 0, stone[3]);
  }

  addCapsule(kit.root, barkMat, 0.24, 2.6, -15.2, 0.4, -8.2, 0, 0, -0.2);
  addCapsule(kit.root, barkMat, 0.1, 1.25, -15.7, 1.55, -8.2, 0, 0, 0.8);
  addCapsule(kit.root, barkMat, 0.09, 1.0, -14.6, 1.7, -8.2, 0, 0, -0.74);
  addBall(kit.root, kit.makeToon(0xbfa17a), 0.18, 0.18, 0.18, -15.2, 2.0, -8.2);
  addBall(kit.root, wispMat, 0.28, 0.28, 0.28, -5.6, 2.6, -6.8);
  addBall(kit.root, wispMat, 0.22, 0.22, 0.22, 1.4, 3.3, -8.6);
  addBall(kit.root, wispMat, 0.24, 0.24, 0.24, 8.4, 2.4, -7.0);
  addBox(kit.root, fogMat, 28, 0.5, 0.16, 0, -0.55, -2.5);
  addBall(kit.root, moonMat, 1.35, 1.35, 0.2, def.blast.right - 5.2, def.blast.top - 3.8, -13.8);
}

function decorateGhostship(kit: DecorationKit, def: StageDef): void {
  const mastMat = kit.makeToon(0x8c6a4a);
  const sailMat = kit.makeToon(mix(def.skyColor, WHITE, 0.52), 0.9);
  const ropeMat = kit.makeToon(DARK);
  const lanternMat = kit.makeToon(0xffc86a, 0.78);
  const wheelMat = kit.makeToon(0xa46f35);
  const waveMat = kit.makeToon(mix(def.glowColor, WHITE, 0.35));

  addCapsule(kit.root, mastMat, 0.12, 7.2, -6.6, 3.9, -7.8);
  addCapsule(kit.root, mastMat, 0.11, 6.4, 5.8, 3.6, -8.8);
  addBox(kit.root, sailMat, 2.2, 1.75, 0.08, -5.8, 5.5, -7.5, 0, 0.1, -0.1);
  addBox(kit.root, sailMat, 1.8, 1.35, 0.08, -6.0, 3.5, -7.5, 0, -0.1, 0.08);
  addBox(kit.root, sailMat, 2.0, 1.45, 0.08, 6.4, 5.0, -8.5, 0, -0.08, 0.12);
  addBox(kit.root, sailMat, 1.55, 1.15, 0.08, 6.3, 3.25, -8.5, 0, 0.08, -0.08);
  addBar(kit.root, ropeMat, -8.9, 6.9, -7.4, -3.6, 2.1, 0.035);
  addBar(kit.root, ropeMat, -3.9, 6.8, -7.4, -8.6, 2.0, 0.035);
  addBar(kit.root, ropeMat, 3.8, 6.2, -8.4, 8.5, 2.2, 0.035);
  addBar(kit.root, ropeMat, 8.1, 6.1, -8.4, 3.5, 2.0, 0.035);
  for (const x of [-9.2, 0.4, 9.0] as const) {
    addCapsule(kit.root, ropeMat, 0.035, 0.64, x, 2.45, -5.0);
    addBall(kit.root, lanternMat, 0.24, 0.32, 0.2, x, 2.05, -5.0);
  }
  addTorus(kit.root, wheelMat, 0.58, -11.3, 0.85, -4.6);
  addBar(kit.root, wheelMat, -11.88, 0.85, -4.6, -10.72, 0.85, 0.04);
  addBar(kit.root, wheelMat, -11.3, 0.27, -4.6, -11.3, 1.43, 0.04);
  addBar(kit.root, wheelMat, -11.7, 0.45, -4.6, -10.9, 1.25, 0.04);
  addBar(kit.root, wheelMat, -10.9, 0.45, -4.6, -11.7, 1.25, 0.04);
  for (let i = 0; i < 5; i += 1) {
    addBall(kit.root, waveMat, 1.1, 0.18, 0.28, -14 + i * 7, -1.4 - (i % 2) * 0.12, -2.4 - i * 0.6);
  }
}

function decoratePeak(kit: DecorationKit, def: StageDef): void {
  const mountainMat = kit.makeToon(mix(def.skyColor, 0x7da6df, 0.38));
  const snowMat = kit.makeToon(WHITE);
  const cloudMat = kit.makeToon(WHITE, 0.9);
  const rainbowMats = [
    kit.makeToon(0xff7a8a, 0.68),
    kit.makeToon(0xffd66b, 0.68),
    kit.makeToon(0x71d9ff, 0.68),
  ] as const;
  const birdMat = kit.makeToon(DARK);

  addCone(kit.root, mountainMat, 2.8, 5.4, -13.5, 0.5, -13.6);
  addCone(kit.root, snowMat, 1.1, 1.2, -13.5, 3.2, -13.5);
  addCone(kit.root, mountainMat, 3.3, 6.2, 12.4, 0.2, -14.0);
  addCone(kit.root, snowMat, 1.25, 1.35, 12.4, 3.25, -13.9);

  buildCloud(kit.root, cloudMat, -8.2, -1.65, -2.4, 1.0);
  buildCloud(kit.root, cloudMat, 8.4, -1.85, -2.8, 0.82);

  addHalfTorus(kit.root, rainbowMats[0], 4.6, 3.0, 6.2, -11.8);
  addHalfTorus(kit.root, rainbowMats[1], 4.25, 3.0, 6.2, -11.7);
  addHalfTorus(kit.root, rainbowMats[2], 3.9, 3.0, 6.2, -11.6);

  addBird(kit.root, birdMat, -4.4, 9.3, -14.4, 0.45);
  addBird(kit.root, birdMat, 1.8, 10.2, -14.8, 0.36);
  addBird(kit.root, birdMat, 6.0, 8.8, -14.2, 0.42);
}

function decorateFinale(kit: DecorationKit, def: StageDef): void {
  const pillarMat = kit.makeToon(mix(def.glowColor, WHITE, 0.25));
  const confettiMat = kit.makeToon(0x72d6ff);
  const trophyMat = kit.makeToon(GOLD);
  const darkMat = kit.makeToon(DARK);
  const flagA = kit.makeToon(0xff6f91);
  const flagB = kit.makeToon(0x7ee6a2);
  const lightMat = kit.makeToon(WHITE, 0.24);
  const crowdMats = [
    kit.makeToon(0xff7a8a),
    kit.makeToon(0x78d8ff),
    kit.makeToon(0x9ee27a),
    kit.makeToon(0xffd66b),
  ] as const;

  addCylinder(kit.root, pillarMat, 0.42, 4.8, 0.42, -16, 2.2, -8.8);
  addCylinder(kit.root, pillarMat, 0.42, 4.8, 0.42, 16, 2.2, -8.8);
  addBox(kit.root, confettiMat, 0.5, 0.16, 0.06, -16.4, 5.2, -8.4, 0.2, 0, 0.5);
  addBox(kit.root, flagA, 0.42, 0.14, 0.06, 15.6, 5.4, -8.4, -0.2, 0, -0.45);

  addCylinder(kit.root, darkMat, 1.2, 0.22, 1.2, 0, 0.15, -8.0);
  addCylinder(kit.root, trophyMat, 0.62, 0.9, 0.48, 0, 1.08, -8.0);
  addBall(kit.root, trophyMat, 0.88, 0.58, 0.48, 0, 1.85, -8.0);
  addTorus(kit.root, trophyMat, 0.52, -0.75, 1.78, -8.0, 0, 0.2, 0.1);
  addTorus(kit.root, trophyMat, 0.52, 0.75, 1.78, -8.0, 0, -0.2, -0.1);

  addCapsule(kit.root, darkMat, 0.07, 3.8, -10.8, 5.0, -6.5);
  addCapsule(kit.root, darkMat, 0.07, 3.8, 10.8, 5.0, -6.5);
  addBar(kit.root, darkMat, -10.8, 6.6, -6.5, 10.8, 6.6, 0.035);
  for (let i = 0; i < 4; i += 1) {
    addBox(kit.root, i % 2 === 0 ? flagA : flagB, 1.1, 0.5, 0.06, -6.8 + i * 4.5, 6.25, -6.3, 0, 0, 0.16 * (i % 2 === 0 ? 1 : -1));
  }

  addCone(kit.root, lightMat, 1.4, 5.8, -7.5, 3.4, -5.0, 0, 0, -0.28);
  addCone(kit.root, lightMat, 1.4, 5.8, 7.5, 3.4, -5.0, 0, 0, 0.28);
  for (let i = 0; i < 6; i += 1) {
    addBall(kit.root, crowdMats[i % crowdMats.length]!, 0.22, 0.22, 0.22, -9 + i * 3.6, -0.65 + (i % 2) * 0.12, -10.8);
  }
}

function buildCloud(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, scale: number): void {
  addBall(parent, material, 1.4 * scale, 0.42 * scale, 0.36 * scale, x, y, z);
  addBall(parent, material, 0.9 * scale, 0.36 * scale, 0.32 * scale, x - 1.0 * scale, y - 0.02 * scale, z);
  addBall(parent, material, 1.0 * scale, 0.34 * scale, 0.3 * scale, x + 1.05 * scale, y - 0.05 * scale, z);
}

function addBird(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, scale: number): void {
  addBar(parent, material, x - 0.32 * scale, y, z, x, y + 0.22 * scale, 0.025 * scale);
  addBar(parent, material, x, y + 0.22 * scale, z, x + 0.32 * scale, y, 0.025 * scale);
}

function addBar(
  parent: THREE.Object3D,
  material: THREE.Material,
  x1: number,
  y1: number,
  z: number,
  x2: number,
  y2: number,
  thickness: number,
): THREE.Mesh {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const mesh = new THREE.Mesh(BOX, material);
  mesh.scale.set(Math.hypot(dx, dy), thickness, thickness);
  mesh.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, z);
  mesh.rotation.z = Math.atan2(dy, dx);
  parent.add(mesh);
  return mesh;
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

function addHalfTorus(
  parent: THREE.Object3D,
  material: THREE.Material,
  scale: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(HALF_TORUS, material);
  mesh.scale.setScalar(scale);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addOcta(
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
  const mesh = new THREE.Mesh(OCTA, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

function mix(color: number, target: number, amount: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(target), amount).getHex();
}
