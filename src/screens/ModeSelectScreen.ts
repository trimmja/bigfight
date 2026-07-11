import * as THREE from 'three';
import { events } from '../core/events';
import type { Game } from '../Game';
import { characterById } from '../data/characters';
import { poseIdle, poseRun } from '../rigs/poses';
import { buildCharacterRig } from '../rigs/characterBuilders';
import type { Rig } from '../rigs/FighterRig';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Game-mode select — the stop right after the title, styled like a versus
 * poster: two big leaning slabs, CAMPAIGN vs ONLINE. The fighters underneath
 * act it out — a lone hero jogging off on an adventure under CAMPAIGN, two
 * fighters squared up for a friendly brawl under ONLINE.
 */
export class ModeSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private group = new THREE.Group();
  private rigs: { rig: Rig; jog: boolean }[] = [];
  private t = 0;
  private picked = false;

  constructor(
    private readonly callbacks: {
      onCampaign: () => void;
      onOnline: () => void;
      onBack: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    // Each side's fighters act out their mode (solo journey vs friendly duel).
    const staging: { id: string; x: number; facing: 1 | -1; jog: boolean }[] = [
      { id: 'kaze', x: -4.4, facing: 1, jog: true },
      { id: 'volt', x: 3.2, facing: 1, jog: false },
      { id: 'grim', x: 5.4, facing: -1, jog: false },
    ];
    for (const spot of staging) {
      const def = characterById(spot.id);
      const rig = buildCharacterRig(def);
      rig.root.position.set(spot.x, -3.6, 8);
      rig.setFacing(spot.facing);
      rig.setShadow(null, 0);
      this.group.add(rig.root);
      this.rigs.push({ rig, jog: spot.jog });
    }
    game.renderer.scene.add(this.group);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    this.root = uiRoot('bf-mode-screen');

    const header = el('div', 'bf-map-header', this.root);
    button('◀', () => {
      events.emit('ui', { kind: 'back' });
      this.callbacks.onBack();
    }, 'bf-button bf-button-round', header);
    el('h1', 'bf-map-title', header).textContent = 'PICK YOUR FIGHT';

    const cards = el('div', 'bf-mode-cards', this.root);
    this.card(cards, {
      className: 'bf-mode-card-campaign',
      players: '1 PLAYER',
      name: 'CAMPAIGN',
      tag: 'Fight the story. Win new gear!',
      onPick: this.callbacks.onCampaign,
    });
    this.card(cards, {
      className: 'bf-mode-card-online',
      players: '2–4 PLAYERS',
      name: 'ONLINE',
      tag: 'Battle your friends!',
      onPick: this.callbacks.onOnline,
    });

    events.emit('music', { mood: 'menu' });
  }

  private card(
    parent: HTMLElement,
    opts: { className: string; players: string; name: string; tag: string; onPick: () => void },
  ): void {
    const card = el('button', `bf-mode-card ${opts.className}`, parent) as HTMLButtonElement;
    card.type = 'button';
    el('span', 'bf-mode-chip', card).textContent = opts.players;
    el('div', 'bf-mode-name', card).textContent = opts.name;
    el('div', 'bf-mode-tag', card).textContent = opts.tag;
    card.addEventListener('click', () => {
      if (this.picked) return;
      this.picked = true;
      events.emit('ui', { kind: 'confirm' });
      opts.onPick();
    });
  }

  exit(game: Game): void {
    game.renderer.scene.remove(this.group);
    for (const { rig } of this.rigs) rig.dispose();
    this.rigs = [];
    this.root?.remove();
    this.root = null;
  }

  update(_game: Game, dt: number): void {
    this.t += dt;
    const blend = 1 - Math.exp(-14 * dt);
    for (let i = 0; i < this.rigs.length; i += 1) {
      const { rig, jog } = this.rigs[i]!;
      rig.setPose(jog ? poseRun(this.t, 0.7) : poseIdle(this.t + i * 1.7), blend);
      rig.update(dt);
    }
  }
}
