# 🔫 BIG FIGHT

A bright, chunky, Smash-Bros-style platform fighter that runs in your browser — designed by
**Ryder (age 9)** and built with his dad.

**▶️ Play it: [playbigfight.com](https://playbigfight.com/)**
(On iPhone: open in Safari, turn sideways, Share → *Add to Home Screen* for the full-screen app.)

## The game
- **12-level campaign** across 6 themed stages, with bosses at levels 4, 8, and 12 — the
  Skeleton King, the Giant Ghost (shoot down his lasers!), and the Giant Eagle
- **8 unlockable fighters** — robots, ninjas, monsters, and gun heroes, each with their own
  look, stats, and combo
- **Smash-style combat** — damage % builds up, knockback grows, launch enemies off the stage
- **Craft 12 weapons** from materials dropped by beaten enemies; every melee weapon has a
  signature effect (slash waves, lightning shockwaves, rolling flames, a black hole that
  traps enemies…)
- **Sidekicks** that fight beside you, **powerups** including a true Smash-style giant hammer
  rampage, and a **market** between levels

## Controls
| | Touch (phone) | Keyboard |
|---|---|---|
| Move | left-side floating stick | A/D or ←/→ |
| Jump / double-jump | JUMP | Space or W |
| Attack combo | ATK | J or Z |
| Weapon ability | PWR | K or X |
| Drop through platform | stick down + JUMP | S + Space |
| Pause | ⏸ | P or Esc |

## Tech
Three.js + TypeScript + Vite. **100% procedural** — every model, animation, stage, sound
effect, and music track is generated in code; the repo contains zero asset files.

`playbigfight.com` is the canonical browser game and online room server. Fly runs one Dallas
machine for room discovery, WebRTC signaling, and fallback relay traffic; live matches use
direct peer-to-peer data channels whenever the players' routers allow them. GitHub Pages only
redirects old links to the canonical domain. Pushing `main` deploys the combined client/server
release through GitHub Actions.

Built by a father-son team with help from Claude and Codex.
Lead designer & QA department: Ryder. 🥊
