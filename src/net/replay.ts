import type { IIntentSource, InputState } from '../contracts';
import { TIMESTEP } from '../config';
import { events } from '../core/events';
import { SimRng } from '../core/rng';
import type { Game } from '../Game';
import { GameplayScreen } from '../screens/GameplayScreen';
import { simPhase } from './simPhase';

/**
 * Replay determinism harness (M0 exit gate for rollback netcode).
 *
 * A fixture is a fully-scripted match: level + sim seed + an input-bot seed.
 * Running it twice must produce IDENTICAL per-frame state digests — that
 * proves the sim is deterministic given inputs (the property rollback needs)
 * AND that gated view work doesn't leak into sim state (runs execute with
 * `simPhase.resimulating` on, exactly like a rollback resim).
 *
 * Cross-engine check: run the same fixtures on desktop V8 and iPhone JSC via
 * the LAN dev server — matching digests = cross-device lockstep viability.
 */

export interface ReplayFixture {
  name: string;
  levelId: number;
  characterId: string;
  weaponId: string;
  seed: number;
  inputSeed: number;
  frames: number;
}

/** Standard fixtures: RNG-heavy slime level + boss level with minions. */
export const FIXTURES: readonly ReplayFixture[] = [
  {
    name: 'slimes-l3',
    levelId: 3,
    characterId: 'volt',
    weaponId: 'rustyPistol',
    seed: 0xbf01,
    inputSeed: 0x1234,
    frames: 2400, // 40s: several waves, splits, loot variance
  },
  {
    name: 'boss-l4-skeletonKing',
    levelId: 4,
    characterId: 'kaze',
    weaponId: 'practiceSword',
    seed: 0xbf02,
    inputSeed: 0x5678,
    frames: 4200, // 70s: reaches + fights the boss, minion summons
  },
];

/**
 * Seeded input bot: kid-plausible chaos — runs, jump bursts, attack mashes,
 * weapon pokes. Deterministic per inputSeed; edge flags derived from held
 * transitions exactly like InputManager does.
 */
export class ScriptedIntentSource implements IIntentSource {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    attackHeld: false,
    weaponPressed: false,
    weaponHeld: false,
    pausePressed: false,
    anyPressed: false,
  };

  private readonly rng: SimRng;
  private planFrames = 0;
  private planMoveX = 0;
  private planMoveY = 0;
  private planJumpEvery = 0;
  private planAttackEvery = 0;
  private planWeaponEvery = 0;
  private frame = 0;
  private prevJumpHeld = false;
  private prevAttackHeld = false;
  private prevWeaponHeld = false;

  constructor(inputSeed: number) {
    const mix = (n: number) => (inputSeed ^ Math.imul(n, 0x9e3779b9)) | 0;
    this.rng = new SimRng(mix(1), mix(2), mix(3), mix(4));
  }

  /** Advance one sim frame — call exactly once before each screen.update. */
  step(): void {
    if (this.planFrames <= 0) this.newPlan();
    this.planFrames -= 1;
    this.frame += 1;

    const jumpHeld = this.planJumpEvery > 0 && this.frame % this.planJumpEvery < 3;
    const attackHeld = this.planAttackEvery > 0 && this.frame % this.planAttackEvery < 2;
    const weaponHeld = this.planWeaponEvery > 0 && this.frame % this.planWeaponEvery < 2;

    const s = this.state;
    s.moveX = this.planMoveX;
    s.moveY = this.planMoveY;
    s.jumpPressed = jumpHeld && !this.prevJumpHeld;
    s.jumpHeld = jumpHeld;
    s.attackPressed = attackHeld && !this.prevAttackHeld;
    s.attackHeld = attackHeld;
    s.weaponPressed = weaponHeld && !this.prevWeaponHeld;
    s.weaponHeld = weaponHeld;
    s.pausePressed = false;
    s.anyPressed = s.jumpPressed || s.attackPressed || s.weaponPressed;
    this.prevJumpHeld = jumpHeld;
    this.prevAttackHeld = attackHeld;
    this.prevWeaponHeld = weaponHeld;
  }

  private newPlan(): void {
    const rng = this.rng;
    this.planFrames = 12 + rng.nextInt(36);
    const moveRoll = rng.next();
    this.planMoveX = moveRoll < 0.42 ? 1 : moveRoll < 0.84 ? -1 : 0;
    const vertRoll = rng.next();
    this.planMoveY = vertRoll < 0.12 ? -1 : vertRoll < 0.2 ? 1 : 0;
    this.planJumpEvery = rng.next() < 0.55 ? 14 + rng.nextInt(30) : 0;
    this.planAttackEvery = rng.next() < 0.75 ? 8 + rng.nextInt(18) : 0;
    this.planWeaponEvery = rng.next() < 0.3 ? 40 + rng.nextInt(50) : 0;
  }
}

