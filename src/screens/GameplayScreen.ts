import * as THREE from 'three';
import {
  COLOR_NEON_CYAN,
  COLOR_NEON_GREEN,
  COLOR_NEON_PINK,
  COLOR_NEON_YELLOW,
  DEBUG,
  MATCH_COUNTDOWN_FRAMES,
  PLAYER_STOCKS,
  RESPAWN_DELAY,
  TIMESTEP,
} from '../config';
import { getMobAttackTokens, resetMobAttackTokens, setMobAttackTokens } from '../ai/MobBrain';
import type { IIntentSource } from '../contracts';
import { createSimRngSet, type SimRng, type SimRngSet } from '../core/rng';
import { ALL_POWERUP_IDS, assertMatchConfig, isVersus, type MatchConfig } from '../match/MatchConfig';
import { createMatchState, digestMatchState, syncMatchState, type MatchState } from '../match/MatchState';
import { computePlacements, evaluateFfaEnd, evaluateTeamsEnd, versusGoldFor } from '../match/rules';
import { hashNumbers } from '../net/hash';
import { simPhase } from '../net/simPhase';
import { SimRegistry, type StateIO } from '../net/snapshots';
import { WaveSpawner } from '../ai/WaveSpawner';
import type { ActiveHitbox, FighterLike, Rect } from '../combat/types';
import { HitResolver } from '../combat/HitResolver';
import { characterById } from '../data/characters';
import { bossById } from '../data/enemies';
import { levelById } from '../data/levels';
import { sidekickById } from '../data/sidekicks';
import { stageById } from '../data/stages';
import type { BossDef, LevelDef, MaterialId, Vec2 } from '../data/types';
import { weaponById } from '../data/weapons';
import type { Game } from '../Game';
import { unlockedPowerupIds } from '../progression';
import { Hud } from '../ui/hud';
import { DamageNumbers } from '../combat/DamageNumbers';
import { Body } from '../physics/Body';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CameraRig } from '../render/CameraRig';
import { Particles } from '../render/Particles';
import { Trails } from '../render/Trails';
import { Boss } from '../entities/Boss';
import { GiantEagle } from '../entities/bosses/GiantEagle';
import { GiantGhost } from '../entities/bosses/GiantGhost';
import { LavaGolem } from '../entities/bosses/LavaGolem';
import { SkeletonKing } from '../entities/bosses/SkeletonKing';
import { resetEntityIds } from '../entities/Entity';
import { Fighter } from '../entities/Fighter';
import { Mob } from '../entities/Mob';
import { MobPool } from '../entities/MobPool';
import { PickupManager } from '../entities/Pickup';
import { Player } from '../entities/Player';
import { PowerupSpawner } from '../entities/PowerupCrate';
import { ProjectileManager } from '../entities/Projectile';
import { Sidekick } from '../entities/Sidekick';
import type { WorldCtx } from '../entities/Entity';
import { buildWeaponModel } from '../rigs/weaponBuilders';
import { buildStage, type BuiltStage } from '../stages/StageBuilder';
import type { Screen } from './Screen';

type ParticleInternals = { points: THREE.Points };
type TrailInternals = { pool: { mesh: THREE.Mesh; reset(): void }[] };
type BossDropSource = Pick<BossDef, 'gold' | 'drops'>;
type BossDropPickupManager = {
  spawnDrops(def: BossDropSource, x: number, y: number): void;
};

export type LevelEndResult = {
  won: boolean;
  goldEarned: number;
  materialsEarned: Partial<Record<MaterialId, number>>;
  levelId: number;
};

export type VersusEndResult = {
  /** Slot ids best-to-worst. */
  placements: number[];
  kosBySlot: number[];
  /** Payout per slot (participation + placement + KOs — Ryder's law). */
  goldBySlot: number[];
  winnerTeam?: number;
};

export type GameplayScreenOptions = {
  levelId?: number;
  characterId: string;
  stageId?: string;
  weaponId?: string;
  /** Sim RNG seed. Netplay/replays pass a shared seed; solo may omit. */
  seed?: number;
  /** Player intent source (default: live device input). Replays/net inject here. */
  intentSource?: IIntentSource;
  /**
   * Full multiplayer config. Absent → a solo-campaign config is synthesized
   * from the fields above (behavior byte-identical to the classic game).
   */
  match?: MatchConfig;
  /** Per-slot intent sources, parallel to match.players. */
  intentSources?: IIntentSource[];
  /** Which slot THIS device controls (camera/HUD/input focus). */
  localSlot?: number;
  onLevelEnd?: (result: LevelEndResult) => void;
  onMatchEnd?: (result: VersusEndResult) => void;
  onPause?: () => void;
};

const DEBUG_HITBOX_SLOTS = 8;
const DEBUG_BODY_SLOTS = 18;
const CLEAR_BEAT_SECONDS = 2.2;
const EMPTY_MOBS: readonly Mob[] = [];

export class GameplayScreen implements Screen {
  private readonly opts: GameplayScreenOptions;
  private readonly match: MatchConfig;
  private readonly matchState: MatchState;
  /** null for versus matches (no waves/boss/level bounty). */
  private readonly level: LevelDef | null;
  /** True when the config was synthesized from legacy solo options. */
  private readonly isSynthSolo: boolean;
  private readonly localSlot: number;
  private stage: BuiltStage | null = null;
  private players: Player[] = [];
  private sidekicks: (Sidekick | null)[] = [];
  private hud: Hud | null = null;
  private damageNumbers: DamageNumbers | null = null;
  private particles: Particles | null = null;
  private trails: Trails | null = null;
  private cameraRig: CameraRig | null = null;
  private hitResolver: HitResolver | null = null;
  private physics: PhysicsWorld | null = null;
  private ctx: WorldCtx | null = null;
  private waveSpawner: WaveSpawner | null = null;
  private pickupManager: PickupManager | null = null;
  private projectileManager: ProjectileManager | null = null;
  private powerupSpawner: PowerupSpawner | null = null;
  private boss: Boss | null = null;
  /** Sim-state existence flag; the object may remain allocated after rollback. */
  private bossSpawned = false;
  private mobPool: MobPool | null = null;
  private hitUnsub: (() => void) | null = null;

  private readonly physicsBodies: Body[] = [];
  private readonly liveFighters: Fighter[] = [];
  private readonly combatTargets: FighterLike[] = [];
  private readonly cameraPoints: Vec2[] = [];
  private readonly debugSubmittedHitboxes: ActiveHitbox[] = [];
  private readonly splitSpawnPos: Vec2 = { x: 0, y: 0 };
  private readonly materialsEarned: Partial<Record<MaterialId, number>> = {};

