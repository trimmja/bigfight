import { el } from './dom';

/**
 * Full-screen Smash-style roster board, shared by the campaign select screens
 * and the online lobby loadout. Three kinds of tile:
 *  - unlocked: portrait + name, tappable
 *  - locked (built but not earned): dark silhouette with a ? over it, "???"
 *  - future (empty roster slot): plain ? tile, waiting for fighters to come
 */

export interface RosterSlot {
  id: string;
  name: string;
  portrait: string;
  color: string;
  locked: boolean;
  /** Tooltip shown on locked tiles (how to earn it). */
  lockHint?: string;
  /** Other players hovering/holding this tile right now (online lobby). */
  claims?: { label: string; color: string; locked: boolean }[];
  /** Claimed by another locked-in player — visible but not selectable. */
  taken?: boolean;
}

export interface RosterGrid {
  root: HTMLElement;
  setSelected(id: string | null): void;
}

export function buildRosterGrid(
  parent: HTMLElement,
  opts: {
    slots: RosterSlot[];
    /** Total tiles shown — the rest are ? placeholders for future content. */
    capacity: number;
    selectedId: string | null;
    onSelect: (id: string) => void;
  },
): RosterGrid {
  const root = el('div', 'bf-roster-grid', parent);
  const tiles = new Map<string, HTMLElement>();

  for (const slot of opts.slots) {
    const taken = Boolean(slot.taken) && !slot.locked;
    const tile = el(
      'button',
      'bf-tile' + (slot.locked ? ' bf-tile-locked' : '') + (taken ? ' bf-tile-taken' : ''),
      root,
    );
    tile.type = 'button';
    if (!slot.locked) tile.style.setProperty('--card', slot.color);
    if (slot.locked && slot.lockHint) tile.title = slot.lockHint;
    tile.disabled = slot.locked || taken;
    const portrait = el('span', 'bf-tile-portrait', tile);
    const face = el('img', 'bf-tile-face', portrait);
    face.src = slot.portrait;
    face.alt = '';
    face.draggable = false;
    if (slot.locked) el('span', 'bf-tile-glyph', portrait).textContent = '?';
    if (!slot.locked) {
      for (const [index, claim] of (slot.claims ?? []).entries()) {
        const chip = el('span', 'bf-tile-claim' + (claim.locked ? ' bf-tile-claim-locked' : ''), portrait);
        chip.style.setProperty('--claim-i', `${index}`);
        chip.style.background = claim.color;
        chip.textContent = claim.locked ? `${claim.label} ✓` : claim.label;
      }
      if (taken) tile.title = 'Locked in by another player — pick a different fighter!';
    }
    el('span', 'bf-tile-name', tile).textContent = slot.locked ? '???' : slot.name.toUpperCase();
    if (!slot.locked && !taken) tile.addEventListener('click', () => opts.onSelect(slot.id));
    tiles.set(slot.id, tile);
  }

  // Future roster slots — the board is built for a bigger game than today's.
  for (let index = opts.slots.length; index < opts.capacity; index += 1) {
    const tile = el('div', 'bf-tile bf-tile-future', root);
    const portrait = el('span', 'bf-tile-portrait', tile);
    el('span', 'bf-tile-glyph', portrait).textContent = '?';
    el('span', 'bf-tile-name', tile).textContent = '';
  }

  const grid: RosterGrid = {
    root,
    setSelected(id: string | null): void {
      for (const [tileId, tile] of tiles) {
        tile.classList.toggle('bf-tile-selected', tileId === id);
      }
    },
  };
  grid.setSelected(opts.selectedId);
  return grid;
}
