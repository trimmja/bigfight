import { SAVE_KEY } from '../config';
import { LEVELS } from '../data/levels';
import { SIDEKICKS } from '../data/sidekicks';
import type { SaveData } from '../data/types';

function defaults(): SaveData {
  return {
    version: 1,
    gold: 0,
    materials: { boneShard: 0, slimeGoo: 0, ghostEssence: 0, feather: 0, energyCore: 0 },
    purchasedCharacters: [],
    craftedWeapons: ['rustyPistol', 'practiceSword'],
    ownedSidekicks: [],
    equippedSidekick: null,
    levelsBeaten: 0,
    settings: { muted: false, quality: 'auto', shake: true },
  };
}

let storageOk = true;
let memoryFallback: string | null = null;

function readRaw(): string | null {
  if (!storageOk) return memoryFallback;
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    storageOk = false;
    return memoryFallback;
  }
}

function writeRaw(json: string): void {
  memoryFallback = json;
  if (!storageOk) return;
  try {
    localStorage.setItem(SAVE_KEY, json);
  } catch {
    storageOk = false; // Safari private mode etc. — keep playing in memory
  }
}

/** True when progress can't persist (show a one-time toast). */
export function saveIsMemoryOnly(): boolean {
  // Probe once on first ask.
  if (storageOk) {
    try {
      localStorage.setItem(SAVE_KEY + '_probe', '1');
      localStorage.removeItem(SAVE_KEY + '_probe');
    } catch {
      storageOk = false;
    }
  }
  return !storageOk;
}

export function loadSave(): SaveData {
  const raw = readRaw();
  if (!raw) return defaults();
  try {
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    // Merge over defaults so new fields added later never come back undefined.
    const base = defaults();
    return sanitize({
      ...base,
      ...parsed,
      version: 1,
      materials: { ...base.materials, ...(parsed.materials ?? {}) },
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
    });
  } catch {
    return defaults();
  }
}

/**
 * A stale save (renamed content ids, wrong shapes) must never crash the game —
 * filter every id against current data and clamp every number.
 */
function sanitize(save: SaveData): SaveData {
  const stringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

  save.gold = num(save.gold, 0, 0, 9_999_999);
  save.levelsBeaten = Math.floor(num(save.levelsBeaten, 0, 0, LEVELS.length));
  for (const key of Object.keys(save.materials) as (keyof SaveData['materials'])[]) {
    save.materials[key] = Math.floor(num(save.materials[key], 0, 0, 9999));
  }
  save.purchasedCharacters = stringArray(save.purchasedCharacters);
  save.ownedSidekicks = stringArray(save.ownedSidekicks);
  save.craftedWeapons = stringArray(save.craftedWeapons);
  // Guarantee the two starter weapons are always present.
  for (const starter of ['rustyPistol', 'practiceSword']) {
    if (!save.craftedWeapons.includes(starter)) save.craftedWeapons.push(starter);
  }
  if (
    save.equippedSidekick !== null &&
    (typeof save.equippedSidekick !== 'string' ||
      !save.ownedSidekicks.includes(save.equippedSidekick) ||
      !SIDEKICKS.some((sk) => sk.id === save.equippedSidekick))
  ) {
    save.equippedSidekick = null;
  }
  return save;
}

export function writeSave(data: SaveData): void {
  writeRaw(JSON.stringify(data));
}

export function resetSave(): SaveData {
  const fresh = defaults();
  writeSave(fresh);
  return fresh;
}