  private rng: SimRngSet | null = null;
  /** Net-id → object map for snapshot ref restore (rollback). */
  private readonly registry = new SimRegistry();
  /** Game handle for restore-time lazy construction (boss across rollback). */
  private enterGame: Game | null = null;
  private goldEarned = 0;
  private levelEnding = false;
  private levelWon = false;
  private levelEndTimer = 0;
  private levelEndSent = false;
  private bossSpawnQueued = false;
  private bossSpawnTimer = 0;
  /** View-only countdown cue index; the authoritative timer is matchState.frame. */
  private countStage = 0;
  private fps = 60;
  private lastRenderMs = performance.now(); // det-ok: render FPS display only

  private debugPanel: HTMLDivElement | null = null;
  private debugGroup: THREE.Group | null = null;
  private readonly debugBodyLines: THREE.LineSegments[] = [];
  private readonly debugHitboxLines: THREE.LineSegments[] = [];
  private readonly debugMaterials: THREE.Material[] = [];
  private readonly debugGeometries: THREE.BufferGeometry[] = [];

  constructor(opts: GameplayScreenOptions) {
    this.opts = opts;
    this.isSynthSolo = !opts.match;
    this.match = opts.match ?? {
      mode: 'campaign',
      players: [
        {
          slot: 0,
          characterId: opts.characterId,
          weaponId: opts.weaponId ?? 'rustyPistol',
          sidekickId: null, // synth-solo: resolved from the save in enter()
          teamId: 1,
          nickname: '',
        },
      ],
      stocks: PLAYER_STOCKS,
      crates: true,
      powerupIds: [...ALL_POWERUP_IDS], // synth-solo: replaced by save unlocks in enter()
      seed: opts.seed ?? -1,
      levelId: opts.levelId ?? 1,
      ...(opts.stageId !== undefined ? { stageId: opts.stageId } : {}),
    };
    assertMatchConfig(this.match);
    this.level = isVersus(this.match.mode) ? null : levelById(this.match.levelId ?? opts.levelId ?? 1);
    this.matchState = createMatchState(this.match.players.length, this.match.stocks);
    this.localSlot = opts.localSlot ?? 0;
    if (this.localSlot < 0 || this.localSlot >= this.match.players.length) {
      throw new Error(`localSlot ${this.localSlot} is outside this ${this.match.players.length}-player match`);
    }
    if (opts.match && this.match.players.length > 1 && opts.intentSources?.length !== this.match.players.length) {
      throw new Error('Multiplayer GameplayScreen requires exactly one intent source per player');
    }
  }

  /** All pooled mobs, stable order (dead ones are `!alive`) — sim iterates this. */
  private get mobs(): readonly Mob[] {
    return this.mobPool ? this.mobPool.all : EMPTY_MOBS;
  }

  private get localPlayer(): Player | null {
    return this.players[this.localSlot] ?? null;
  }

