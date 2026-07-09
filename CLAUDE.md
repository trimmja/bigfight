# BIG FIGHT — Claude context

**Keep this file lean.** If it's discoverable in the code (structure, APIs, constants,
per-file behavior), it does NOT belong here — document it at the definition site instead.
This file is only for workflow, gotchas, and design intent the code can't express.

Smash-style platform fighter. **Ryder (age 9) is lead designer** — his playtest feedback is the
spec; when a "bug report" describes intended-but-confusing behavior, fix the *communication*
(banners, visuals) or redesign to his intent, don't just explain. Kid-friendly tone in all copy.

## Workflow
- `npm run dev` (LAN-exposed for phone testing) · `npm run check` · `npm run build` (tsc + vite).
- **Deploy = `git push`** (main → GitHub Actions → trimmja.github.io/bigfight). Verify with
  `gh run watch`. Players get it via the 🔄 update pill on the title screen (build-id check).
- `?debug` URL flag: hitboxes, state panel, FPS.

## Testing gotchas (hard-won)
- Occluded Chrome windows pause rAF — the game "freezes" but isn't broken. For scripted tests,
  drive the sim manually from the console: `window.bigfight` is the Game;
  `g.screens.update(1/60)` steps it; navigate via each screen's `callbacks`/`onPlay` handles.
- Dev-console module access: `await import('/bigfight/src/…​.ts')` (note the base path).
- Test runs pollute real state: the dev tab shares localStorage (`bigfight_save_v1`) and live
  waves/crates interfere with measurements (mobs wander, powerup crates refresh timers, players
  hammer themselves off cliffs). Park/freeze mobs for controlled tests; reset the save after.
- Jacob often playtests the dev tab/phone while I work — don't fight him for the browser, and
  every file save hot-reloads his session.
- Pose/animation work: never guess rotation signs — measure world positions or render a
  contact-sheet of variants and look. Axis conventions are documented in `src/rigs/poses.ts`.

## Design-review workflow
Visual redesigns go mockup-first: build options in the Character Lab (`/mockup.html`,
`window.lab` = step/pick/attack), let Ryder & Jacob click through the animations, iterate on
their picks, THEN port to the game. Don't restyle live game code on taste-guesses.

## Design decisions that aren't obvious from code
- Losing keeps all loot (Ryder's rule) — never add loss penalties.
- Melee weapons: point-blank (blade) must out-damage the ranged effect (wave).
- Bosses can't be ring-out KO'd: knocking one off-stage = 8% health penalty + sky respawn.
- Walk-off stages (cavern, ghostship) are intentional — Smash walk-off style, side ring-outs.
