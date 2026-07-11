import * as THREE from 'three';
import { characterById } from '../data/characters';
import { weaponById } from '../data/weapons';
import { buildCharacterRig } from '../rigs/characterBuilders';
import { buildWeaponModel } from '../rigs/weaponBuilders';
import { poseIdle } from '../rigs/poses';

/**
 * Smash-style select tiles need a face shot of every fighter (and a beauty
 * shot of every weapon). Rather than hand-author icons, we photograph the
 * actual 3D models once per session with a small offscreen renderer — new
 * fighters get portraits for free and the art can never drift.
 */

const SIZE = 256;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;

/** Data URL of a head-and-shoulders portrait for one character. */
export function characterPortrait(characterId: string): string {
  const key = `character:${characterId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rig = buildCharacterRig(characterById(characterId));
  rig.setShadow(null, 0);
  // t=0 keeps the idle sway centered — any other phase bakes a lean into
  // every portrait and the faces sit visibly off-center in their tiles.
  rig.setPose(poseIdle(0), 1);
  rig.root.rotation.y = -Math.PI / 2; // face the camera
  const url = photograph(rig.root, 'face');
  rig.dispose();
  cache.set(key, url);
  return url;
}

/** Data URL of a three-quarter beauty shot for one weapon. */
export function weaponPortrait(weaponId: string): string {
  const key = `weapon:${weaponId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const model = buildWeaponModel(weaponById(weaponId));
  model.rotation.y = -Math.PI / 4; // three-quarter view reads the shape best
  const url = photograph(model, 'full');
  cache.set(key, url);
  return url;
}

function photograph(subject: THREE.Object3D, framing: 'face' | 'full'): string {
  const scene = new THREE.Scene();
  // Same bright-cartoon light recipe as the live Renderer, so portraits match.
  const hemisphere = new THREE.HemisphereLight(0xd8efff, 0xffe3b8, 1.15);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(8, 18, 12);
  scene.add(hemisphere, sun, subject);

  const box = new THREE.Box3().setFromObject(subject);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  // 'face' fills the frame with the head, Smash-roster style; 'full' fits all.
  const focusY = framing === 'face' ? box.max.y - size.y * 0.12 : center.y;
  const radius = framing === 'face' ? size.y * 0.18 : Math.max(size.x, size.y) * 0.62;
  const distance = radius / Math.tan((camera.fov * Math.PI) / 360);
  camera.position.set(center.x, focusY, box.max.z + distance);
  camera.lookAt(center.x, focusY, center.z);

  const target = getRenderer();
  target.render(scene, camera);
  return target.domElement.toDataURL('image/png');
}

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}
