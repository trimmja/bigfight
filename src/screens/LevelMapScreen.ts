import { events } from '../core/events';
import type { Game } from '../Game';
import { LEVELS } from '../data/levels';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Campaign hub: a winding path of level bubbles. Beaten = green check,
 * next playable = bouncing gold, locked = gray. Boss levels get a crown.
 */
export class LevelMapScreen implements Screen {
  private root: HTMLElement | null = null;

  constructor(
    private readonly callbacks: {
      onPickLevel: (levelId: number) => void;
      onSettings: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-map-screen');

    const header = el('div', 'bf-map-header', this.root);
    el('h1', 'bf-map-title', header).textContent = 'CAMPAIGN';
    const gold = el('div', 'bf-gold-chip', header);
    gold.textContent = `💰 ${game.save.gold}`;
    button('⚙', () => this.callbacks.onSettings(), 'bf-button bf-button-round', header);

    const path = el('div', 'bf-map-path', this.root);
    const beaten = game.save.levelsBeaten;
    for (const level of LEVELS) {
      const isBeaten = level.id <= beaten;
      const isNext = level.id === beaten + 1;
      const locked = level.id > beaten + 1;
      const boss = level.bossId !== undefined;

      const node = el('div', 'bf-map-node' + (level.id % 2 === 0 ? ' bf-map-node-alt' : ''), path);
      const bubble = el(
        'button',
        'bf-level' +
          (isBeaten ? ' bf-level-beaten' : '') +
          (isNext ? ' bf-level-next' : '') +
          (locked ? ' bf-level-locked' : '') +
          (boss ? ' bf-level-boss' : ''),
        node,
      );
      bubble.type = 'button';
      bubble.textContent = boss ? '👑' : `${level.id}`;
      if (isBeaten) bubble.textContent = '✓';
      bubble.disabled = locked;
      el('div', 'bf-level-name', node).textContent = locked ? '???' : level.name;
      bubble.addEventListener('click', () => {
        if (locked) return;
        events.emit('ui', { kind: 'confirm' });
        this.callbacks.onPickLevel(level.id);
      });
    }

    events.emit('music', { mood: 'menu' });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