export interface ReplayRun {
  digests: Uint32Array;
  stepMsAvg: number;
  stepMsMax: number;
  dump: { label: string; values: number[] }[] | null;
}

/**
 * Run one fixture headlessly-ish: a detached GameplayScreen stepped frame-by-
 * frame with the input bot, view work + events suppressed (the rollback-resim
 * code path). Returns per-frame digests + sim-step timing.
 */
export function runReplay(game: Game, fixture: ReplayFixture, dumpAtFrame = -1): ReplayRun {
  const source = new ScriptedIntentSource(fixture.inputSeed);
  const screen = new GameplayScreen({
    levelId: fixture.levelId,
    characterId: fixture.characterId,
    weaponId: fixture.weaponId,
    seed: fixture.seed,
    intentSource: source,
    onLevelEnd: () => undefined, // stay put — the lab owns navigation
  });

  const digests = new Uint32Array(fixture.frames);
  let dump: ReplayRun['dump'] = null;
  let totalMs = 0;
  let maxMs = 0;

  events.setSuppressed(true);
  simPhase.resimulating = true;
  try {
    screen.enter(game);
    for (let frame = 0; frame < fixture.frames; frame += 1) {
      source.step();
      const t0 = performance.now();
      screen.update(game, TIMESTEP);
      const ms = performance.now() - t0;
      totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      digests[frame] = screen.stateDigest();
      if (frame === dumpAtFrame) dump = screen.stateDump();
    }
  } finally {
    try {
      screen.exit(game);
    } finally {
      simPhase.resimulating = false;
      events.setSuppressed(false);
    }
  }

  return { digests, stepMsAvg: totalMs / fixture.frames, stepMsMax: maxMs, dump };
}

export interface FixtureReport {
  name: string;
  pass: boolean;
  frames: number;
  firstDivergence: number;
  finalDigest: string;
  stepMsAvg: number;
  stepMsMax: number;
  divergenceDetail: string;
}

/** Run every fixture twice; compare digest streams; bisect any divergence. */
export function runReplayCheck(game: Game): FixtureReport[] {
  const reports: FixtureReport[] = [];
  for (const fixture of FIXTURES) {
    const a = runReplay(game, fixture);
    const b = runReplay(game, fixture);
    let firstDivergence = -1;
    for (let i = 0; i < fixture.frames; i += 1) {
      if (a.digests[i] !== b.digests[i]) {
        firstDivergence = i;
        break;
      }
    }

    let divergenceDetail = '';
    if (firstDivergence >= 0) {
      const dumpA = runReplay(game, fixture, firstDivergence).dump;
      const dumpB = runReplay(game, fixture, firstDivergence).dump;
      divergenceDetail = diffDumps(dumpA, dumpB);
    }

    reports.push({
      name: fixture.name,
      pass: firstDivergence === -1,
      frames: fixture.frames,
      firstDivergence,
      finalDigest: (a.digests[fixture.frames - 1] ?? 0).toString(16).padStart(8, '0'),
      stepMsAvg: (a.stepMsAvg + b.stepMsAvg) / 2,
      stepMsMax: Math.max(a.stepMsMax, b.stepMsMax),
      divergenceDetail,
    });
  }
  return reports;
}

/** Field-level diff between two labeled dumps — names the diverging entity. */
function diffDumps(a: ReplayRun['dump'], b: ReplayRun['dump']): string {
  if (!a || !b) return 'dump unavailable';
  const lines: string[] = [];
  const count = Math.max(a.length, b.length);
  for (let i = 0; i < count; i += 1) {
    const segA = a[i];
    const segB = b[i];
    if (!segA || !segB) {
      lines.push(`segment ${i}: present in one run only (${segA?.label ?? segB?.label})`);
      continue;
    }
    if (segA.label !== segB.label) {
      lines.push(`segment ${i}: label mismatch ${segA.label} vs ${segB.label}`);
      continue;
    }
    const len = Math.max(segA.values.length, segB.values.length);
    for (let v = 0; v < len; v += 1) {
      if (segA.values[v] !== segB.values[v]) {
        lines.push(`${segA.label}[${v}]: ${segA.values[v]} vs ${segB.values[v]}`);
      }
    }
  }
  return lines.slice(0, 24).join('\n') || 'digests differ but dumps match (hash-order bug?)';
}
