import { events } from '../core/events';
import type { Game } from '../Game';
import type { MaterialId } from '../data/types';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

const MATERIAL_LABELS: Record<MaterialId, { name: string; icon: string }> = {
  boneShard: { name: 'Bone Shards', icon: '🦴' },
  slimeGoo: { name: 'Slime Goo', icon: '🟢' },
  ghostEssence: { name: 'Ghost Essence', icon: '👻' },
  feather: { name: 'Feathers', icon: '🪶' },
  energyCore: { name: 'Energy Cores', icon: '⚡' },
};

export interface LevelResult {
  won: boolean;
  levelId: number;
  goldEarned: number;
  materialsEarned: Partial<Record<MaterialId, number>>;
}

/**
 * Post-level results: victory or defeat, loot earned, and the fork Ryder
 * designed — go to the MARKET or skip straight onward.
 */
export class ResultsScreen implements Screen {
  private root: HTMLElement | null = null;

  constructor(
    private readonly result: LevelResult,
    private readonly callbacks: {
      onMarket: () => void;
      onContinue: () => void;
      onRetry: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-modal-backdrop bf-results');
    const panel = el('div', 'bf-panel', this.root);
    const r = this.result;

    const title = el('h1', `bf-title ${r.won ? 'bf-title-win' : 'bf-title-lose'}`, panel);
    title.textContent = r.won ? 'LEVEL CLEAR!' : 'DEFEATED…';

    const loot = el('div', 'bf-loot', panel);
    const goldRow = el('div', 'bf-loot-row', loot);
    el('span', 'bf-loot-icon', goldRow).textContent = '💰';
    el('span', 'bf-loot-label', goldRow).textContent = 'Gold';
    el('span', 'bf-loot-value', goldRow).textContent = `+${r.goldEarned}`;
    for (const [id, count] of Object.entries(r.materialsEarned) as [MaterialId, number][]) {
      if (!count) continue;
      const row = el('div', 'bf-loot-row', loot);
      el('span', 'bf-loot-icon', row).textContent = MATERIAL_LABELS[id].icon;
      el('span', 'bf-loot-label', row).textContent = MATERIAL_LABELS[id].name;
      el('span', 'bf-loot-value', row).textContent = `+${count}`;
    }
    if (!r.won) {
      el('p', 'bf-hint', panel).textContent = 'You keep everything you earned. Try again!';
    }

    const col = el('div', 'bf-button-col', panel);
    if (r.won) {
      button('🛒 MARKET', () => this.callbacks.onMarket(), 'bf-button bf-button-yellow', col);
      button('NEXT ▶', () => this.callbacks.onContinue(), 'bf-button bf-button-green', col);
    } else {
      button('RETRY', () => this.callbacks.onRetry(), 'bf-button bf-button-green', col);
      button('LEVEL MAP', () => this.callbacks.onContinue(), 'bf-button', col);
    }
    events.emit('music', { mood: r.won ? 'victory' : 'defeat' });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
