import type { GameMode } from '../../../shared/protocol';

/** One source of truth for how each mode presents (hub cards + lobby banner). */
export interface ModeInfo {
  id: GameMode;
  icon: string;
  name: string;
  /** Compact label for tight controls (lobby pills). */
  short: string;
  tag: string;
  sub: string;
  /** Identity color (matches the FFA/pink/green palette). */
  color: string;
}

export const MODES: readonly ModeInfo[] = [
  { id: 'ffa', icon: '🥊', name: 'FREE-FOR-ALL', short: 'FREE FOR ALL', tag: 'Last fighter standing wins!', sub: '2–4 players', color: '#1a9fe8' },
  { id: 'teams', icon: '🤝', name: 'TEAM BATTLE', short: 'TEAM 2v2', tag: 'Squad up — 2 vs 2!', sub: '4 players', color: '#ff5a8a' },
  { id: 'coop', icon: '🗺️', name: 'CO-OP QUEST', short: 'CO-OP', tag: 'Beat the waves together!', sub: '2–4 players', color: '#4ec95c' },
];

export function modeInfo(id: GameMode): ModeInfo {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}
