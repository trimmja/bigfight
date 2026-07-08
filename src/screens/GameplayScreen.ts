import * as THREE from 'three';
import {
  COLOR_NEON_CYAN,
  COLOR_NEON_PINK,
  COLOR_NEON_YELLOW,
  DEBUG,
  PLAYER_STOCKS,
  RESPAWN_DELAY,
  TIMESTEP,
} from '../config';
import type { ActiveHitbox, Rect } from '../combat/types';
import { HitResolver } from '../combat/HitResolver';
import { characterById } from '../data/characters';
import { stageById } from '../data/stages';
import type { Vec2 } from '../data/types';
import type { Game } from '../Game';
import { Body } from '../physics/Body';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CameraRig } from '../render/CameraRig';
import { Particles } from '../render/Particles';
import { Trails } from '../render/Trails';
import { Fighter } from '../entities/Fighter';
import { Player } from '../entities/Player';
import type { WorldCtx } from '../entities/Entity';
import { buildStage, type BuiltStage } from '../stages/StageBuilder';
import type { Screen } from './Screen';

type ParticleInternals = { points: THREE.Points };
type TrailInternals = { pool: { mesh: THREE.Mesh; reset(): void }[] };

const DUMMY_RESPAWN_DELAY = 1;
const DEBUG_HITBOX_SLOTS = 8;

export class GameplayScreen implements Screen {
  private readonly opts: { characterId: string; stageId: string };
  private stage: BuiltStage | null = null;
  private player: Player | null = null;
  private dummy: Fighter | null = null;
  private particles: Particles | null = null;
  private trails: Trails | null = null;
  private cameraRig: CameraRig | null = null;
  private hitResolver: HitResolver | null = null;
  private physics: PhysicsWorld | null = null;
  private ctx: WorldCtx | null = null;
  private hitUnsub: (() => void) | null = null;
  private readonly dummySpawn: Vec2 = { x: 4, y: 0 };
  private readonly physicsBodies: Body[] = [];
  private readonly liveFighters: Fighter[] = [];
  private readonly cameraPoints: Vec2[] = [];
  private readonly debugSubmittedHitboxes: ActiveHitbox[] = [];
  private playerRespawnTimer = 0;
  private dummyRespawnTimer = 0;
  private fps = 60;
  private lastRenderMs = performance.now();

  private debugPanel: HTMLDivElement | null = null;
  private debugGroup: THREE.Group | null = null;
  private readonly debugBodyLines: THREE.LineSegments[] = [];
  private readonly debugHitboxLines: THREE.LineSegments[] = [];
  private readonly debugMaterials: THREE.Material[] = [];
  private readonly debugGeometries: THREE.BufferGeometry[] = [];

  constructor(opts: { characterId: string; stageId: string }) {
    this.opts = opts;
  }

  enter(game: Game): void {
    const stageDef = stageById(this.opts.stageId);
    const playerDef = characterById(this.opts.characterId);
    const dummyDef = characterById('grim');

    this.stage = buildStage(stageDef, game.renderer.scene);
    this.particles = new Particles(game.renderer.scene);
    this.trails = new Trails(game.renderer.scene);
    this.cameraRig = new CameraRig(game.renderer.camera);
    this.hitResolver = new HitResolver();
    this.physics = new PhysicsWorld();

    this.player = new Player(playerDef, game.input);
    this.player.koReset(stageDef.playerSpawn);
    this.player.facing = 1;
    this.dummy = new Fighter(dummyDef, 'enemy');
    this.dummySpawn.x = 4;
    this.dummySpawn.y = stageDef.enemySpawns[0]?.y ?? stageDef.playerSpawn.y;
    this.dummy.koReset(this.dummySpawn);
    this.dummy.facing = -1;
    game.renderer.scene.add(this.player.group, this.dummy.group);

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
    };

    this.cameraRig.setBounds(stageDef.blast.left, stageDef.blast.right, stageDef.blast.bottom);
    this.hitUnsub = game.events.on('hit', ({ pos, damage, kb }) => {
      this.particles?.burst(pos.x, pos.y, COLOR_NEON_YELLOW, Math.min(28, 8 + damage * 3), 5 + kb * 0.22);
    });

