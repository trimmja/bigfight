import type { CharacterDef } from '../data/types';

/** Card glyph per weapon family (letters, not emoji — game-wide rule). */
export const WEAPON_CATEGORY_ICONS: Record<string, string> = {
  gun: 'G',
  melee: 'M',
  bomb: 'B',
  magic: 'A',
};

/** Card color per weapon family, from the candy accent set. */
export const WEAPON_CATEGORY_COLORS: Record<string, string> = {
  gun: 'var(--neon-cyan)',
  melee: 'var(--neon-pink)',
  bomb: 'var(--neon-yellow)',
  magic: 'var(--neon-violet)',
};

/** A character's signature color as a CSS color string. */
export function characterCssColor(def: CharacterDef): string {
  return `#${def.palette.core.toString(16).padStart(6, '0')}`;
}
