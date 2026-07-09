import * as THREE from 'three';
import {
  COLOR_NEON_CYAN,
  COLOR_NEON_GREEN,
  COLOR_NEON_PINK,
  COLOR_NEON_YELLOW,
  DEBUG,
  PLAYER_STOCKS,
  RESPAWN_DELAY,
  TIMESTEP,
} from '../config';
import { resetMobAttackTokens } from '../ai/MobBrain';
import { WaveSpawner } from '../ai/WaveSpawner';
import type { ActiveHitbox, FighterLike, Rect } from '../combat/types';
import { HitResolver } from '../combat/HitResolver';
import { characterById } from '../data/characters';
import { bossById, enemyById } from '../data/enemies';
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
import { SkeletonKing } from '../entities/bosses/SkeletonKing';
import { Fighter } from '../entities/Fighter';
import { Mob } from '../entities/Mob';
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

export type GameplayScreenOptions = {
  levelId?: number;
  characterId: string;
  stageId?: string;
  weaponId?: string;
  onLevelEnd?: (result: LevelEndResult) => void;
  onPause?: () => void;
};

const DEBUG_HITBOX_SLOTS = 8;
const DEBUG_BODY_SLOTS = 18;
const CLEAR_BEAT_SECONDS = 2.2;

export class GameplayScreen implements Screen {
  private readonly opts: GameplayScreenOptions;
  private readonly level: LevelDef;
  private stage: BuiltStage | null = null;
  private player: Player | null = null;
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
  private sidekick: Sidekick | null = null;
  private boss: Boss | null = null;
  private hitUnsub: (() => void) | null = null;
  private lootUnsub: (() => void) | null = null;
  private waveUnsub: (() => void) | null = null;

  private readonly mobs: Mob[] = [];
  private readonly physicsBodies: Body[] = [];
  private readonly liveFighters: Fighter[] = [];
  private readonly combatTargets: FighterLike[] = [];
  private readonly cameraPoints: Vec2[] = [];
  private readonly debugSubmittedHitboxes: ActiveHitbox[] = [];
  private readonly splitSpawnPos: Vec2 = { x: 0, y: 0 };
  private readonly materialsEarned: Partial<Record<MaterialId, number>> = {};

  private playerRespawnTimer = 0;
  private goldEarned = 0;
  private levelEnding = false;
  private levelWon = false;
  private levelEndTimer = 0;
  private levelEndSent = false;
  private bossSpawnQueued = false;
  private bossSpawnTimer = 0;
  private fps = 60;
  private lastRenderMs = performance.now();

  private debugPanel: HTMLDivElement | null = null;
  private debugGroup: THREE.Group | null = null;
  private readonly debugBodyLines: THREE.LineSegments[] = [];
  private readonly debugHitboxLines: THREE.LineSegments[] = [];
  private readonly debugMaterials: THREE.Material[] = [];
  private readonly debugGeometries: THREE.BufferGeometry[] = [];

  constructor(opts: GameplayScreenOptions) {
    this.opts = opts;
    this.level = levelById(opts.levelId ?? 1);
  }

