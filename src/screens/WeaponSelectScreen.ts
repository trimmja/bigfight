import { events } from '../core/events';
import type { Game } from '../Game';
import { pick, rand } from '../core/math';
import { WEAPONS, weaponById } from '../data/weapons';
import { ownedWeapons } from '../progression';
import { WEAPON_CATEGORY_COLORS } from '../ui/cardColors';
import { button, el, uiRoot } from '../ui/dom';
import { weaponPortrait } from '../ui/portraits';
import { buildRosterGrid, type RosterGrid } from '../ui/rosterGrid';
import { ROSTER_CAPACITY } from './CharacterSelectScreen';
import type { Screen } from './Screen';

/**
 * Weapon select: the same full-screen Smash-style board as character select.
 * Un-crafted weapons show as ?-silhouettes (craft them in the Market); empty
 * slots are ?-tiles for weapons yet to be invented.
 */
export class WeaponSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private grid: RosterGrid | null = null;
  private nameEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private selectedId: string | null = null;

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

    const owned = new Set(ownedWeapons(game.save).map((weapon) => weapon.id));
    if (!this.selectedId || !owned.has(this.selectedId)) {
      this.selectedId = ownedWeapons(game.save)[0]!.id;
    }

    this.grid = buildRosterGrid(this.root, {
      slots: WEAPONS.map((weapon) => ({
        id: weapon.id,
        name: weapon.name,
        portrait: weaponPortrait(weapon.id),
        color: WEAPON_CATEGORY_COLORS[weapon.category] ?? 'var(--neon-cyan)',
        locked: !owned.has(weapon.id),
        lockHint: 'Craft it in the Market',
      })),
      capacity: ROSTER_CAPACITY,
      selectedId: this.selectedId,
      onSelect: (id) => this.select(id, true),
    });

    const bar = el('div', 'bf-roster-bar', this.root);
    const who = el('div', 'bf-roster-who', bar);
    this.nameEl = el('h2', 'bf-roster-name', who);
    this.tagEl = el('p', 'bf-roster-tagline', who);
    button('RANDOM', () => {
      this.select(pick(rand, ownedWeapons(game.save)).id, true);
    }, 'bf-button bf-button-yellow', bar);
    button('FIGHT! ▶', () => {
      events.emit('ui', { kind: 'confirm' });
      if (this.selectedId) this.callbacks.onPick(this.selectedId);
    }, 'bf-button bf-button-green bf-button-big', bar);

    this.select(this.selectedId, false);
  }

  private select(id: string, sfx: boolean): void {
    this.selectedId = id;
    if (sfx) events.emit('ui', { kind: 'move' });
    this.grid?.setSelected(id);
    const weapon = weaponById(id);
    if (this.nameEl) this.nameEl.textContent = weapon.name.toUpperCase();
    if (this.tagEl) this.tagEl.textContent = weapon.tagline;
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.grid = null;
  }

  update(): void {}
}
