/**
 * Kid-safe fighter nicknames for online play.
 *
 * Generated names are ADJ+FighterName+2digits ('TurboKaze77'). Every name —
 * generated, typed, or arriving from a remote player — passes through
 * `sanitizeNickname` (charset + length clamp) and the profanity check before
 * it is shown to anyone. Pure module: no DOM, no game imports.
 */

export const NICKNAME_MAX_LENGTH = 12;

/** ~24 kid-safe adjectives, all ≤5 chars so ADJ+name+2digits fits 12. */
const ADJECTIVES = [
  'Turbo',
  'Mega',
  'Super',
  'Hyper',
  'Ultra',
  'Zippy',
  'Lucky',
  'Sunny',
  'Happy',
  'Brave',
  'Swift',
  'Wild',
  'Neon',
  'Star',
  'Moon',
  'Zoom',
  'Boom',
  'Jet',
  'Max',
  'Epic',
  'Fire',
  'Ice',
  'Sky',
  'Rad',
] as const;

/** The 8 roster fighter names (kept literal — no data/ import in net/). */
const FIGHTER_NAMES = ['Volt', 'Kaze', 'Grim', 'Ace', 'Blaze', 'Nova', 'Shade', 'Titan'] as const;

/**
 * Profanity roots (English). Checked against the leet-normalized, lowercased
 * name with substring matching, so 'xXb4dw0rdXx' still trips. Kept to clear
 * slurs/vulgarity — over-blocking kid words is worse than a rare miss.
 */
const DENYLIST = [
  'anal', 'anus', 'arse', 'ass', 'bastard', 'bitch', 'blowjob', 'boner',
  'boob', 'butthole', 'chink', 'clit', 'cock', 'coon', 'cum', 'cunt',
  'dick', 'dildo', 'douche', 'fag', 'felch', 'fuck', 'gook', 'handjob',
  'hitler', 'homo', 'hooker', 'jizz', 'kike', 'milf', 'nazi', 'negro',
  'nigg', 'penis', 'piss', 'porn', 'pube', 'pussy', 'queef', 'rape',
  'rectum', 'retard', 'semen', 'sex', 'shit', 'slut', 'spic', 'tits',
  'twat', 'vagina', 'wank', 'whore',
];

/** Leet-speak digits → letters, so 'sh1t'/'a55' normalize to their roots. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

function leetNormalize(s: string): string {
  return s.toLowerCase().replace(/[013457]/g, (d) => LEET[d] ?? d);
}

/** True when the (already sanitized) name contains a denylisted root. */
export function isProfane(name: string): boolean {
  const normalized = leetNormalize(name);
  return DENYLIST.some((root) => normalized.includes(root));
}

/** Trim, strip everything outside A-Za-z0-9, clamp to 12 chars. */
export function sanitizeNickname(raw: string): string {
  return raw.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, NICKNAME_MAX_LENGTH);
}

/** Random kid-safe nickname, e.g. 'TurboKaze77'. Always sanitize-stable. */
export function randomNickname(rng: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]!;
  const name = FIGHTER_NAMES[Math.floor(rng() * FIGHTER_NAMES.length)]!;
  const digits = 10 + Math.floor(rng() * 90); // 10–99
  return `${adj}${name}${digits}`;
}

/**
 * What we SHOW for a remote player's name: their sanitized nickname, or
 * 'Fighter N' when it's empty or fails the profanity check. Local input goes
 * through the same gate before being sent.
 */
export function displayNameFor(remoteName: string, slot: number): string {
  const clean = sanitizeNickname(remoteName);
  if (clean.length === 0 || isProfane(clean)) return `Fighter ${slot + 1}`;
  return clean;
}
