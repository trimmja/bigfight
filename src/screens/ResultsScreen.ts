import { events } from '../core/events';
import type { Game } from '../Game';
import { characterById } from '../data/characters';
import { powerupById } from '../data/powerups';
import { stageById } from '../data/stages';
import type { LevelUnlocks, MaterialId } from '../data/types';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

const MATERIAL_LABELS: Record<MaterialId, { name: string; icon: string }> = {
  boneShard: { name: 'Bone Shards', icon: 'B' },
  slimeGoo: { name: 'Slime Goo', icon: 'S' },
  ghostEssence: { name: 'Ghost Essence', icon: 'E' },
  feather: { name: 'Feathers', icon: 'F' },
  energyCore: { name: 'Energy Cores', icon: 'C' },
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
    private readonly unlocks: LevelUnlocks | undefined,
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
    el('span', 'bf-loot-icon', goldRow).textContent = 'G';
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

    if (this.unlocks) {
      const u = this.unlocks;
      const rows: string[] = [];
      if (u.characterId) rows.push(`NEW FIGHTER: ${characterById(u.characterId).name}!`);
      if (u.powerupId) rows.push(`⭐ NEW POWERUP: ${powerupById(u.powerupId).name}!`);
      if (u.stageId) rows.push(`NEW STAGE: ${stageById(u.stageId).name}!`);
      for (const text of rows) {
        el('div', 'bf-unlock-row', panel).textContent = text;
      }
      if (rows.length > 0) events.emit('ui', { kind: 'unlock' });
    }

    const col = el('div', 'bf-button-col', panel);
    if (r.won) {
      button('MARKET', () => this.callbacks.onMarket(), 'bf-button bf-button-yellow', col);
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