  enter(game: Game): void {
    resetMobAttackTokens();
    const stageDef = stageById(this.level.stageId);
    const playerDef = characterById(this.opts.characterId);

    this.stage = buildStage(stageDef, game.renderer.scene);
    this.particles = new Particles(game.renderer.scene);
    this.trails = new Trails(game.renderer.scene);
    this.cameraRig = new CameraRig(game.renderer.camera, () => game.save.settings.shake);
    this.hitResolver = new HitResolver();
    this.physics = new PhysicsWorld();
    this.pickupManager = new PickupManager(game.renderer.scene);
    const projectileManager = new ProjectileManager(game.renderer.scene);
    this.projectileManager = projectileManager;
    this.powerupSpawner = new PowerupSpawner(game.renderer.scene, unlockedPowerupIds(game.save));

    this.player = new Player(playerDef, game.input);
    this.player.stocks = PLAYER_STOCKS;
    this.player.koReset(stageDef.playerSpawn);
    this.player.facing = 1;
    const weapon = weaponById(this.opts.weaponId ?? 'rustyPistol');
    this.player.equipWeapon(weapon, buildWeaponModel(weapon));
    game.renderer.scene.add(this.player.group);

    if (game.save.equippedSidekick) {
      this.sidekick = new Sidekick(
        sidekickById(game.save.equippedSidekick),
        this.player,
        projectileManager,
        () => this.liveFighters,
      );
      game.renderer.scene.add(this.sidekick.group);
    }

    this.hud = new Hud();
    this.damageNumbers = new DamageNumbers(game.renderer.scene);

    this.ctx = {
      particles: this.particles,
      trails: this.trails,
      stage: {
        colliders: this.stage.colliders,
        blast: stageDef.blast,
        respawnPoint: stageDef.respawnPoint,
      },
      playerPos: this.player.body.pos,
      requestHitbox: (h) => {
        this.hitResolver?.submit(h);
        if (DEBUG && this.debugSubmittedHitboxes.length < DEBUG_HITBOX_SLOTS) {
          this.debugSubmittedHitboxes.push(h);
        }
      },
      fireProjectile: (def, attackDef, x, y, facing, faction, power) => {
        this.projectileManager?.fire(def, x, y, facing, faction, power, attackDef);
      },
    };

    this.waveSpawner = new WaveSpawner(
      this.level,
      stageDef.enemySpawns,
      (enemyId, pos) => {
        this.spawnMob(game, enemyId, pos);
      },
      (pos) => this.telegraphSpawn(game, pos),
    );
    this.waveSpawner.onAllWavesCleared = () => this.handleAllWavesCleared(game);

    this.cameraRig.setBounds(stageDef.blast.left, stageDef.blast.right, stageDef.blast.bottom);
    this.hitUnsub = game.events.on('hit', ({ pos, damage, kb }) => {
      this.particles?.burst(pos.x, pos.y, COLOR_NEON_YELLOW, Math.min(28, 8 + damage * 3), 5 + kb * 0.22);
    });
    this.lootUnsub = game.events.on('loot', ({ gold, material }) => {
      this.goldEarned += gold;
      if (material) this.materialsEarned[material] = (this.materialsEarned[material] ?? 0) + 1;
    });
    this.waveUnsub = game.events.on('waveCleared', () => this.pickupManager?.vacuumAll());

    if (DEBUG) this.createDebug(game);
    game.input.setTouchControlsVisible(true);
    game.events.emit('music', { mood: 'battle' });
  }

  exit(game: Game): void {
    this.hitUnsub?.();
    this.lootUnsub?.();
    this.waveUnsub?.();
    this.hitUnsub = null;
    this.lootUnsub = null;
    this.waveUnsub = null;
    this.hud?.dispose();
    this.hud = null;
    this.damageNumbers?.dispose();
    this.damageNumbers = null;
    this.sidekick?.dispose();
    this.sidekick = null;
    this.boss?.dispose();
    this.boss = null;
    this.player?.dispose();
    for (let i = 0; i < this.mobs.length; i += 1) this.mobs[i]!.dispose();
    this.mobs.length = 0;
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
    this.player = null;
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
    const player = this.player;
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
      !player
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

    hitResolver.beginStep();
    this.debugSubmittedHitboxes.length = 0;
    this.updateRespawns(ctx, dt);

    if (!this.levelEnding) {
      this.waveSpawner?.setLiveMobCount(this.countAliveMobs());
      this.waveSpawner?.update(dt);
      this.updateBossSpawn(game, dt);
    }

    if (player.alive) player.update(ctx, dt);
    for (let i = 0; i < this.mobs.length; i += 1) {
      const mob = this.mobs[i]!;
      if (mob.alive) mob.update(ctx, dt);
    }
    if (this.boss?.alive) this.boss.update(ctx, dt);

    this.physicsBodies.length = 0;
    this.liveFighters.length = 0;
    this.collectLiveFighter(player);
    for (let i = 0; i < this.mobs.length; i += 1) this.collectLiveFighter(this.mobs[i]!);
    if (this.boss) this.collectLiveFighter(this.boss);
    if (this.sidekick && !this.levelEnding) this.sidekick.update(ctx, dt);
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

    if (player.alive) pickupManager.update(ctx, dt, player);
    if (player.alive && !this.levelEnding) powerupSpawner.update(ctx, dt, player);
    game.input.setWeaponCooldown(player.weaponCooldownFrac);

    this.checkBlast(game, player);
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

    // Sweep dead mobs (KO'd last frame — drops/splits already handled) so long
    // boss fights don't accumulate dead rigs in memory and loops.
    for (let i = this.mobs.length - 1; i >= 0; i -= 1) {
      const mob = this.mobs[i]!;
      if (!mob.alive && mob.hitstopTimer <= 0) {
        mob.dispose();
        this.mobs.splice(i, 1);
      }
    }

    this.updateCamera(stage);
    particles.update(dt);
    trails.update(dt);
    this.damageNumbers?.update(dt);
    if (this.player) this.hud?.set(this.player.damage, this.player.stocks);
    if (DEBUG) this.updateDebug(dt);
    this.updateLevelEnd(game, dt);
  }

