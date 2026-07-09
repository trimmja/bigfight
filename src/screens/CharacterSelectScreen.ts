import * as THREE from 'three';
import { events } from '../core/events';
import type { Game } from '../Game';
import { pick, rand } from '../core/math';
import { CHARACTERS, characterById } from '../data/characters';
import type { CharacterDef } from '../data/types';
import { isCharacterUnlocked, unlockedCharacters } from '../progression';
import { FighterRig } from '../rigs/FighterRig';
import { poseIdle, poseAttack } from '../rigs/poses';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Character select: card grid on the left, live 3D preview (idling, punches
 * when you tap them) on the right, stat bars, RANDOM option.
 */
export class CharacterSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private preview: FighterRig | null = null;
  private previewGroup = new THREE.Group();
  private selectedId: string;
  private t = 0;
  private punchT = -1;
  private nameEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private cards = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly callbacks: {
      onPick: (characterId: string) => void;
      onBack: () => void;
    },
  ) {
    this.selectedId = 'volt';
  }

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    game.renderer.scene.add(this.previewGroup);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    this.root = uiRoot('bf-select-screen');
    const header = el('div', 'bf-select-header', this.root);
    button('◀', () => this.callbacks.onBack(), 'bf-button bf-button-round', header);
    el('h1', 'bf-select-title', header).textContent = 'CHOOSE YOUR FIGHTER';

    const body = el('div', 'bf-select-body', this.root);
    const grid = el('div', 'bf-select-grid', body);
    for (const def of CHARACTERS) {
      const unlocked = isCharacterUnlocked(def, game.save);
      const card = el('button', 'bf-card' + (unlocked ? '' : ' bf-card-locked'), grid);
      card.type = 'button';
      const dot = el('span', 'bf-card-dot', card);
      dot.style.background = `#${def.palette.core.toString(16).padStart(6, '0')}`;
      el('span', 'bf-card-name', card).textContent = unlocked ? def.name : '???';
      if (!unlocked) {
        el('span', 'bf-card-lock', card).textContent =
          def.unlock.type === 'level' ? `Beat level ${def.unlock.level}` : `💰 in Market`;
      }
      card.disabled = !unlocked;
      card.addEventListener('click', () => this.select(game, def.id, true));
      this.cards.set(def.id, card);
    }
    // Random card.
    const randomCard = el('button', 'bf-card bf-card-random', grid);
    randomCard.type = 'button';
    el('span', 'bf-card-dot', randomCard).textContent = '🎲';
    el('span', 'bf-card-name', randomCard).textContent = 'RANDOM';
    randomCard.addEventListener('click', () => {
      const options = unlockedCharacters(game.save);
      this.select(game, pick(rand, options).id, true);
    });

    const side = el('div', 'bf-select-side', body);
    this.nameEl = el('h2', 'bf-select-name', side);
    this.tagEl = el('p', 'bf-select-tag', side);
    this.statsEl = el('div', 'bf-select-stats', side);
    button('FIGHT! ▶', () => this.callbacks.onPick(this.selectedId), 'bf-button bf-button-green bf-button-big', side);

    this.select(game, this.selectedId, false);
  }

  private select(_game: Game, id: string, sfx: boolean): void {
    this.selectedId = id;
    if (sfx) events.emit('ui', { kind: 'move' });
    for (const [cardId, card] of this.cards) {
      card.classList.toggle('bf-card-selected', cardId === id);
    }
    const def = characterById(id);
    this.buildPreview(def);
    if (this.nameEl) this.nameEl.textContent = def.name.toUpperCase();
    if (this.tagEl) this.tagEl.textContent = def.tagline;
    if (this.statsEl) {
      this.statsEl.replaceChildren();
      this.statBar('SPEED', def.speed / 10);
      this.statBar('POWER', (def.power - 0.85) / 0.3);
      this.statBar('WEIGHT', (def.weight - 80) / 40);
      this.statBar('JUMP', (def.jumpVel - 12) / 4.5);
    }
    this.punchT = 0; // greet with a punch
  }

  private statBar(label: string, frac: number): void {
    if (!this.statsEl) return;
    const row = el('div', 'bf-stat-row', this.statsEl);
    el('span', 'bf-stat-label', row).textContent = label;
    const track = el('div', 'bf-stat-track', row);
    const fill = el('div', 'bf-stat-fill', track);
    fill.style.width = `${Math.round(Math.max(0.08, Math.min(1, frac)) * 100)}%`;
  }

  private buildPreview(def: CharacterDef): void {
    if (this.preview) {
      this.previewGroup.remove(this.preview.root);
      this.preview.dispose();
    }
    this.preview = new FighterRig({ palette: def.palette, proportions: def.proportions });
    this.preview.root.position.set(3.4, -1.2, 10);
    this.preview.setShadow(null, 0);
    this.previewGroup.add(this.preview.root);
  }

  exit(game: Game): void {
    game.renderer.scene.remove(this.previewGroup);
    this.preview?.dispose();
    this.preview = null;
    this.root?.remove();
    this.root = null;
  }

  update(_game: Game, dt: number): void {
    this.t += dt;
    if (!this.preview) return;
    const blend = 1 - Math.exp(-14 * dt);
    if (this.punchT >= 0) {
      this.punchT += dt * 2.4;
      if (this.punchT >= 1) this.punchT = -1;
      else this.preview.setPose(poseAttack('finisher', this.punchT), blend);
    }
    if (this.punchT < 0) this.preview.setPose(poseIdle(this.t), blend);
    this.preview.root.rotation.y = Math.sin(this.t * 0.5) * 0.35;
    this.preview.update(dt);
  }
}
