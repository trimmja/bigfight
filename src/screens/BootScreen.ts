import * as THREE from 'three';
import { COLOR_NEON_CYAN, COLOR_NEON_PINK } from '../config';
import type { Game } from '../Game';
import type { Screen } from './Screen';

/**
 * M1 smoke-test screen: spinning neon cube at fixed timestep.
 * Replaced by TitleScreen in M5a.
 */
export class BootScreen implements Screen {
  private group = new THREE.Group();
  private t = 0;
  private root: HTMLElement | null = null;

  enter(game: Game): void {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 3),
      new THREE.MeshBasicMaterial({ color: 0x0a0a12 }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      new THREE.LineBasicMaterial({ color: COLOR_NEON_CYAN }),
    );
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshBasicMaterial({ color: COLOR_NEON_PINK }),
    );
    this.group.add(cube, edges, inner);
    game.renderer.scene.add(this.group);

    this.root = document.createElement('div');
    this.root.className = 'neon';
    this.root.style.cssText =
      'position:absolute;bottom:12%;width:100%;text-align:center;' +
      'font-size:22px;font-weight:800;letter-spacing:8px;';
    this.root.textContent = 'BIG FIGHT';
    document.getElementById('ui')?.appendChild(this.root);
  }

  exit(game: Game): void {
    game.renderer.scene.remove(this.group);
    this.root?.remove();
  }

  update(_game: Game, dt: number): void {
    this.t += dt;
    this.group.rotation.y = this.t * 0.9;
    this.group.rotation.x = Math.sin(this.t * 0.6) * 0.5;
  }
}