  enter(game: Game): void {
    this.enterGame = game;
    resetMobAttackTokens();
    resetEntityIds(); // deterministic entity ids: nothing constructs mid-match (MobPool)
    const match = this.match;
    const stageDef = stageById(match.stageId ?? this.level?.stageId ?? 'rooftop');

    const rng = createSimRngSet(
      match.seed >= 0 ? match.seed : ((Math.random() * 0xffffffff) >>> 0), // det-ok: seeds SOLO only; net passes a shared seed
    );
    this.rng = rng;

    this.stage = buildStage(stageDef, game.renderer.scene);
    this.particles = new Particles(game.renderer.scene);
    this.trails = new Trails(game.renderer.scene);
    this.cameraRig = new CameraRig(game.renderer.camera, () => game.save.settings.shake);
    this.hitResolver = new HitResolver();
    this.hitResolver.onPlayerHitPlayer = (victimSlot, attackerSlot) => {
      const slot = this.matchState.slots[victimSlot];
      if (!slot) return;
      slot.lastHitBySlot = attackerSlot;
      slot.lastHitTimer = 4;
    };
    this.physics = new PhysicsWorld();
    this.mobPool = new MobPool(game.renderer.scene);
    if (this.level) this.mobPool.prewarm(this.level);
    this.pickupManager = new PickupManager(game.renderer.scene, rng.drops, (gold, material) => {
      // Direct sim credit (rollback-safe) — the loot EVENT is audio/UI only.
      this.goldEarned += gold;
      if (material) this.materialsEarned[material] = (this.materialsEarned[material] ?? 0) + 1;
    });
    const projectileManager = new ProjectileManager(game.renderer.scene);
    this.projectileManager = projectileManager;
    // Crate table must be identical on every peer: synth-solo keeps the save-
    // derived unlocks (classic behavior); real configs carry it explicitly.
    const powerupIds = this.isSynthSolo ? unlockedPowerupIds(game.save) : match.powerupIds;
    this.powerupSpawner = match.crates
      ? new PowerupSpawner(game.renderer.scene, powerupIds, rng.drops)
      : new PowerupSpawner(game.renderer.scene, [], rng.drops);

    // --- players (slot order) ---
    const sources = this.opts.intentSources ?? [this.opts.intentSource ?? game.input];
    this.players = [];
    this.sidekicks = [];
    for (let i = 0; i < match.players.length; i += 1) {
      const setup = match.players[i]!;
      const def = characterById(setup.characterId);
      const source = sources[i] ?? game.input;
      const player = new Player(def, source);
      player.setTeam(setup.teamId);
      player.slotIndex = i;
      player.stocks = match.stocks;
      const spawn = this.spawnPointFor(stageDef, i);
      player.koReset(spawn);
      player.facing = spawn.x <= 0 ? 1 : -1; // face stage center
      const weapon = weaponById(setup.weaponId);
      player.equipWeapon(weapon, buildWeaponModel(weapon));
      game.renderer.scene.add(player.group);
      this.players.push(player);

      // Sidekicks: campaign/co-op only (synth-solo keeps the save's equipped one).
      const sidekickId = this.isSynthSolo ? game.save.equippedSidekick : setup.sidekickId;
      if (sidekickId && !isVersus(match.mode)) {
        const sidekick = new Sidekick(sidekickById(sidekickId), player, projectileManager, () => this.liveFighters);
        game.renderer.scene.add(sidekick.group);
        this.sidekicks.push(sidekick);
      } else {
        this.sidekicks.push(null);
      }
    }

    this.hud = new Hud();
    this.damageNumbers = new DamageNumbers(game.renderer.scene);

    const players = this.players;
    this.ctx = {
      particles: this.particles,
      trails: this.trails,
      rng,
      stage: {
        colliders: this.stage.colliders,
        blast: stageDef.blast,
        respawnPoint: stageDef.respawnPoint,
      },
      players,
      nearestAlivePlayer: (x, y) => {
        let best: Player | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < players.length; i += 1) {
          const player = players[i]!;
          if (!player.alive) continue;
          const dx = player.body.pos.x - x;
          const dy = player.body.pos.y - y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = player;
          }
        }
        return best;
      },
      requestHitbox: (h) => {
        this.hitResolver?.submit(h);
        if (DEBUG && this.debugSubmittedHitboxes.length < DEBUG_HITBOX_SLOTS) {
          this.debugSubmittedHitboxes.push(h);
        }
      },
      fireProjectile: (def, attackDef, x, y, facing, faction, teamId, power) => {
        this.projectileManager?.fire(def, x, y, facing, faction, teamId, power, attackDef);
      },
    };

    if (this.level) {
      this.waveSpawner = new WaveSpawner(
        this.level,
        stageDef.enemySpawns,
        (enemyId, pos) => {
          this.spawnMob(game, enemyId, pos);
        },
        (pos) => this.telegraphSpawn(game, pos),
      );
      this.waveSpawner.onAllWavesCleared = () => this.handleAllWavesCleared(game);
      // Direct sim callback (rollback-safe) — the waveCleared EVENT is audio/UI only.
      this.waveSpawner.onWaveCleared = () => this.pickupManager?.vacuumAll();
    }

    this.cameraRig.setBounds(stageDef.blast.left, stageDef.blast.right, stageDef.blast.bottom);
    this.hitUnsub = game.events.on('hit', ({ pos, damage, kb }) => {
      this.particles?.burst(pos.x, pos.y, COLOR_NEON_YELLOW, Math.min(28, 8 + damage * 3), 5 + kb * 0.22);
    });

    // Register every snapshot-referenceable object's net id (rollback).
    this.registry.clear();
    for (let i = 0; i < this.players.length; i += 1) {
      this.registry.register(this.players[i]!.id, this.players[i]!);
    }
    for (let i = 0; i < this.mobs.length; i += 1) {
      this.registry.register(this.mobs[i]!.id, this.mobs[i]!);
    }
    projectileManager.registerNetIds(this.registry);

    if (DEBUG) this.createDebug(game);
    game.input.setTouchControlsVisible(true);
    game.events.emit('music', { mood: 'battle' });
  }

  /** Versus: per-slot spawn table (mirrored defaults if a stage lacks one). */
  private spawnPointFor(stageDef: ReturnType<typeof stageById>, index: number): Vec2 {
    if (this.match.players.length === 1) return stageDef.playerSpawn;
    const table = stageDef.versusSpawns;
    if (table && table[index]) return table[index]!;
    const spread = 6 + index * 2;
    return { x: index % 2 === 0 ? -spread : spread, y: 0.5 };
  }

  exit(game: Game): void {
    this.hitUnsub?.();
    this.hitUnsub = null;
    this.hud?.dispose();
    this.hud = null;
    this.damageNumbers?.dispose();
    this.damageNumbers = null;
    for (let i = 0; i < this.sidekicks.length; i += 1) this.sidekicks[i]?.dispose();
    this.sidekicks = [];
    this.boss?.dispose();
    this.boss = null;
    this.bossSpawned = false;
    for (let i = 0; i < this.players.length; i += 1) this.players[i]!.dispose();
    this.players = [];
    this.mobPool?.dispose();
    this.mobPool = null;
    this.projectileManager?.dispose();
    this.projectileManager = null;
    this.powerupSpawner?.dispose();
    this.powerupSpawner = null;
    this.pickupManager?.dispose();
    this.stage?.dispose();
    if (this.particles) disposeParticles(this.particles, game.renderer.scene);
    if (this.trails) disposeTrails(this.trails, game.renderer.scene);
    this.cameraRig?.dispose();
    this.destroyDebug();
    game.input.setTouchControlsVisible(false);
    this.stage = null;
    this.enterGame = null;
    this.particles = null;
    this.trails = null;
    this.cameraRig = null;
    this.hitResolver = null;
    this.physics = null;
    this.ctx = null;
    this.waveSpawner = null;
    this.pickupManager = null;
    game.input.setWeaponCooldown(0);
  }

  update(game: Game, dt: number): void {
    const ctx = this.ctx;
    const stage = this.stage;
    const physics = this.physics;
    const hitResolver = this.hitResolver;
    const particles = this.particles;
    const trails = this.trails;
    const pickupManager = this.pickupManager;
    const projectileManager = this.projectileManager;
    const powerupSpawner = this.powerupSpawner;
    if (
      this.players.length === 0
      || !ctx
      || !stage
      || !physics
      || !hitResolver
      || !particles
      || !trails
      || !pickupManager
      || !projectileManager
      || !powerupSpawner
    ) {
      return;
    }

    if (!this.levelEnding && game.input.state.pausePressed && this.opts.onPause) {
      this.opts.onPause();
      return;
    }

    this.matchState.frame += 1;

    // Every mode starts on the same deterministic 3-2-1-GO freeze. In
    // netplay the frame gate is rollback-safe; campaign gets the same intro.
    if (this.matchState.frame <= MATCH_COUNTDOWN_FRAMES) {
      if (!simPhase.resimulating) this.updateViewTail(game, dt, stage);
      return;
    }

    hitResolver.beginStep();
    this.debugSubmittedHitboxes.length = 0;
    this.updateRespawns(ctx, dt);

    if (!this.levelEnding) {
      this.waveSpawner?.setLiveMobCount(this.countAliveMobs());
      this.waveSpawner?.update(dt);
      this.updateBossSpawn(game, dt);
    }

    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i]!;
      if (player.alive) player.update(ctx, dt);
      const slot = this.matchState.slots[i]!;
      if (slot.lastHitTimer > 0) {
        slot.lastHitTimer = Math.max(0, slot.lastHitTimer - dt);
        if (slot.lastHitTimer === 0) slot.lastHitBySlot = -1;
      }
    }
    for (let i = 0; i < this.mobs.length; i += 1) {
      const mob = this.mobs[i]!;
      if (mob.alive) mob.update(ctx, dt);
    }
    if (this.boss?.alive) this.boss.update(ctx, dt);

    this.physicsBodies.length = 0;
    this.liveFighters.length = 0;
    for (let i = 0; i < this.players.length; i += 1) this.collectLiveFighter(this.players[i]!);
    for (let i = 0; i < this.mobs.length; i += 1) this.collectLiveFighter(this.mobs[i]!);
    if (this.boss) this.collectLiveFighter(this.boss);
    if (!this.levelEnding) {
      for (let i = 0; i < this.sidekicks.length; i += 1) this.sidekicks[i]?.update(ctx, dt);
    }
    projectileManager.update(ctx, dt, this.liveFighters);
    pickupManager.collectBodies(this.physicsBodies);

    physics.step(this.physicsBodies, stage.colliders, dt);
    this.separateFighters(dt);
    for (let i = 0; i < this.liveFighters.length; i += 1) {
      this.liveFighters[i]!.afterPhysics(ctx);
    }

    projectileManager.submitHitboxes(ctx);
    this.combatTargets.length = 0;
    for (let i = 0; i < this.liveFighters.length; i += 1) this.combatTargets.push(this.liveFighters[i]!);
    projectileManager.collectDestructibleTargets(this.combatTargets);
    hitResolver.resolve(this.combatTargets);

    pickupManager.update(ctx, dt, this.players);
    if (!this.levelEnding) powerupSpawner.update(ctx, dt, this.players);
    game.input.setWeaponCooldown(this.localPlayer?.weaponCooldownFrac ?? 0);

    for (let i = 0; i < this.players.length; i += 1) this.checkPlayerBlast(game, i);
    this.evaluateVersusEnd(game);
    for (let i = 0; i < this.mobs.length; i += 1) this.checkMobBlast(game, this.mobs[i]!);
    // Boss ring-out: bosses can't be KO'd off-stage, but knocking one out
    // costs it 8% health and it respawns from the sky (Ryder's rule).
    if (this.boss?.alive && stage) {
      const b = this.boss.body;
      const bx = b.pos.x;
      const by = b.pos.y + b.height * 0.5;
      const blast = stage.def.blast;
      if (bx < blast.left || bx > blast.right || by < blast.bottom || by > blast.top) {
        game.events.emit('screenShake', { amount: 1.2 });
        particles.koExplosion(bx, Math.max(blast.bottom + 2, Math.min(blast.top - 2, by)), this.boss.def.palette.glow);
        this.boss.ringOutPenalty(0, blast.top - 3);
      }
    }

    // Sweep dead mobs (KO'd last frame — drops/splits already handled) back to
    // the pool. Slots stay in `mobs` (stable order — netplay determinism);
    // release is idempotent and hides the rig.
    for (let i = 0; i < this.mobs.length; i += 1) {
      const mob = this.mobs[i]!;
      if (!mob.alive && mob.hitstopTimer <= 0) this.mobPool?.release(mob);
    }

    if (!simPhase.resimulating) this.updateViewTail(game, dt, stage);
  }

  /** Everything after deterministic simulation: camera, HUD, audio cues, flow. */
  private updateViewTail(game: Game, dt: number, stage: BuiltStage): void {
    this.updateCamera(stage);
    this.particles?.update(dt);
    this.trails?.update(dt);
    this.damageNumbers?.update(dt);
    this.updateCountdownView(game);
    const local = this.localPlayer;
    if (local) this.hud?.set(local.damage, local.stocks);
    if (DEBUG) this.updateDebug(dt);
    // Navigation/persist callbacks never fire mid-resim; the 2.2s end beat
    // vastly exceeds the rollback window, so the deferral can't diverge.
    this.updateLevelEnd(game, dt);
  }

  private updateCountdownView(game: Game): void {
    if (this.countStage >= 4) return;
    const stages: { at: number; text: string; voice: 'ann_3' | 'ann_2' | 'ann_1' | 'ann_go' }[] = [
      { at: 6, text: '3', voice: 'ann_3' },
      { at: 60, text: '2', voice: 'ann_2' },
      { at: 114, text: '1', voice: 'ann_1' },
      { at: MATCH_COUNTDOWN_FRAMES, text: 'GO!', voice: 'ann_go' },
    ];
    const next = stages[this.countStage];
    if (!next || this.matchState.frame < next.at) return;
    this.countStage += 1;
    this.hud?.banner(next.text, this.countStage === 4 ? 700 : 850);
    game.events.emit('announce', { id: next.voice });
  }

  // --- rollback snapshot surface (driven by net/RollbackSession) ---

  writeSnapshot(io: StateIO): void {
    io.beginWrite();
    this.syncSnapshot(io);
  }

  readSnapshot(io: StateIO): void {
    io.beginRead();
    this.syncSnapshot(io);
  }

  private syncSnapshot(io: StateIO): void {
    const registry = this.registry;
    syncMatchState(this.matchState, io);
    this.goldEarned = io.f64(this.goldEarned);
    this.materialsEarned.boneShard = io.f64(this.materialsEarned.boneShard ?? 0);
    this.materialsEarned.slimeGoo = io.f64(this.materialsEarned.slimeGoo ?? 0);
    this.materialsEarned.ghostEssence = io.f64(this.materialsEarned.ghostEssence ?? 0);
    this.materialsEarned.feather = io.f64(this.materialsEarned.feather ?? 0);
    this.materialsEarned.energyCore = io.f64(this.materialsEarned.energyCore ?? 0);
    this.levelEnding = io.bool(this.levelEnding);
    this.levelWon = io.bool(this.levelWon);
    this.levelEndTimer = io.f64(this.levelEndTimer);
    this.levelEndSent = io.bool(this.levelEndSent);
    this.bossSpawnQueued = io.bool(this.bossSpawnQueued);
    this.bossSpawnTimer = io.f64(this.bossSpawnTimer);
    this.bossSpawned = io.bool(this.bossSpawned);
    const tokens = io.i32(getMobAttackTokens());
    if (io.reading) setMobAttackTokens(tokens);
    if (this.rng) {
      syncRng(this.rng.ai, io);
      syncRng(this.rng.drops, io);
      syncRng(this.rng.spawn, io);
      syncRng(this.rng.reserve, io);
    }
    for (let i = 0; i < this.players.length; i += 1) this.players[i]!.syncState(io, registry);
    for (let i = 0; i < this.sidekicks.length; i += 1) this.sidekicks[i]?.syncState(io);
    for (let i = 0; i < this.mobs.length; i += 1) this.mobs[i]!.syncState(io, registry);
    if (io.reading && this.bossSpawned && !this.boss && this.enterGame) {
      this.ensureBoss(this.enterGame);
    }
    if (io.reading && !this.bossSpawned && this.boss) {
      this.boss.alive = false; // rolled back before the boss existed
    }
    if (this.boss && this.bossSpawned) this.boss.syncState(io, registry);
    this.projectileManager?.syncState(io, registry);
    this.pickupManager?.syncState(io, registry);
    this.powerupSpawner?.syncState(io);
    this.waveSpawner?.syncState(io);
  }

  /** Post-rollback view repair — sync all visuals to the restored sim state. */
  reconcileView(): void {
    for (let i = 0; i < this.players.length; i += 1) this.players[i]!.reconcileView();
    for (let i = 0; i < this.mobs.length; i += 1) this.mobs[i]!.reconcileView();
    if (this.boss && this.bossSpawned) this.boss.reconcileView();
    else if (this.boss) this.boss.group.visible = false;
    this.projectileManager?.reconcileView();
    this.pickupManager?.reconcileView();
    this.powerupSpawner?.reconcileView();
  }

  render(_game: Game, _alpha: number): void {
    const now = performance.now(); // det-ok: render FPS display only
    const dt = Math.max(0.0001, (now - this.lastRenderMs) / 1000);
    this.lastRenderMs = now;
    this.fps = 1 / dt;
    this.cameraRig?.update(TIMESTEP);
  }

  /**
   * Fighters are solid to each other (Ryder's rule: jump over enemies, don't
   * walk through them). Positional push-apart, weight-weighted; skipped for
   * anyone being launched/stunned so knockback still carries through, and for
   * ghosts (noclip) and respawn-invulnerable fighters.
   */
  private separateFighters(dt: number): void {
    const maxPush = 10 * dt; // shove speed cap: firm but not teleporty
    for (let i = 0; i < this.liveFighters.length; i += 1) {
      const a = this.liveFighters[i]!;
      if (!fighterIsSolid(a)) continue;
      for (let k = i + 1; k < this.liveFighters.length; k += 1) {
        const b = this.liveFighters[k]!;
        if (!fighterIsSolid(b)) continue;
        const overlapX =
          Math.min(a.body.maxX, b.body.maxX) - Math.max(a.body.minX, b.body.minX);
        if (overlapX <= 0) continue;
        const overlapY =
          Math.min(a.body.maxY, b.body.maxY) - Math.max(a.body.minY, b.body.minY);
        if (overlapY <= 0.05) continue; // airborne clearance — jumping over works
        const push = Math.min(overlapX, maxPush);
        const dir = a.body.pos.x <= b.body.pos.x ? -1 : 1;
        const total = a.weight + b.weight;
        a.body.pos.x += dir * push * (b.weight / total);
        b.body.pos.x -= dir * push * (a.weight / total);
      }
    }
  }

  private spawnMob(_game: Game, enemyId: string, pos: Vec2): Mob | null {
    const pool = this.mobPool;
    const ctx = this.ctx;
    if (!pool || !ctx) return null;
    const mob = pool.obtain(enemyId);
    mob.koReset(pos);
    const target = ctx.nearestAlivePlayer(pos.x, pos.y);
    if (target) {
      mob.setTarget(target);
      mob.facing = mob.body.pos.x < target.body.pos.x ? 1 : -1;
    }
    return mob;
  }

  private telegraphSpawn(game: Game, pos: Vec2): void {
    this.particles?.directional(pos.x, pos.y + 0.1, 0, 1, COLOR_NEON_GREEN, 24, 4.2);
    game.events.emit('ui', { kind: 'confirm' });
  }

  private handleAllWavesCleared(game: Game): void {
    if (!this.level?.bossId) {
      this.beginLevelCleared(game);
      return;
    }
    if (this.bossSpawned || this.bossSpawnQueued || this.levelEnding) return;
    this.bossSpawnQueued = true;
    this.bossSpawnTimer = 1;
    this.pickupManager?.vacuumAll();
  }

  private updateBossSpawn(game: Game, dt: number): void {
    if (!this.bossSpawnQueued) return;
    this.bossSpawnTimer = Math.max(0, this.bossSpawnTimer - dt);
    if (this.bossSpawnTimer > 0) return;
    this.bossSpawnQueued = false;
    this.spawnBoss(game);
  }

  private spawnBoss(game: Game): void {
    const bossId = this.level?.bossId;
    const stage = this.stage;
    const target = this.ctx?.nearestAlivePlayer(0, 0);
    if (!bossId || !stage) return;

    const def = bossById(bossId);
    const boss = this.ensureBoss(game);
    if (!boss) return;
    const spawn = stage.def.respawnPoint;
    boss.koReset({ x: 0, y: spawn.y });
    boss.facing = target && boss.body.pos.x < target.body.pos.x ? 1 : -1;
    this.bossSpawned = true;
    game.events.emit('bossSpawned', { name: def.name, title: def.title });
    game.events.emit('bossHp', { frac: 1 });
    game.events.emit('music', { mood: 'boss' });
  }

  /** Construct the level boss once; later rollback timelines reuse the object. */
  private ensureBoss(game: Game): Boss | null {
    if (this.boss) return this.boss;
    const bossId = this.level?.bossId;
    if (!bossId) return null;
    const boss = this.createBoss(game, bossId);
    this.boss = boss;
    this.registry.register(boss.id, boss);
    game.renderer.scene.add(boss.group);
    return boss;
  }

  private createBoss(game: Game, bossId: NonNullable<LevelDef['bossId']>): Boss {
    const drops = (def: BossDef, x: number, y: number) => this.spawnBossDrops(def, x, y);
    const requestMinion = (enemyId: string, pos: Vec2) => this.spawnBossMinion(game, enemyId, pos);
    const defeated = (boss: Boss) => this.handleBossDefeated(game, boss);
    switch (bossId) {
      case 'skeletonKing':
        return new SkeletonKing(drops, requestMinion, defeated);
      case 'giantGhost':
        return new GiantGhost(drops, requestMinion, defeated);
      case 'giantEagle':
        return new GiantEagle(drops, requestMinion, defeated);
      case 'lavaGolem':
        return new LavaGolem(drops, requestMinion, defeated);
    }
  }

  private spawnBossMinion(game: Game, enemyId: string, pos: Vec2): Mob | null {
    if (this.levelEnding) return null;
    const mob = this.spawnMob(game, enemyId, pos);
    if (!mob) return null;
    mob.body.vel.y = Math.max(mob.body.vel.y, 3.2);
    mob.body.grounded = false;
    return mob;
  }

  private spawnBossDrops(def: BossDef, x: number, _y: number): void {
    const stage = this.stage;
    const pickupManager = this.pickupManager;
    if (!stage || !pickupManager) return;

    let plat = stage.def.platforms[0]!;
    for (const p of stage.def.platforms) if (p.w > plat.w) plat = p;
    const dropX = Math.min(plat.x + plat.w * 0.5 - 1, Math.max(plat.x - plat.w * 0.5 + 1, x));
    (pickupManager as unknown as BossDropPickupManager).spawnDrops(def, dropX, plat.y + 5);
  }

  private handleBossDefeated(game: Game, boss: Boss): void {
    if (this.boss !== boss) return;
    this.beginLevelCleared(game);
  }

  private collectLiveFighter(fighter: Fighter): void {
    if (!fighter.alive) return;
    this.liveFighters.push(fighter);
    if (fighter.hitstopTimer <= 0) this.physicsBodies.push(fighter.body);
  }

  private updateRespawns(ctx: WorldCtx, dt: number): void {
    if (this.levelEnding) return;
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i]!;
      const slot = this.matchState.slots[i]!;
      if (player.alive || slot.respawnTimer <= 0 || slot.eliminated) continue;
      slot.respawnTimer = Math.max(0, slot.respawnTimer - dt);
      if (slot.respawnTimer === 0 && player.stocks > 0) {
        player.respawn(ctx, this.respawnOffsetX(i));
      }
    }
  }

  /** Stagger multi-player respawn positions so simultaneous KOs don't stack. */
  private respawnOffsetX(index: number): number {
    return this.players.length === 1 ? 0 : (index - (this.players.length - 1) * 0.5) * 2.5;
  }

  private checkPlayerBlast(game: Game, index: number): void {
    const stage = this.stage;
    const particles = this.particles;
    const fighter = this.players[index]!;
    if (!stage || !particles || !fighter.alive || this.levelEnding) return;
    const x = fighter.body.pos.x;
    const y = fighter.body.pos.y + fighter.body.height * 0.5;
    const blast = stage.def.blast;
    if (x >= blast.left && x <= blast.right && y >= blast.bottom && y <= blast.top) return;

    const pos = { x, y };
    game.events.emit('ko', { pos, isPlayer: true, color: fighter.def.palette.glow });
    game.events.emit('screenShake', { amount: 1.35 });
    particles.koExplosion(x, y, fighter.def.palette.glow);
    fighter.beginKo();

    const slot = this.matchState.slots[index]!;
    // KO credit: whoever hit this player in the last 4s scores it (versus).
    if (slot.lastHitBySlot >= 0) {
      const scorer = this.matchState.slots[slot.lastHitBySlot];
      if (scorer && slot.lastHitBySlot !== index) scorer.kos += 1;
    }

    fighter.stocks -= 1;
    if (fighter.stocks > 0) {
      slot.respawnTimer = RESPAWN_DELAY;
      return;
    }

    // Out of stocks — mode decides what that means.
    switch (this.match.mode) {
      case 'campaign':
        this.beginLevelFailed(game);
        break;
      case 'coop': {
        // Level fails only when EVERY player is out of stocks simultaneously.
        let anyLeft = false;
        for (let i = 0; i < this.players.length; i += 1) {
          if (this.players[i]!.stocks > 0) anyLeft = true;
        }
        if (!anyLeft) this.beginLevelFailed(game);
        break;
      }
      case 'ffa':
      case 'teams':
        slot.eliminated = true;
        slot.eliminationFrame = this.matchState.frame;
        break;
    }
  }

  /** Versus modes: end the match when the rules say so (2.2s beat → results). */
  private evaluateVersusEnd(game: Game): void {
    if (!isVersus(this.match.mode) || this.matchState.ended || this.levelEnding) return;
    const end =
      this.match.mode === 'ffa'
        ? evaluateFfaEnd(this.matchState)
        : evaluateTeamsEnd(this.matchState, this.match);
    if (!end) return;
    this.matchState.ended = true;
    this.matchState.placements = end.placements;
    this.levelEnding = true;
    this.levelWon = true;
    this.levelEndTimer = CLEAR_BEAT_SECONDS;
    this.pickupManager?.vacuumAll();
    game.events.emit('music', { mood: 'victory' });
  }

  private checkMobBlast(game: Game, mob: Mob): void {
    const stage = this.stage;
    const particles = this.particles;
    const pickupManager = this.pickupManager;
    if (!stage || !particles || !pickupManager || !mob.alive || this.levelEnding) return;
    const x = mob.body.pos.x;
    const y = mob.body.pos.y + mob.body.height * 0.5;
    const blast = stage.def.blast;
    if (x >= blast.left && x <= blast.right && y >= blast.bottom && y <= blast.top) return;

    const pos = { x, y };
    game.events.emit('ko', { pos, isPlayer: false, color: mob.def.palette.glow });
    game.events.emit('screenShake', { amount: 1.1 });
    particles.koExplosion(x, y, mob.def.palette.glow);
    // Launched mobs die OUTSIDE the stage — rain their loot down onto the
    // widest platform instead so it's always collectible.
    let plat = stage.def.platforms[0]!;
    for (const p of stage.def.platforms) if (p.w > plat.w) plat = p;
    const dropX = Math.min(plat.x + plat.w * 0.5 - 1, Math.max(plat.x - plat.w * 0.5 + 1, x));
    pickupManager.spawnDrops(mob.enemyDef, dropX, plat.y + 5);
    mob.beginKo();

    if (mob.enemyDef.splitsInto) {
      const count = mob.enemyDef.splitsInto;
      particles.burst(x, y, mob.enemyDef.palette.core, 18, 5);
      for (let i = 0; i < count; i += 1) {
        this.splitSpawnPos.x = mob.body.pos.x + (i - (count - 1) * 0.5) * 0.45;
        this.splitSpawnPos.y = mob.body.pos.y + 0.25;
        const child = this.spawnMob(game, mob.enemyDef.splitChildId ?? 'slimeSmall', this.splitSpawnPos);
        if (child) {
          const rng = this.rng!.spawn;
          child.body.vel.x = (i % 2 === 0 ? -1 : 1) * (2.4 + rng.next() * 1.2);
          child.body.vel.y = 6 + rng.next() * 1.4;
          child.body.grounded = false;
        }
      }
    }
  }

  private beginLevelCleared(game: Game): void {
    if (this.levelEnding || !this.level) return;
    this.levelEnding = true;
    this.levelWon = true;
    this.levelEndTimer = CLEAR_BEAT_SECONDS;
    this.pickupManager?.vacuumAll();
    this.hud?.banner('VICTORY!', 1800);
    game.events.emit('announce', { id: 'ann_victory' });
    game.events.emit('levelCleared', { levelId: this.level.id });
    game.events.emit('music', { mood: 'victory' });
  }

  private beginLevelFailed(game: Game): void {
    if (this.levelEnding || !this.level) return;
    this.levelEnding = true;
    this.levelWon = false;
    this.levelEndTimer = 0;
    game.events.emit('levelFailed', { levelId: this.level.id });
    game.events.emit('music', { mood: 'defeat' });
  }

  private updateLevelEnd(game: Game, dt: number): void {
    if (!this.levelEnding || this.levelEndSent) return;
    if (this.levelEndTimer > 0) {
      this.levelEndTimer = Math.max(0, this.levelEndTimer - dt);
      if (this.levelEndTimer > 0) return;
    }
    this.levelEndSent = true;

    if (isVersus(this.match.mode)) {
      this.finishVersusMatch();
      return;
    }
    if (!this.level) return;

    // Any loot still flying toward the player is banked instantly — the coin
    // was earned the moment it dropped; the flight is just theater.
    this.pickupManager?.bankAll();
    // Winning pays the level's gold bounty on top of whatever loot dropped.
    const bounty = this.levelWon ? this.level.goldReward : 0;
    const result: LevelEndResult = {
      won: this.levelWon,
      goldEarned: this.goldEarned + bounty,
      materialsEarned: { ...this.materialsEarned },
      levelId: this.level.id,
    };
    if (this.opts.onLevelEnd) {
      this.opts.onLevelEnd(result);
      return;
    }
    game.screens.replace(new GameplayScreen({
      characterId: this.opts.characterId,
      levelId: result.levelId,
      weaponId: this.opts.weaponId,
    }));
  }

  private finishVersusMatch(): void {
    const placements = this.matchState.placements.length
      ? this.matchState.placements
      : computePlacements(this.matchState);
    const kosBySlot = this.matchState.slots.map((slot) => slot.kos);
    const goldBySlot = new Array<number>(this.matchState.slots.length).fill(0);
    for (let p = 0; p < placements.length; p += 1) {
      const slotId = placements[p]!;
      goldBySlot[slotId] = versusGoldFor(p, kosBySlot[slotId] ?? 0);
    }
    const result: VersusEndResult = { placements, kosBySlot, goldBySlot };
    if (this.match.mode === 'teams' && placements.length > 0) {
      result.winnerTeam = this.match.players[placements[0]!]!.teamId;
    }
    this.opts.onMatchEnd?.(result);
  }

  private updateCamera(stage: BuiltStage): void {
    const local = this.localPlayer;
    if (!local) return;
    this.cameraPoints.length = 0;
    // Local player FIRST — CameraRig gives point 0 double weight, so each
    // device's own fighter stays prioritized in the framing.
    if (local.alive) this.cameraPoints.push(local.body.pos);
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i]!;
      if (player !== local && player.alive) this.cameraPoints.push(player.body.pos);
    }
    if (this.boss?.alive) this.cameraPoints.push(this.boss.body.pos);

    let bestA: Mob | null = null;
    let bestB: Mob | null = null;
    let bestAD = Number.POSITIVE_INFINITY;
    let bestBD = Number.POSITIVE_INFINITY;
    const px = local.body.pos.x;
    const py = local.body.pos.y;
    for (let i = 0; i < this.mobs.length; i += 1) {
      const mob = this.mobs[i]!;
      if (!mob.alive) continue;
      const dx = mob.body.pos.x - px;
      const dy = mob.body.pos.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestAD) {
        bestB = bestA;
        bestBD = bestAD;
        bestA = mob;
        bestAD = d;
      } else if (d < bestBD) {
        bestB = mob;
        bestBD = d;
      }
    }
    if (bestA) this.cameraPoints.push(bestA.body.pos);
    if (bestB) this.cameraPoints.push(bestB.body.pos);
    this.cameraRig?.follow(this.cameraPoints);
    this.cameraRig?.setBounds(stage.def.blast.left, stage.def.blast.right, stage.def.blast.bottom);
  }

  private countAliveMobs(): number {
    let count = 0;
    for (let i = 0; i < this.mobs.length; i += 1) {
      if (this.mobs[i]!.alive) count += 1;
    }
    return count;
  }

  /**
   * Labeled sim-state segments (replay verification + divergence bisecting).
   * Every sim-relevant scalar in the match should appear here — the segment
   * list doubles as the net-snapshot blueprint.
   */
  stateDump(): { label: string; values: number[] }[] {
    const segments: { label: string; values: number[] }[] = [];
    const push = (label: string, fill: (out: number[]) => void) => {
      const values: number[] = [];
      fill(values);
      segments.push({ label, values });
    };
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i]!;
      push(`p${i}:${player.def.id}`, (out) => player.digestInto(out));
    }
    for (let i = 0; i < this.mobs.length; i += 1) {
      const mob = this.mobs[i]!;
      push(`mob${i}:${mob.enemyDef.id}`, (out) => mob.digestInto(out));
    }
    if (this.boss && this.bossSpawned) push(`boss:${this.boss.bossId}`, (out) => this.boss!.digestInto(out));
    push('projectiles', (out) => this.projectileManager?.digestInto(out));
    push('pickups', (out) => this.pickupManager?.digestInto(out));
    push('crates', (out) => this.powerupSpawner?.digestInto(out));
    push('waves', (out) => this.waveSpawner?.digestInto(out));
    push('match', (out) => {
      digestMatchState(this.matchState, out);
      out.push(
        this.goldEarned,
        this.materialsEarned.boneShard ?? 0,
        this.materialsEarned.slimeGoo ?? 0,
        this.materialsEarned.ghostEssence ?? 0,
        this.materialsEarned.feather ?? 0,
        this.materialsEarned.energyCore ?? 0,
        this.levelEnding ? 1 : 0,
        this.levelWon ? 1 : 0,
        this.levelEndTimer,
        this.levelEndSent ? 1 : 0,
        this.bossSpawnQueued ? 1 : 0,
        this.bossSpawnTimer,
        this.bossSpawned ? 1 : 0,
        getMobAttackTokens(),
      );
      const rng = this.rng;
      if (rng) {
        out.push(...rng.ai.getState(), ...rng.drops.getState(), ...rng.spawn.getState(), ...rng.reserve.getState());
      }
    });
    return segments;
  }

  /** xxHash32 over the full sim-state dump — one number per frame. */
  stateDigest(): number {
    const flat: number[] = [];
    const segments = this.stateDump();
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!;
      flat.push(seg.values.length);
      for (let v = 0; v < seg.values.length; v += 1) flat.push(seg.values[v]!);
    }
    return hashNumbers(flat);
  }

  private createDebug(game: Game): void {
    this.debugPanel = document.createElement('div');
    this.debugPanel.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:50;pointer-events:none;' +
      'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
      'color:#bffcff;text-shadow:0 0 8px #00eaff;white-space:pre;';
    document.getElementById('ui')?.appendChild(this.debugPanel);

    this.debugGroup = new THREE.Group();
    game.renderer.scene.add(this.debugGroup);
    for (let i = 0; i < DEBUG_BODY_SLOTS; i += 1) {
      this.debugBodyLines.push(this.createLineBox(COLOR_NEON_CYAN));
    }
    for (let i = 0; i < DEBUG_HITBOX_SLOTS; i += 1) {
      this.debugHitboxLines.push(this.createLineBox(COLOR_NEON_PINK));
    }
  }

  private createLineBox(color: number): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(24), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attr);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    });
    const line = new THREE.LineSegments(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    this.debugGeometries.push(geometry);
    this.debugMaterials.push(material);
    this.debugGroup?.add(line);
    return line;
  }

  private updateDebug(dt: number): void {
    const player = this.localPlayer;
    if (!player || !this.debugPanel) return;
    const aliveMobs = this.countAliveMobs();
    const boss = this.boss?.alive ? this.boss : null;
    const bossText = boss ? `${boss.bossDef.id}:${(boss.hpFrac * 100).toFixed(0)}% ${boss.state}` : 'none';
    let states = '';
    let shown = 0;
    for (let i = 0; i < this.mobs.length && shown < 6; i += 1) {
      const mob = this.mobs[i]!;
      if (!mob.alive) continue;
      states += `${shown === 0 ? '' : ' | '}${mob.enemyDef.id}:${mob.brainState}${mob.isBlocking ? ':block' : ''}`;
      shown += 1;
    }
    if (states.length === 0) states = 'none';
    this.debugPanel.textContent =
      `P ${player.state} ${player.damage.toFixed(0)}% stocks:${player.stocks}\n` +
      `vel ${player.body.vel.x.toFixed(2)}, ${player.body.vel.y.toFixed(2)} grounded:${player.body.grounded}\n` +
      `wave ${this.waveSpawner?.currentWaveNumber ?? 0}/${this.waveSpawner?.totalWaves ?? 0} pending:${this.waveSpawner?.pendingSpawns ?? 0}\n` +
      `boss ${bossText}\n` +
      `mobs ${aliveMobs}/${this.mobs.length} ${states}\n` +
      `loot gold:${this.goldEarned}\n` +
      `FPS ${this.fps.toFixed(0)} step ${(dt * 1000).toFixed(1)}ms`;

    let lineIndex = 0;
    for (let i = 0; i < this.players.length && lineIndex < this.debugBodyLines.length; i += 1) {
      this.updateBodyLine(lineIndex, this.players[i]!);
      lineIndex += 1;
    }
    if (boss && lineIndex < this.debugBodyLines.length) {
      this.updateBodyLine(lineIndex, boss);
      lineIndex += 1;
    }
    for (let i = 0; i < this.mobs.length && lineIndex < this.debugBodyLines.length; i += 1) {
      const mob = this.mobs[i]!;
      if (!mob.alive) continue;
      this.updateBodyLine(lineIndex, mob);
      lineIndex += 1;
    }
    for (; lineIndex < this.debugBodyLines.length; lineIndex += 1) {
      const line = this.debugBodyLines[lineIndex];
      if (line) line.visible = false;
    }
    for (let i = 0; i < this.debugHitboxLines.length; i += 1) {
      const line = this.debugHitboxLines[i];
      if (!line) continue;
      const hitbox = this.debugSubmittedHitboxes[i];
      if (!hitbox) {
        line.visible = false;
        continue;
      }
      updateLineBox(line, hitbox.worldRect(), 0.3);
    }
  }

  private updateBodyLine(index: number, fighter: Fighter): void {
    const line = this.debugBodyLines[index];
    if (!line) return;
    if (!fighter.alive) {
      line.visible = false;
      return;
    }
    updateLineBoxFromBody(line, fighter.body, 0.25);
  }

  private destroyDebug(): void {
    this.debugPanel?.remove();
    this.debugPanel = null;
    this.debugGroup?.parent?.remove(this.debugGroup);
    this.debugGroup = null;
    for (let i = 0; i < this.debugGeometries.length; i += 1) this.debugGeometries[i]!.dispose();
    for (let i = 0; i < this.debugMaterials.length; i += 1) this.debugMaterials[i]!.dispose();
    this.debugGeometries.length = 0;
    this.debugMaterials.length = 0;
    this.debugBodyLines.length = 0;
    this.debugHitboxLines.length = 0;
  }
}

