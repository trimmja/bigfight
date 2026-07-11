# BIG FIGHT — Claude context

**Keep this file lean.** If it's discoverable in the code (structure, APIs, constants,
per-file behavior), it does NOT belong here — document it at the definition site instead.
This file is only for workflow, gotchas, and design intent the code can't express.

Smash-style platform fighter. **Ryder (age 9) is lead designer** — his playtest feedback is the
spec; when a "bug report" describes intended-but-confusing behavior, fix the *communication*
(banners, visuals) or redesign to his intent, don't just explain. Kid-friendly tone in all copy.

## Workflow
- `npm run dev` (LAN-exposed for phone testing) · `npm run check` · `npm run build` (tsc + vite).
- **Deploy = `git push`** (main → GitHub Actions → playbigfight.com on Fly). Verify with
  `gh run watch`. GitHub Pages only redirects to the canonical domain. Players get updates via
  the update pill on the title screen (commit-derived release-id check).
- `?debug` URL flag: hitboxes, state panel, FPS.

## Testing gotchas (hard-won)
- Occluded Chrome windows pause rAF — the game "freezes" but isn't broken. For scripted tests,
  drive the sim manually from the console: `window.bigfight` is the Game;
  `g.screens.update(1/60)` steps it; navigate via each screen's `callbacks`/`onPlay` handles.
- Dev-console module access: `await import('/bigfight/src/…​.ts')` (note the base path).
- Test runs pollute real state: the dev tab shares localStorage (`bigfight_save_v1`) and live
  waves/crates interfere with measurements (mobs wander, powerup crates refresh timers, players
  hammer themselves off cliffs). Park/freeze mobs for controlled tests; reset the save after.
  All-unlocked testing: back up `bigfight_save_v1` to another localStorage key, write a save
  with `levelsBeaten: 15` + all weapon ids in `craftedWeapons` + shade/titan in
  `purchasedCharacters`, then RELOAD (an open game tab overwrites edits from memory).
- Jacob often playtests the dev tab/phone while I work — don't fight him for the browser, and
  every file save hot-reloads his session.
- Pose/animation work: never guess rotation signs — measure world positions or render a
  contact-sheet of variants and look. Axis conventions are documented in `src/rigs/poses.ts`.

## Design-review workflow
Visual redesigns go mockup-first: build options in the Character Lab (`/mockup.html`,
`window.lab` = step/pick/attack), let Ryder & Jacob click through the animations, iterate on
their picks, THEN port to the game. Don't restyle live game code on taste-guesses.

## Design decisions that aren't obvious from code
- Menu design language (2026-07-10, Jacob-approved): logo-style outlined titles everywhere;
  selects are full-screen Smash-style 20-slot roster boards (`src/ui/rosterGrid.ts`); tile
  portraits are photographed from the live 3D models at runtime (`src/ui/portraits.ts`) so
  art can never drift. Locked = dark silhouette + "?", future slots = plain "?" tiles.
- Online loadout offers ONLY save-unlocked fighters/weapons (same progression fns as campaign).
- Toggle buttons describe YOUR STATE, never the opposite action ("[✓] READY!", not
  "NOT READY") — action-labeled toggles confused the kids (Jacob 2026-07-11).
- Responsive rule: on phones COMPACT information, never `display:none` it. Hiding "extras"
  bit us twice in one night (stat bars gone on mobile; private-room CODE invisible on small
  iPhones). Verify with a ≤700px-wide window before shipping media queries.
- History: main was force-replaced 2026-07-10 with the selective rebuild (brother's laggier
  online build had drifted from Ryder's design). His 21 commits live on
  `archive/online-v1-brother` — cherry-pick from there (dances, abilities, lobby ideas)
  instead of rebuilding.
- Losing keeps all loot (Ryder's rule) — never add loss penalties.
- Campaign bosses escalate: each NEW boss must be the hardest yet (Jacob 2026-07-10);
  Lava Golem (L16) is the current ceiling. Hard = pace/damage/variety, never unclear telegraphs.
- New fighters debut in the Character Lab dropdown flagged "★ NEW" for family sign-off,
  THEN port to `characterBuilders.ts` (comet/rex/frost precedent).
- Melee weapons: point-blank (blade) must out-damage the ranged effect (wave).
- Bosses can't be ring-out KO'd: knocking one off-stage = 8% health penalty + sky respawn.
- Walk-off stages (cavern, ghostship) are intentional — Smash walk-off style, side ring-outs.
