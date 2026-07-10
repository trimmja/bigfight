import { pick, rand } from '../core/math';
import { CHARACTERS } from '../data/characters';
import type { SaveData } from '../data/types';
import { isCharacterUnlocked, unlockedCharacters } from '../progression';
import { el } from './dom';

/**
 * The character-select card grid (cards, locks, RANDOM), extracted verbatim
 * from CharacterSelectScreen so the online select can reuse it. Lock gating
 * is against the LOCAL save — remote players' picks render elsewhere.
 */

export interface CharacterGrid {
  readonly root: HTMLElement;
  setSelected(id: string): void;
  /** Online READY lock: freeze/unfreeze picking (locked cards stay locked). */
  setEnabled(enabled: boolean): void;
}

/**
 * Build the grid under `parent`. `onSelect` fires with a concrete character
 * id for card taps AND for the RANDOM card (which rolls an unlocked fighter).
 */
export function buildCharacterGrid(
  parent: HTMLElement,
  save: SaveData,
  onSelect: (characterId: string) => void,
): CharacterGrid {
  const root = el('div', 'bf-select-grid', parent);
  const cards = new Map<string, HTMLButtonElement>();
  const unlockedIds = new Set<string>();

  for (const def of CHARACTERS) {
    const unlocked = isCharacterUnlocked(def, save);
    if (unlocked) unlockedIds.add(def.id);
    const card = el('button', 'bf-card' + (unlocked ? '' : ' bf-card-locked'), root);
    card.type = 'button';
    const dot = el('span', 'bf-card-dot', card);
    dot.style.background = `#${def.palette.core.toString(16).padStart(6, '0')}`;
    el('span', 'bf-card-name', card).textContent = unlocked ? def.name : '???';
    if (!unlocked) {
      el('span', 'bf-card-lock', card).textContent =
        def.unlock.type === 'level' ? `Beat level ${def.unlock.level}` : `💰 in Market`;
    }
    card.disabled = !unlocked;
    card.addEventListener('click', () => onSelect(def.id));
    cards.set(def.id, card);
  }
  // Random card.
  const randomCard = el('button', 'bf-card bf-card-random', root);
  randomCard.type = 'button';
  el('span', 'bf-card-dot', randomCard).textContent = '🎲';
  el('span', 'bf-card-name', randomCard).textContent = 'RANDOM';
  randomCard.addEventListener('click', () => {
    const options = unlockedCharacters(save);
    onSelect(pick(rand, options).id);
  });

  return {
    root,
    setSelected(id: string): void {
      for (const [cardId, card] of cards) {
        card.classList.toggle('bf-card-selected', cardId === id);
      }
    },
    setEnabled(enabled: boolean): void {
      for (const [cardId, card] of cards) {
        card.disabled = !enabled || !unlockedIds.has(cardId);
      }
      randomCard.disabled = !enabled;
      root.classList.toggle('bf-grid-locked', !enabled);
    },
  };
}
