import * as THREE from 'three';
import type { StageDef } from '../data/types';
import { buildColliders, type StageColliders } from '../physics/collision';
import { toonRamp } from '../render/toon';
import { decorateStage } from './decorations';

/**
 * Bright-cartoon (Fall Guys style) stage builder: chunky candy-colored
 * platforms with white top lips, sunny gradient sky, puffy clouds, a sun,
 * and pastel hills for depth. Theme flavor is driven purely by StageDef
 * colors (skyColor = sky tint, glowColor = platform candy color).
 */
export interface BuiltStage {
  group: THREE.Group;
  colliders: StageColliders;
  def: StageDef;
  dispose(): void;
}

const DEPTH = 3;

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 18, 12);


export function buildStage(def: StageDef, scene: THREE.Scene): BuiltStage {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const colliders = buildColliders(def);

  const toon = (color: number): THREE.MeshToonMaterial => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
    materials.push(m);
    return m;
  };
  const flat = (color: number, opacity = 1): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
    materials.push(m);
    return m;
  };

  const candy = new THREE.Color(def.glowColor);
  const candySide = candy.clone().multiplyScalar(0.72);
  const platMat = toon(candy.getHex());
  const platSideMat = toon(candySide.getHex());
  const lipMat = toon(0xffffff);

  // ---- sky ----
  group.add(buildSky(def, materials, textures));

  // ---- hills for depth ----
  const hillColors = [0x9fe098, 0x7fcf8e, 0xbce8a8];
  for (let i = 0; i < 3; i += 1) {
    const hill = new THREE.Mesh(SPHERE, toon(hillColors[i % hillColors.length]!));
    const hw = 16 + i * 7;
    hill.scale.set(hw, 6 + i * 2.5, 6);
    hill.position.set((i - 1) * 18, def.blast.bottom - 2 - i * 1.5, -14 - i * 4);
    group.add(hill);
  }

  // ---- clouds + sun ----
  const cloudMat = flat(0xffffff, 0.92);
  for (let i = 0; i < 6; i += 1) {
    group.add(buildCloud(cloudMat, -22 + i * 9 + (i % 2) * 3, 7 + (i % 3) * 3.4, -8 - (i % 4) * 3));
  }
  const sun = new THREE.Mesh(SPHERE, flat(0xfff3b8));
  sun.scale.setScalar(2.6);
  sun.position.set(def.blast.right - 4, def.blast.top - 3, -18);
  group.add(sun);

  // ---- platforms ----
  for (const platform of def.platforms) {
    const thickness = platform.oneWay ? 0.55 : 1.3;
    const slab = new THREE.Mesh(BOX, platSideMat);
    slab.scale.set(platform.w, thickness, DEPTH);
    slab.position.set(platform.x, platform.y - thickness * 0.5, 0);
    group.add(slab);

    // Bright candy top + white lip (reads like frosting).
    const top = new THREE.Mesh(BOX, platMat);
    top.scale.set(platform.w, Math.min(0.28, thickness * 0.5), DEPTH * 1.02);
    top.position.set(platform.x, platform.y - Math.min(0.14, thickness * 0.25), 0);
    group.add(top);
    const lip = new THREE.Mesh(BOX, lipMat);
    lip.scale.set(platform.w * 1.015, 0.09, DEPTH * 1.05);
    lip.position.set(platform.x, platform.y + 0.045, 0);
    group.add(lip);
  }

  // ---- walls (enclosed arenas): chunky candy pillars ----
  if (def.walls) {
    for (const wall of def.walls) {
      const pillar = new THREE.Mesh(BOX, platSideMat);
      pillar.scale.set(0.9, wall.h, DEPTH);
      pillar.position.set(wall.x, wall.y + wall.h * 0.5, 0);
      group.add(pillar);
      const cap = new THREE.Mesh(SPHERE, lipMat);
      cap.scale.set(0.62, 0.34, DEPTH * 0.52);
      cap.position.set(wall.x, wall.y + wall.h + 0.1, 0);
      group.add(cap);
    }
  }

  const decorations = decorateStage(group, def);

  scene.add(group);
  return {
    group,
    colliders,
    def,
    dispose(): void {
      decorations.dispose();
      scene.remove(group);
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      // BOX/SPHERE are shared module constants — never disposed.
    },
  };
}

function buildSky(
  def: StageDef,
  materials: THREE.Material[],
  textures: THREE.Texture[],
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const top = new THREE.Color(def.skyColor);
  const horizon = top.clone().lerp(new THREE.Color(0xffffff), 0.55);
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, `#${top.getHexString()}`);
  gradient.addColorStop(1, `#${horizon.getHexString()}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.push(texture);
  const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false, fog: false });
  materials.push(material);
  const width = def.blast.right - def.blast.left + 60;
  const height = def.blast.top - def.blast.bottom + 50;
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, (def.blast.top + def.blast.bottom) * 0.5 + 4, -24);
  mesh.renderOrder = -10;
  return mesh;
}

/** Puffy cloud: 3 overlapping squashed spheres sharing one material. */
function buildCloud(material: THREE.Material, x: number, y: number, z: number): THREE.Group {
  const cloud = new THREE.Group();
  const sizes: [number, number, number][] = [
    [1.6, 0.9, 1.1],
    [1.1, 0.75, 0.95],
    [1.2, 0.7, 0.9],
  ];
  const offsets = [0, -1.3, 1.25];
  for (let i = 0; i < 3; i += 1) {
    const puff = new THREE.Mesh(SPHERE, material);
    const s = sizes[i]!;
    puff.scale.set(s[0], s[1], s[2]);
    puff.position.set(offsets[i]!, i === 0 ? 0.15 : -0.1, 0);
    cloud.add(puff);
  }
  cloud.position.set(x, y, z);
  return cloud;
}