function updateLineBoxFromBody(line: THREE.LineSegments, body: Body, z: number): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const pos = attr.array as Float32Array;
  pos[0] = body.minX;
  pos[1] = body.minY;
  pos[2] = z;
  pos[3] = body.maxX;
  pos[4] = body.minY;
  pos[5] = z;
  pos[6] = body.maxX;
  pos[7] = body.minY;
  pos[8] = z;
  pos[9] = body.maxX;
  pos[10] = body.maxY;
  pos[11] = z;
  pos[12] = body.maxX;
  pos[13] = body.maxY;
  pos[14] = z;
  pos[15] = body.minX;
  pos[16] = body.maxY;
  pos[17] = z;
  pos[18] = body.minX;
  pos[19] = body.maxY;
  pos[20] = z;
  pos[21] = body.minX;
  pos[22] = body.minY;
  pos[23] = z;
  attr.needsUpdate = true;
  line.visible = true;
}

function updateLineBox(line: THREE.LineSegments, rect: Rect, z: number): void {
  const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const pos = attr.array as Float32Array;
  pos[0] = rect.minX;
  pos[1] = rect.minY;
  pos[2] = z;
  pos[3] = rect.maxX;
  pos[4] = rect.minY;
  pos[5] = z;
  pos[6] = rect.maxX;
  pos[7] = rect.minY;
  pos[8] = z;
  pos[9] = rect.maxX;
  pos[10] = rect.maxY;
  pos[11] = z;
  pos[12] = rect.maxX;
  pos[13] = rect.maxY;
  pos[14] = z;
  pos[15] = rect.minX;
  pos[16] = rect.maxY;
  pos[17] = z;
  pos[18] = rect.minX;
  pos[19] = rect.maxY;
  pos[20] = z;
  pos[21] = rect.minX;
  pos[22] = rect.minY;
  pos[23] = z;
  attr.needsUpdate = true;
  line.visible = true;
}

