/**
 * Additive glow sprites — the cheap billboarded halo attached to fighters,
 * projectiles, pickups, etc. Materials are shared per (color, opacity) so many
 * glows of the same tint batch into one draw-friendly state.
 */
import * as THREE from 'three';
import { makeGlowDisc } from './textures';

const _materials = new Map<string, THREE.SpriteMaterial>();

function getMaterial(color: number, opacity: number): THREE.SpriteMaterial {
  const key = `${color}:${opacity}`;
  let mat = _materials.get(key);
  if (!mat) {
    mat = new THREE.SpriteMaterial({
      map: makeGlowDisc(),
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    _materials.set(key, mat);
  }
  return mat;
}

/**
 * Attach an additive glow sprite to `parent` and return it. The caller owns
 * positioning (via the sprite's local transform) and removal (`parent.remove`).
 * `size` is the sprite's world-space edge length; `opacity` defaults to 1.
 */
export function attachGlow(
  parent: THREE.Object3D,
  color: number,
  size: number,
  opacity = 1,
): THREE.Sprite {
  const sprite = new THREE.Sprite(getMaterial(color, opacity));
  sprite.scale.set(size, size, 1);
  parent.add(sprite);
  return sprite;
}
