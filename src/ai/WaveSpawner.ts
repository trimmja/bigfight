import { SPAWN_STAGGER, SPAWN_TELEGRAPH } from '../config';
import { events } from '../core/events';
import type { LevelDef, Vec2 } from '../data/types';

type SpawnQueueItem = { enemyId: string; pos: Vec2 };

export class WaveSpawner {
  onAllWavesCleared: (() => void) | null = null;
  /**
   * DIRECT sim callback fired the step a wave clears (pickup vacuum etc.).
   * Sim mutations must ride this, not the `waveCleared` event — the event is
   * suppressed during rollback resim (audio/banner only).
   */
  onWaveCleared: (() => void) | null = null;

  private readonly queue: SpawnQueueItem[] = [];
  private waveIndex = 0;
  private queueHead = 0;
  private spawnPointIndex = 0;
  private waveDelayTimer = 0;
  private staggerTimer = 0;
  private telegraphTimer = 0;
  private telegraphItem: SpawnQueueItem | null = null;
  private liveMobCount = 0;
  private waveActive = false;
  private allCleared = false;

  constructor(
    private readonly level: LevelDef,
    private readonly spawnPoints: readonly Vec2[],
    private readonly spawnMob: (enemyId: string, pos: Vec2) => void,
    private readonly telegraph: (pos: Vec2) => void = () => undefined,
  ) {
    this.waveDelayTimer = level.waves[0]?.delay ?? 0;
  }

  get currentWaveNumber(): number {
    return Math.min(this.waveIndex + 1, this.level.waves.length);
  }

  get totalWaves(): number {
    return this.level.waves.length;
  }

  get pendingSpawns(): number {
    return Math.max(0, this.queue.length - this.queueHead) + (this.telegraphItem ? 1 : 0);
  }

  setLiveMobCount(count: number): void {
    this.liveMobCount = count;
  }

  /** Sim-relevant scalars for replay digests / net snapshots. */
  digestInto(out: number[]): void {
    out.push(
      this.waveIndex,
      this.queueHead,
      this.queue.length,
      this.spawnPointIndex,
      this.waveDelayTimer,
      this.staggerTimer,
      this.telegraphTimer,
      this.telegraphItem ? 1 : 0,
      this.liveMobCount,
      this.waveActive ? 1 : 0,
      this.allCleared ? 1 : 0,
    );
  }

  update(dt: number): void {
    if (this.allCleared) return;

    if (this.telegraphItem) {
      this.telegraphTimer = Math.max(0, this.telegraphTimer - dt);
      if (this.telegraphTimer === 0) {
        const item = this.telegraphItem;
        this.telegraphItem = null;
        this.spawnMob(item.enemyId, item.pos);
        this.staggerTimer = SPAWN_STAGGER;
      }
      return;
    }

    if (this.queueHead < this.queue.length) {
      if (this.staggerTimer > 0) {
        this.staggerTimer = Math.max(0, this.staggerTimer - dt);
        return;
      }
      const item = this.queue[this.queueHead]!;
      this.queueHead += 1;
      this.telegraphItem = item;
      this.telegraphTimer = SPAWN_TELEGRAPH;
      this.telegraph(item.pos);
      return;
    }

    if (this.waveActive) {
      if (this.liveMobCount > 0) return;
      this.onWaveCleared?.();
      events.emit('waveCleared', { wave: this.waveIndex + 1, totalWaves: this.level.waves.length });
      this.waveIndex += 1;
      this.waveActive = false;
      if (this.waveIndex >= this.level.waves.length) {
        this.allCleared = true;
        this.onAllWavesCleared?.();
      } else {
        this.waveDelayTimer = this.level.waves[this.waveIndex]!.delay;
      }
      return;
    }

    if (this.waveDelayTimer > 0) {
      this.waveDelayTimer = Math.max(0, this.waveDelayTimer - dt);
      if (this.waveDelayTimer > 0) return;
    }

    this.startWave();
  }

  private startWave(): void {
    const wave = this.level.waves[this.waveIndex];
    if (!wave) {
      this.allCleared = true;
      this.onAllWavesCleared?.();
      return;
    }

    this.queue.length = 0;
    this.queueHead = 0;
    this.waveActive = true;
    for (let entryIndex = 0; entryIndex < wave.enemies.length; entryIndex += 1) {
      const entry = wave.enemies[entryIndex]!;
      for (let count = 0; count < entry.count; count += 1) {
        const spawn = this.nextSpawnPoint();
        this.queue.push({ enemyId: entry.enemyId, pos: { x: spawn.x, y: spawn.y } });
      }
    }
  }

  private nextSpawnPoint(): Vec2 {
    if (this.spawnPoints.length === 0) return { x: 0, y: 1 };
    const point = this.spawnPoints[this.spawnPointIndex % this.spawnPoints.length]!;
    this.spawnPointIndex += 1;
    return point;
  }
}
