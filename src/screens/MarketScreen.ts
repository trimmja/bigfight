import { events } from '../core/events';
import type { Game } from '../Game';
import { CHARACTERS } from '../data/characters';
import { SIDEKICKS } from '../data/sidekicks';
import type { MaterialId } from '../data/types';
import { WEAPONS } from '../data/weapons';
import { canAfford, spendMaterials } from '../progression';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

const MATERIAL_ICONS: Record<MaterialId, string> = {
  boneShard: '🦴',
  slimeGoo: '🟢',
  ghostEssence: '👻',
  feather: '🪶',
  energyCore: '⚡',
};

/**
 * The Market (Ryder's design): three tabs — WEAPONS crafted with materials,
 * CHARACTERS and SIDEKICKS bought with gold. Shown after each level win, or
 * skipped.
 */
export class MarketScreen implements Screen {
  private root: HTMLElement | null = null;
  private goldEl: HTMLElement | null = null;
  private matsEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private tab: 'weapons' | 'characters' | 'sidekicks' = 'weapons';
  private tabButtons = new Map<string, HTMLButtonElement>();

  constructor(private readonly onDone: () => void) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-market-screen');

    const header = el('div', 'bf-select-header', this.root);
    el('h1', 'bf-select-title', header).textContent = '🛒 MARKET';
    this.goldEl = el('div', 'bf-gold-chip', header);

    this.matsEl = el('div', 'bf-mats-row', this.root);

    const tabs = el('div', 'bf-tabs', this.root);
    for (const tab of ['weapons', 'characters', 'sidekicks'] as const) {
      const tabBtn = button(
        tab.toUpperCase(),
        () => {
          this.tab = tab;
          events.emit('ui', { kind: 'move' });
          this.refresh(game);
        },
        'bf-tab',
        tabs,
      );
      this.tabButtons.set(tab, tabBtn);
    }

    this.listEl = el('div', 'bf-market-list', this.root);
    button('DONE ▶', () => this.onDone(), 'bf-button bf-button-green bf-market-done', this.root);

    this.refresh(game);
    events.emit('music', { mood: 'menu' });
  }

  private refresh(game: Game): void {
    const save = game.save;
    if (this.goldEl) this.goldEl.textContent = `🪙 ${save.gold}`;
    if (this.matsEl) {
      this.matsEl.replaceChildren();
      for (const [id, icon] of Object.entries(MATERIAL_ICONS) as [MaterialId, string][]) {
        const chip = el('span', 'bf-mat-chip', this.matsEl);
        chip.textContent = `${icon} ${save.materials[id]}`;
      }
    }
    for (const [tabId, tabBtn] of this.tabButtons) {
      tabBtn.classList.toggle('bf-tab-active', tabId === this.tab);
    }
    const list = this.listEl;
    if (!list) return;
    list.replaceChildren();

    if (this.tab === 'weapons') {
      for (const weapon of WEAPONS) {
        if (weapon.starter) continue;
        const owned = save.craftedWeapons.includes(weapon.id);
        const affordable = canAfford(save, weapon.recipe);
        const row = el('div', 'bf-market-row', list);
        el('div', 'bf-market-name', row).textContent = weapon.name;
        el('div', 'bf-market-sub', row).textContent = weapon.tagline;
        const cost = el('div', 'bf-market-cost', row);
        cost.textContent = Object.entries(weapon.recipe)
          .map(([id, n]) => `${MATERIAL_ICONS[id as MaterialId]}${n}`)
          .join(' ');
        const buyBtn = button(
          owned ? 'CRAFTED ✓' : 'CRAFT',
          () => {
            if (owned || !canAfford(save, weapon.recipe)) return;
            spendMaterials(save, weapon.recipe);
            save.craftedWeapons.push(weapon.id);
            game.persist();
            events.emit('ui', { kind: 'buy' });
            this.refresh(game);
          },
          'bf-button bf-button-yellow bf-market-buy',
          row,
        );
        buyBtn.disabled = owned || !affordable;
      }
    } else if (this.tab === 'characters') {
      for (const def of CHARACTERS) {
        if (def.unlock.type !== 'gold') continue;
        const owned = save.purchasedCharacters.includes(def.id);
        const cost = def.unlock.cost;
        const row = el('div', 'bf-market-row', list);
        el('div', 'bf-market-name', row).textContent = def.name;
        el('div', 'bf-market-sub', row).textContent = def.tagline;
        el('div', 'bf-market-cost', row).textContent = `🪙 ${cost}`;
        const buyBtn = button(
          owned ? 'OWNED ✓' : 'BUY',
          () => {
            if (owned || save.gold < cost) return;
            save.gold -= cost;
            save.purchasedCharacters.push(def.id);
            game.persist();
            events.emit('ui', { kind: 'buy' });
            this.refresh(game);
          },
          'bf-button bf-button-yellow bf-market-buy',
          row,
        );
        buyBtn.disabled = owned || save.gold < cost;
      }
    } else {
      for (const sidekick of SIDEKICKS) {
        const owned = save.ownedSidekicks.includes(sidekick.id);
        const equipped = save.equippedSidekick === sidekick.id;
        const row = el('div', 'bf-market-row', list);
        el('div', 'bf-market-name', row).textContent = sidekick.name;
        el('div', 'bf-market-sub', row).textContent = sidekick.tagline;
        el('div', 'bf-market-cost', row).textContent = owned ? '' : `🪙 ${sidekick.goldCost}`;
        const label = equipped ? 'EQUIPPED ✓' : owned ? 'EQUIP' : 'BUY';
        const buyBtn = button(
          label,
          () => {
            if (!owned) {
              if (save.gold < sidekick.goldCost) return;
              save.gold -= sidekick.goldCost;
              save.ownedSidekicks.push(sidekick.id);
              save.equippedSidekick = sidekick.id;
            } else {
              save.equippedSidekick = equipped ? null : sidekick.id;
            }
            game.persist();
            events.emit('ui', { kind: 'buy' });
            this.refresh(game);
          },
          'bf-button bf-button-yellow bf-market-buy',
          row,
        );
        buyBtn.disabled = !owned && save.gold < sidekick.goldCost;
      }
    }
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
