import * as THREE from 'three';
import { events } from '../core/events';
import type { Game } from '../Game';
import { characterById } from '../data/characters';
import { poseIdle, poseRun } from '../rigs/poses';
import { buildCharacterRig } from '../rigs/characterBuilders';
import type { Rig } from '../rigs/FighterRig';
import { button, el, uiRoot } from '../ui/dom';
import { applyUpdate, updateAvailable } from '../updates';
import type { Screen } from './Screen';

/**
 * Title screen: cartoon pistol logo + BIG FIGHT wordmark, the three starter
 * fighters goofing around underneath, tap/press anywhere to start.
 */
export class TitleScreen implements Screen {
  private root: HTMLElement | null = null;
  private group = new THREE.Group();
  private rigs: Rig[] = [];
  private t = 0;
  private started = false;

  constructor(private readonly onPlay: () => void) {}

  enter(game: Game): void {
    // Hero lineup: the three starters idling/jogging on the sky.
    const lineup: { id: string; x: number; jog: boolean }[] = [
      { id: 'kaze', x: -2.6, jog: true },
      { id: 'volt', x: 0, jog: false },
      { id: 'grim', x: 2.7, jog: false },
    ];
    for (const spot of lineup) {
      const def = characterById(spot.id);
      const rig = buildCharacterRig(def);
      rig.root.position.set(spot.x, -3.6, 8);
      rig.setFacing(spot.x > 0 ? -1 : 1);
      rig.setShadow(null, 0);
      this.group.add(rig.root);
      this.rigs.push(rig);
    }
    game.renderer.scene.add(this.group);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    this.root = uiRoot('bf-title-screen');
    const logo = el('div', 'bf-logo', this.root);
    logo.innerHTML = PISTOL_SVG;
    const word = el('div', 'bf-logo-word', this.root);
    word.innerHTML = '<span>BIG</span> <span class="bf-logo-fight">FIGHT</span>';
    el('div', 'bf-tap-hint', this.root).textContent = 'TAP TO FIGHT';

    const start = (): void => {
      if (this.started) return;
      this.started = true;
      events.emit('ui', { kind: 'confirm' });
      this.onPlay();
    };
    this.root.addEventListener('pointerdown', start);
    events.emit('music', { mood: 'menu' });

    // Quiet update check — a one-tap refresh beats force-quitting the webapp
    // (save data survives the reload untouched).
    void updateAvailable().then((available) => {
      if (!available || !this.root) return;
      const updateBtn = button('UPDATE', () => applyUpdate(), 'bf-button bf-button-yellow bf-update-pill', this.root);
      updateBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
  }

  exit(game: Game): void {
    game.renderer.scene.remove(this.group);
    for (const rig of this.rigs) rig.dispose();
    this.rigs = [];
    this.root?.remove();
    this.root = null;
  }

  update(game: Game, dt: number): void {
    this.t += dt;
    const blend = 1 - Math.exp(-14 * dt);
    for (let i = 0; i < this.rigs.length; i += 1) {
      const rig = this.rigs[i]!;
      rig.setPose(i === 0 ? poseRun(this.t, 0.7) : poseIdle(this.t + i * 1.7), blend);
      rig.update(dt);
    }
    // Keyboard start.
    if (game.input.state.anyPressed && this.t > 0.5) {
      if (!this.started) {
        this.started = true;
        events.emit('ui', { kind: 'confirm' });
        this.onPlay();
      }
    }
  }
}

/** Friendly cartoon pistol: chunky rounded shapes, thick outline, star muzzle. */
const PISTOL_SVG = `
<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg" aria-label="Big Fight pistol logo">
  <g stroke="#1e2a4a" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
    <rect x="18" y="38" width="170" height="42" rx="20" fill="#4ab0ff"/>
    <rect x="30" y="46" width="120" height="12" rx="6" fill="#8fd3ff" stroke="none"/>
    <path d="M60 78 L118 78 L106 122 Q102 132 90 130 L66 126 Q56 124 58 112 Z" fill="#ffc93e"/>
    <rect x="96" y="74" width="42" height="26" rx="12" fill="#3a8fe0"/>
    <path d="M112 84 q10 16 0 24" fill="none"/>
    <circle cx="196" cy="59" r="14" fill="#ff5a8a"/>
  </g>
  <g fill="#fff27a" stroke="#1e2a4a" stroke-width="5" stroke-linejoin="round">
    <path d="M212 59 l14 -8 -6 12 16 2 -16 6 8 12 -15 -6 -2 15 -7 -14 -12 8 6 -13 z"/>
  </g>
</svg>`;
