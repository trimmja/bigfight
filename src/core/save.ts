import { SAVE_KEY } from '../config';
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
    return {
      ...base,
      ...parsed,
      version: 1,
      materials: { ...base.materials, ...(parsed.materials ?? {}) },
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return defaults();
  }
}

export function writeSave(data: SaveData): void {
  writeRaw(JSON.stringify(data));
}

export function resetSave(): SaveData {
  const fresh = defaults();
  writeSave(fresh);
  return fresh;
}
