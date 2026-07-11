import { events } from '../core/events';
import type { Game } from '../Game';
import { pick, rand } from '../core/math';
import { ownedWeapons } from '../progression';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

const CATEGORY_ICONS: Record<string, string> = {
  gun: 'G',
  melee: 'M',
  bomb: 'B',
  magic: 'A',
};

/**
 * Weapon select: pick one crafted weapon (or RANDOM) before the fight.
 * The weapon powers the second attack button.
 */
export class WeaponSelectScreen implements Screen {
  private root: HTMLElement | null = null;

  constructor(
    private readonly callbacks: {
      onPick: (weaponId: string) => void;
      onBack: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-select-screen');

    const header = el('div', 'bf-select-header', this.root);
    button('◀', () => this.callbacks.onBack(), 'bf-button bf-button-round', header);
    el('h1', 'bf-select-title', header).textContent = 'PICK YOUR WEAPON';

    const owned = ownedWeapons(game.save);
    const grid = el('div', 'bf-select-grid bf-weapon-grid', this.root);
    for (const weapon of owned) {
      const card = el('button', 'bf-card', grid);
      card.type = 'button';
      const icon = el('span', 'bf-card-dot', card);
      icon.textContent = CATEGORY_ICONS[weapon.category] ?? 'W';
      el('span', 'bf-card-name', card).textContent = weapon.name;
      el('span', 'bf-card-sub', card).textContent = weapon.tagline;
      card.addEventListener('click', () => {
        events.emit('ui', { kind: 'confirm' });
        this.callbacks.onPick(weapon.id);
      });
    }
    const randomCard = el('button', 'bf-card bf-card-random', grid);
    randomCard.type = 'button';
    el('span', 'bf-card-dot', randomCard).textContent = '?';
    el('span', 'bf-card-name', randomCard).textContent = 'RANDOM';
    randomCard.addEventListener('click', () => {
      events.emit('ui', { kind: 'confirm' });
      this.callbacks.onPick(pick(rand, owned).id);
    });

    el('p', 'bf-hint bf-select-hint', this.root).textContent =
      'Craft new weapons in the Market with materials from beaten enemies!';
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
