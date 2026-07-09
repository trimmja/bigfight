import * as THREE from 'three';

/**
 * Shared bright-cartoon shading helpers. Every rig and stage in the game uses
 * this same 3-step ramp so the whole world shades consistently.
 */

let ramp: THREE.DataTexture | null = null;

export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const data = new Uint8Array([165, 165, 165, 255, 220, 220, 220, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.needsUpdate = true;
  return ramp;
}

/** New toon material in the shared ramp. Caller owns disposal. */
export function makeToonMaterial(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
}
