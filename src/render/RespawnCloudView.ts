import * as THREE from 'three';
import type { SlotState } from '../match/MatchState';
import { makeToonMaterial } from './toon';

/**
 * Respawn cloud VISUALS (view-only — the machine lives in MatchState slots;
 * this just draws a puffy platform wherever the sim says one is).
 */

const SPHERE = new THREE.SphereGeometry(1, 18, 12);

export class RespawnCloudView {
  private readonly clouds: THREE.Group[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    slotColors: readonly number[],
    playerCount: number,
  ) {
    for (let i = 0; i < playerCount; i += 1) {
      const group = new THREE.Group();
      const white = makeToonMaterial(0xffffff);
      const trim = makeToonMaterial(slotColors[i] ?? 0xffffff);
      this.materials.push(white, trim);

      const puffs: [number, number, number, number][] = [
        [0, 0, 0, 0.85],
        [-0.75, -0.08, 0.1, 0.6],
        [0.75, -0.08, 0.1, 0.6],
        [-0.35, 0.18, -0.15, 0.5],
        [0.4, 0.2, -0.1, 0.55],
      ];
      for (const [x, y, z, s] of puffs) {
        const puff = new THREE.Mesh(SPHERE, white);
        puff.position.set(x, y, z);
        puff.scale.set(s, s * 0.62, s * 0.8);
        group.add(puff);
      }
      const ring = new THREE.Mesh(SPHERE, trim);
      ring.scale.set(1.15, 0.12, 0.9);
      ring.position.y = -0.28;
      group.add(ring);

      group.visible = false;
      this.scene.add(group);
      this.clouds.push(group);
    }
  }

  /** Sync cloud meshes to the respawn machine each rendered frame. */
  update(slots: readonly SlotState[], time: number): void {
    for (let i = 0; i < this.clouds.length; i += 1) {
      const cloud = this.clouds[i]!;
      const slot = slots[i];
      if (!slot || slot.respawnPhase < 2) {
        cloud.visible = false;
        continue;
      }
      cloud.visible = true;
      const bob = Math.sin(time * 2.2 + i) * 0.06;
      cloud.position.set(slot.cloudX, slot.cloudY - 0.35 + bob, 0.1);
    }
  }

  dispose(): void {
    for (const cloud of this.clouds) this.scene.remove(cloud);
    for (const material of this.materials) material.dispose();
    this.clouds.length = 0;
    this.materials.length = 0;
  }
}
