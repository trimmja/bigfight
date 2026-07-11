import { events } from '../core/events';
import type { Game } from '../Game';
import { pick, rand } from '../core/math';
import { CHARACTERS, characterById } from '../data/characters';
import type { CharacterDef } from '../data/types';
import { isCharacterUnlocked, unlockedCharacters } from '../progression';
import { characterCssColor } from '../ui/cardColors';
import { button, el, uiRoot } from '../ui/dom';
import { characterPortrait } from '../ui/portraits';
import { buildRosterGrid, type RosterGrid } from '../ui/rosterGrid';
import type { Screen } from './Screen';

/** The roster board is built for the game we're growing into. */
export const ROSTER_CAPACITY = 20;

/**
 * Character select: full-screen Smash-style roster. Tap a face, the bottom
 * bar names your pick; locked fighters are ?-silhouettes, empty slots are
 * ?-tiles waiting for future fighters.
 */
export class CharacterSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private grid: RosterGrid | null = null;
  private nameEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private selectedId = 'volt';

  constructor(
    private readonly callbacks: {
      onPick: (characterId: string) => void;
      onBack: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-select-screen');
    const header = el('div', 'bf-select-header', this.root);
    button('◀', () => this.callbacks.onBack(), 'bf-button bf-button-round', header);
    el('h1', 'bf-select-title', header).textContent = 'PICK YOUR FIGHTER';

    this.grid = buildRosterGrid(this.root, {
      slots: CHARACTERS.map((def) => this.slotFor(def, game)),
      capacity: ROSTER_CAPACITY,
      selectedId: this.selectedId,
      onSelect: (id) => this.select(id, true),
    });

    const bar = el('div', 'bf-roster-bar', this.root);
    const who = el('div', 'bf-roster-who', bar);
    this.nameEl = el('h2', 'bf-roster-name', who);
    this.tagEl = el('p', 'bf-roster-tagline', who);
    this.statsEl = el('div', 'bf-roster-stats', bar);
    button('RANDOM', () => {
      this.select(pick(rand, unlockedCharacters(game.save)).id, true);
    }, 'bf-button bf-button-yellow', bar);
    button('PICK WEAPON ▶', () => {
      events.emit('ui', { kind: 'confirm' });
      this.callbacks.onPick(this.selectedId);
    }, 'bf-button bf-button-green bf-button-big', bar);

    this.select(this.selectedId, false);
  }

  private slotFor(def: CharacterDef, game: Game) {
    const locked = !isCharacterUnlocked(def, game.save);
    return {
      id: def.id,
      name: def.name,
      portrait: characterPortrait(def.id),
      color: characterCssColor(def),
      locked,
      lockHint: def.unlock.type === 'level' ? `Beat level ${def.unlock.level}` : 'Unlock in Market',
    };
  }

  private select(id: string, sfx: boolean): void {
    this.selectedId = id;
    if (sfx) events.emit('ui', { kind: 'move' });
    this.grid?.setSelected(id);
    const def = characterById(id);
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
    el('span', 'bf-stat-label', this.statsEl).textContent = label;
    const track = el('div', 'bf-stat-track', this.statsEl);
    const fill = el('div', 'bf-stat-fill', track);
    fill.style.width = `${Math.round(Math.max(0.08, Math.min(1, frac)) * 100)}%`;
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.grid = null;
  }

  update(): void {}
}
