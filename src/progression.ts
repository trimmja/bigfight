import { CHARACTERS } from './data/characters';
import { POWERUPS } from './data/powerups';
import { WEAPONS } from './data/weapons';
import type { CharacterDef, PowerupId, SaveData, WeaponDef } from './data/types';

/**
 * Progression rules in one place: what's unlocked is DERIVED from the save's
 * facts (levelsBeaten + purchases + crafts), never duplicated into flags.
 */

export function isCharacterUnlocked(def: CharacterDef, save: SaveData): boolean {
  switch (def.unlock.type) {
    case 'starter':
      return true;
    case 'level':
      return save.levelsBeaten >= def.unlock.level;
    case 'gold':
      return save.purchasedCharacters.includes(def.id);
  }
}

export function unlockedCharacters(save: SaveData): CharacterDef[] {
  return CHARACTERS.filter((c) => isCharacterUnlocked(c, save));
}

export function ownedWeapons(save: SaveData): WeaponDef[] {
  return WEAPONS.filter((w) => save.craftedWeapons.includes(w.id));
}

export function craftableWeapons(save: SaveData): WeaponDef[] {
  return WEAPONS.filter((w) => !save.craftedWeapons.includes(w.id) && !w.starter);
}

export function unlockedPowerupIds(save: SaveData): PowerupId[] {
  return POWERUPS.filter((p) => save.levelsBeaten >= p.unlockAfterLevel).map((p) => p.id);
}

export function canAfford(save: SaveData, recipe: Partial<Record<string, number>>): boolean {
  for (const [id, count] of Object.entries(recipe)) {
    if ((save.materials[id as keyof SaveData['materials']] ?? 0) < (count ?? 0)) return false;
  }
  return true;
}

/** Spend a material recipe (call only after canAfford). */
export function spendMaterials(save: SaveData, recipe: Partial<Record<string, number>>): void {
  for (const [id, count] of Object.entries(recipe)) {
    save.materials[id as keyof SaveData['materials']] -= count ?? 0;
  }
}
