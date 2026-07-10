import { events } from '../core/events';
import type { Game } from '../Game';
import { characterById } from '../data/characters';
import { buildCharacterGrid, type CharacterGrid } from '../ui/characterGrid';
import { button, el, uiRoot } from '../ui/dom';
import { FighterTurntable } from '../ui/fighterPreview';
import type { Screen } from './Screen';

/**
 * Character select: card grid on the left, live 3D preview (idling, punches
 * when you tap them) on the right, stat bars, RANDOM option. Grid + preview
 * live in ui/characterGrid.ts + ui/fighterPreview.ts (shared with the online
 * select).
 */
export class CharacterSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private turntable: FighterTurntable | null = null;
  private grid: CharacterGrid | null = null;
  private selectedId: string;
  private nameEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;

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
    this.turntable = new FighterTurntable();
    game.renderer.scene.add(this.turntable.group);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    this.root = uiRoot('bf-select-screen');
    const header = el('div', 'bf-select-header', this.root);
    button('◀', () => this.callbacks.onBack(), 'bf-button bf-button-round', header);
    el('h1', 'bf-select-title', header).textContent = 'CHOOSE YOUR FIGHTER';

    const body = el('div', 'bf-select-body', this.root);
    this.grid = buildCharacterGrid(body, game.save, (id) => this.select(game, id, true));

    // Drag anywhere that isn't a button to spin the fighter around.
    this.turntable.attachDrag(this.root);

    const side = el('div', 'bf-select-side', body);
    this.nameEl = el('h2', 'bf-select-name', side);
    this.tagEl = el('p', 'bf-select-tag', side);
    // On short screens (phones, landscape) stats hide behind this toggle so
    // they don't overlay the character preview.
    button(
      '📊 STATS',
      () => side.classList.toggle('bf-stats-open'),
      'bf-button bf-stats-toggle',
      side,
    );
    this.statsEl = el('div', 'bf-select-stats', side);
    button('FIGHT! ▶', () => this.callbacks.onPick(this.selectedId), 'bf-button bf-button-green bf-button-big', side);

    this.select(game, this.selectedId, false);
  }

  private select(_game: Game, id: string, sfx: boolean): void {
    this.selectedId = id;
    if (sfx) events.emit('ui', { kind: 'move' });
    this.grid?.setSelected(id);
    const def = characterById(id);
    this.turntable?.setCharacter(def);
    if (this.nameEl) this.nameEl.textContent = def.name.toUpperCase();
    if (this.tagEl) this.tagEl.textContent = def.tagline;
    if (this.statsEl) {
      this.statsEl.replaceChildren();
      this.statBar('SPEED', def.speed / 10);
      this.statBar('POWER', (def.power - 0.85) / 0.3);
      this.statBar('WEIGHT', (def.weight - 80) / 40);
      this.statBar('JUMP', (def.jumpVel - 12) / 4.5);
    }
  }

  private statBar(label: string, frac: number): void {
    if (!this.statsEl) return;
    const row = el('div', 'bf-stat-row', this.statsEl);
    el('span', 'bf-stat-label', row).textContent = label;
    const track = el('div', 'bf-stat-track', row);
    const fill = el('div', 'bf-stat-fill', track);
    fill.style.width = `${Math.round(Math.max(0.08, Math.min(1, frac)) * 100)}%`;
  }

  exit(game: Game): void {
    if (this.turntable) {
      game.renderer.scene.remove(this.turntable.group);
      this.turntable.dispose();
      this.turntable = null;
    }
    this.grid = null;
    this.root?.remove();
    this.root = null;
  }

  update(game: Game, dt: number): void {
    this.turntable?.update(game.renderer.camera, dt);
  }
}