/** SimRng snapshot plumbing: 4 int32 state words per stream. */
function syncRng(rng: SimRng, io: StateIO): void {
  const state = rng.getState();
  const a = io.i32(state[0]);
  const b = io.i32(state[1]);
  const c = io.i32(state[2]);
  const d = io.i32(state[3]);
  if (io.reading) rng.setState(a, b, c, d);
}

/** Solid for body-blocking: on their feet and physically present. */
function fighterIsSolid(f: Fighter): boolean {
  return (
    f.alive &&
    !f.body.noclip &&
    !f.isInvulnerable &&
    f.state !== 'launched' &&
    f.state !== 'hitstun' &&
    f.state !== 'ko' &&
    f.state !== 'respawning'
  );
}

function disposeParticles(particles: Particles, scene: THREE.Scene): void {
  const points = (particles as unknown as ParticleInternals).points;
  scene.remove(points);
  points.geometry.dispose();
  disposeMaterial(points.material);
}

function disposeTrails(trails: Trails, scene: THREE.Scene): void {
  const pool = (trails as unknown as TrailInternals).pool;
  for (let i = 0; i < pool.length; i += 1) {
    const trail = pool[i]!;
    trail.reset();
    scene.remove(trail.mesh);
    trail.mesh.geometry.dispose();
    disposeMaterial(trail.mesh.material);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (let i = 0; i < material.length; i += 1) material[i]!.dispose();
  } else {
    material.dispose();
  }
}
