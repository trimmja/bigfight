import * as THREE from 'three';
import { COLOR_BG } from '../config';
import type { StageDef } from '../data/types';
import { buildColliders, type StageColliders } from '../physics/collision';
import { attachGlow } from '../render/GlowSprites';
import { makeGrid } from '../render/textures';

export interface BuiltStage {
  group: THREE.Group;
  colliders: StageColliders;
  def: StageDef;
  dispose(): void;
}

const DEPTH = 3;

export function buildStage(def: StageDef, scene: THREE.Scene): BuiltStage {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const colliders = buildColliders(def);

  const bg = buildBackground(def, geometries, materials, textures);
  group.add(bg);

  for (const platform of def.platforms) {
    const thickness = platform.oneWay ? 0.35 : 1;
    const mesh = buildPlatform(def, platform.x, platform.y, platform.w, thickness, geometries, materials);
    group.add(mesh);
    const edge = buildEdgeStrip(def, platform.x, platform.y, platform.w, geometries, materials);
    group.add(edge);
  }

  if (def.walls) {
    for (const wall of def.walls) {
      const wallGroup = new THREE.Group();
      const wallMesh = buildBox(
        0.8,
        wall.h,
        DEPTH,
        darkMaterial(materials),
        geometries,
      );
      wallMesh.position.set(wall.x, wall.y + wall.h * 0.5, 0);
      wallGroup.add(wallMesh);
      const trim = buildBox(0.1, wall.h, DEPTH + 0.08, glowMaterial(def.glowColor, materials), geometries);
      trim.position.set(wall.x - Math.sign(wall.x || 1) * 0.42, wall.y + wall.h * 0.5, DEPTH * 0.52);
      wallGroup.add(trim);
      group.add(wallGroup);
    }
  }

  addDepthGlows(def, group);
  scene.add(group);

  return {
    group,
    colliders,
    def,
    dispose: () => {
      group.parent?.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

function buildPlatform(
  def: StageDef,
  x: number,
  topY: number,
  width: number,
  thickness: number,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): THREE.Mesh {
  const side = darkMaterial(materials);
  const top = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: makeGrid(def.glowColor),
    toneMapped: false,
  });
  materials.push(top);
  const geometry = new THREE.BoxGeometry(width, thickness, DEPTH);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, [
    side,
    side,
    top,
    side,
    side,
    side,
  ]);
  mesh.position.set(x, topY - thickness * 0.5, 0);
  return mesh;
}

function buildEdgeStrip(
  def: StageDef,
  x: number,
  topY: number,
  width: number,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): THREE.Mesh {
  const edge = buildBox(width, 0.08, 0.08, glowMaterial(def.glowColor, materials), geometries);
  edge.position.set(x, topY + 0.035, DEPTH * 0.5 + 0.08);
  return edge;
}

function buildBackground(
  def: StageDef,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
  textures: THREE.Texture[],
): THREE.Mesh {
  const texture = makeGradientTexture(def.skyColor, COLOR_BG);
  textures.push(texture);
  const width = def.blast.right - def.blast.left + 14;
  const height = def.blast.top - def.blast.bottom + 10;
  const geometry = new THREE.PlaneGeometry(width, height);
  geometries.push(geometry);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    depthWrite: false,
    depthTest: false,
  });
  materials.push(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((def.blast.left + def.blast.right) * 0.5, (def.blast.top + def.blast.bottom) * 0.5, -10);
  return mesh;
}

function addDepthGlows(def: StageDef, group: THREE.Group): void {
  const count = 8;
  const spanX = def.blast.right - def.blast.left;
  const spanY = def.blast.top - def.blast.bottom;
  for (let i = 0; i < count; i += 1) {
    const glow = attachGlow(group, def.glowColor, 1.2 + (i % 3) * 0.45, 0.08 + (i % 2) * 0.04);
    const t = (i + 0.5) / count;
    glow.position.set(
      def.blast.left + spanX * t,
      def.blast.bottom + spanY * (0.24 + ((i * 37) % 53) / 100),
      -4 - (i % 5),
    );
  }
}

function buildBox(
  sx: number,
  sy: number,
  sz: number,
  material: THREE.Material,
  geometries: THREE.BufferGeometry[],
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

function darkMaterial(materials: THREE.Material[]): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: 0x080a12 });
  materials.push(material);
  return material;
}

function glowMaterial(color: number, materials: THREE.Material[]): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
    toneMapped: false,
  });
  materials.push(material);
  return material;
}

function makeGradientTexture(top: number, bottom: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, cssHex(top));
  gradient.addColorStop(1, cssHex(bottom));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function cssHex(hex: number): string {
  return '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
}