    if (DEBUG) this.createDebug(game);
    game.input.setTouchControlsVisible(true);
    game.events.emit('music', { mood: 'battle' });
  }

  exit(game: Game): void {
    this.hitUnsub?.();
    this.hitUnsub = null;
    this.player?.dispose();
    this.dummy?.dispose();
    this.stage?.dispose();
    if (this.particles) disposeParticles(this.particles, game.renderer.scene);
    if (this.trails) disposeTrails(this.trails, game.renderer.scene);
    this.destroyDebug();
    game.input.setTouchControlsVisible(false);
    this.stage = null;
    this.player = null;
    this.dummy = null;
    this.particles = null;
    this.trails = null;
    this.cameraRig = null;
    this.hitResolver = null;
    this.physics = null;
    this.ctx = null;
  }

  update(game: Game, dt: number): void {
    const player = this.player;
    const dummy = this.dummy;
    const ctx = this.ctx;
    const stage = this.stage;
    const physics = this.physics;
    const hitResolver = this.hitResolver;
    if (!player || !dummy || !ctx || !stage || !physics || !hitResolver || !this.particles || !this.trails) return;

    hitResolver.beginStep();
    this.debugSubmittedHitboxes.length = 0;
    this.updateRespawns(ctx, dt);

    if (player.alive) player.update(ctx, dt);
    if (dummy.alive) dummy.update(ctx, dt);

    this.physicsBodies.length = 0;
    this.liveFighters.length = 0;
    this.collectLiveFighter(player);
    this.collectLiveFighter(dummy);

    physics.step(this.physicsBodies, stage.colliders, dt);
    for (let i = 0; i < this.liveFighters.length; i += 1) {
      this.liveFighters[i]?.afterPhysics(ctx);
    }

    hitResolver.resolve(this.liveFighters);

    this.checkBlast(game, player);
    this.checkBlast(game, dummy);

    this.cameraPoints.length = 0;
    if (player.alive) this.cameraPoints.push(player.body.pos);
    if (dummy.alive) this.cameraPoints.push(dummy.body.pos);
    this.cameraRig?.follow(this.cameraPoints);
    this.cameraRig?.setBounds(stage.def.blast.left, stage.def.blast.right, stage.def.blast.bottom);

    this.particles.update(dt);
    this.trails.update(dt);
    if (DEBUG) this.updateDebug(dt);
  }

  render(_game: Game, _alpha: number): void {
    const now = performance.now();
    const dt = Math.max(0.0001, (now - this.lastRenderMs) / 1000);
    this.lastRenderMs = now;
    this.fps = 1 / dt;
    // CameraRig smoothing runs in render so shake stays fluid between fixed steps.
    this.cameraRig?.update(TIMESTEP);
  }

  private collectLiveFighter(fighter: Fighter): void {
    if (!fighter.alive) return;
    this.liveFighters.push(fighter);
    if (fighter.hitstopTimer <= 0) this.physicsBodies.push(fighter.body);
  }

  private updateRespawns(ctx: WorldCtx, dt: number): void {
    const player = this.player;
    const dummy = this.dummy;
    if (player && !player.alive && this.playerRespawnTimer > 0) {
      this.playerRespawnTimer = Math.max(0, this.playerRespawnTimer - dt);
      if (this.playerRespawnTimer === 0) {
        if (player.stocks <= 0) player.stocks = PLAYER_STOCKS;
        player.respawn(ctx);
      }
    }
    if (dummy && !dummy.alive && this.dummyRespawnTimer > 0) {
      this.dummyRespawnTimer = Math.max(0, this.dummyRespawnTimer - dt);
      if (this.dummyRespawnTimer === 0) {
        dummy.koReset(this.dummySpawn);
        dummy.facing = -1;
      }
    }
  }

  private checkBlast(game: Game, fighter: Fighter): void {
    const stage = this.stage;
    const particles = this.particles;
    if (!stage || !particles || !fighter.alive) return;
    const x = fighter.body.pos.x;
    const y = fighter.body.pos.y + fighter.body.height * 0.5;
    const blast = stage.def.blast;
    if (x >= blast.left && x <= blast.right && y >= blast.bottom && y <= blast.top) return;

    const isPlayer = fighter === this.player;
    const pos = { x, y };
    game.events.emit('ko', { pos, isPlayer, color: fighter.def.palette.glow });
    game.events.emit('screenShake', { amount: 1.35 });
    particles.koExplosion(x, y, fighter.def.palette.glow);
    fighter.beginKo();

    if (isPlayer && this.player) {
      this.player.stocks -= 1;
      this.playerRespawnTimer = RESPAWN_DELAY;
    } else {
      this.dummyRespawnTimer = DUMMY_RESPAWN_DELAY;
    }
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
    for (let i = 0; i < 2; i += 1) {
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
    const dummy = this.dummy;
    if (!player || !dummy || !this.debugPanel) return;
    this.debugPanel.textContent =
      `P ${player.state} ${player.damage.toFixed(0)}% stocks:${player.stocks}\n` +
      `vel ${player.body.vel.x.toFixed(2)}, ${player.body.vel.y.toFixed(2)} grounded:${player.body.grounded}\n` +
      `D ${dummy.state} ${dummy.damage.toFixed(0)}%\n` +
      `FPS ${this.fps.toFixed(0)} step ${(dt * 1000).toFixed(1)}ms`;

    this.updateBodyLine(0, player);
    this.updateBodyLine(1, dummy);
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
    updateLineBox(line, bodyRect(fighter.body), 0.25);
  }

  private destroyDebug(): void {
    this.debugPanel?.remove();
    this.debugPanel = null;
    this.debugGroup?.parent?.remove(this.debugGroup);
    this.debugGroup = null;
    for (const geometry of this.debugGeometries) geometry.dispose();
    for (const material of this.debugMaterials) material.dispose();
    this.debugGeometries.length = 0;
    this.debugMaterials.length = 0;
    this.debugBodyLines.length = 0;
    this.debugHitboxLines.length = 0;
  }
}

function bodyRect(body: Body): Rect {
  return {
    minX: body.minX,
    maxX: body.maxX,
    minY: body.minY,
    maxY: body.maxY,
  };
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

function disposeParticles(particles: Particles, scene: THREE.Scene): void {
  const points = (particles as unknown as ParticleInternals).points;
  scene.remove(points);
  points.geometry.dispose();
  disposeMaterial(points.material);
}

function disposeTrails(trails: Trails, scene: THREE.Scene): void {
  const pool = (trails as unknown as TrailInternals).pool;
  for (const trail of pool) {
    trail.reset();
    scene.remove(trail.mesh);
    trail.mesh.geometry.dispose();
    disposeMaterial(trail.mesh.material);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