  render(_game: Game, _alpha: number): void {
    const now = performance.now();
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

  private spawnMob(game: Game, enemyId: string, pos: Vec2): Mob | null {
    const player = this.player;
    if (!player) return null;
    const mob = new Mob(enemyById(enemyId));
    mob.setTarget(player);
    mob.koReset(pos);
    mob.facing = mob.body.pos.x < player.body.pos.x ? 1 : -1;
    this.mobs.push(mob);
    game.renderer.scene.add(mob.group);
    return mob;
  }

  private telegraphSpawn(game: Game, pos: Vec2): void {
    this.particles?.directional(pos.x, pos.y + 0.1, 0, 1, COLOR_NEON_GREEN, 24, 4.2);
    game.events.emit('ui', { kind: 'confirm' });
  }

  private handleAllWavesCleared(game: Game): void {
    if (!this.level.bossId) {
      this.beginLevelCleared(game);
      return;
    }
    if (this.boss || this.bossSpawnQueued || this.levelEnding) return;
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
    const bossId = this.level.bossId;
    const stage = this.stage;
    const player = this.player;
    if (!bossId || !stage || !player) return;

    const def = bossById(bossId);
    const boss = this.createBoss(game, bossId);
    const spawn = stage.def.respawnPoint;
    boss.koReset({ x: 0, y: spawn.y });
    boss.facing = boss.body.pos.x < player.body.pos.x ? 1 : -1;
    this.boss = boss;
    game.renderer.scene.add(boss.group);
    game.events.emit('bossSpawned', { name: def.name, title: def.title });
    game.events.emit('bossHp', { frac: 1 });
    game.events.emit('music', { mood: 'boss' });
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
    const player = this.player;
    if (!player || player.alive || this.playerRespawnTimer <= 0 || this.levelEnding) return;
    this.playerRespawnTimer = Math.max(0, this.playerRespawnTimer - dt);
    if (this.playerRespawnTimer === 0 && player.stocks > 0) player.respawn(ctx);
  }

  private checkBlast(game: Game, fighter: Fighter): void {
    const stage = this.stage;
    const particles = this.particles;
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

    if (this.player) {
      this.player.stocks -= 1;
      if (this.player.stocks <= 0) {
        this.beginLevelFailed(game);
      } else {
        this.playerRespawnTimer = RESPAWN_DELAY;
      }
    }
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
        const child = this.spawnMob(game, 'slimeSmall', this.splitSpawnPos);
        if (child) {
          child.body.vel.x = (i % 2 === 0 ? -1 : 1) * (2.4 + Math.random() * 1.2);
          child.body.vel.y = 6 + Math.random() * 1.4;
          child.body.grounded = false;
        }
      }
    }
  }

  private beginLevelCleared(game: Game): void {
    if (this.levelEnding) return;
    this.levelEnding = true;
    this.levelWon = true;
    this.levelEndTimer = CLEAR_BEAT_SECONDS;
    this.pickupManager?.vacuumAll();
    game.events.emit('levelCleared', { levelId: this.level.id });
    game.events.emit('music', { mood: 'victory' });
  }

  private beginLevelFailed(game: Game): void {
    if (this.levelEnding) return;
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

  private updateCamera(stage: BuiltStage): void {
    const player = this.player;
    if (!player) return;
    this.cameraPoints.length = 0;
    if (player.alive) this.cameraPoints.push(player.body.pos);
    if (this.boss?.alive) this.cameraPoints.push(this.boss.body.pos);

    let bestA: Mob | null = null;
    let bestB: Mob | null = null;
    let bestAD = Number.POSITIVE_INFINITY;
    let bestBD = Number.POSITIVE_INFINITY;
    const px = player.body.pos.x;
    const py = player.body.pos.y;
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
    const player = this.player;
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

    this.updateBodyLine(0, player);
    let lineIndex = 1;
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
