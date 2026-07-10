import * as THREE from 'three';
import { enemyById } from '../data/enemies';
import type { LevelDef } from '../data/types';
import { Mob } from './Mob';

/**
 * Per-level mob pool (netplay requirement): every mob a level can EVER show is
 * constructed once at level load — rigs included — so nothing allocates or
 * touches the scene graph mid-match. That makes spawn/despawn a pure flag flip,
 * which rollback can replay for free, and keeps entity ids deterministic
 * (nothing constructs mid-match → resetEntityIds() at enter reproduces ids).
 *
 * Sizing: waves are sequential and only advance at liveMobCount === 0, so the
 * per-id concurrent cap is the max single-wave count, plus split children
 * (slime → 2× slimeSmall on death), plus each boss's minion cap.
 */

/** Mirrors each boss's requestMinion(id, cap, …) calls — keep in sync. */
const BOSS_MINIONS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  skeletonKing: { skeleton: 3 },
  giantGhost: {},
  giantEagle: { miniEagle: 4 },
};

export class MobPool {
  /** All pooled mobs in stable creation order — the sim iterates THIS. */
  readonly all: Mob[] = [];

  private readonly freeByType = new Map<string, Mob[]>();
  private readonly freeSet = new Set<Mob>();

  constructor(private readonly scene: THREE.Scene) {}

  /** Compute per-enemyId pool caps for a level (see header). */
  static planFor(level: LevelDef): Map<string, number> {
    const caps = new Map<string, number>();
    let maxSplitChildren = 0;
    for (const wave of level.waves) {
      const inWave = new Map<string, number>();
      for (const entry of wave.enemies) {
        inWave.set(entry.enemyId, (inWave.get(entry.enemyId) ?? 0) + entry.count);
      }
      let waveSplitChildren = 0;
      for (const [id, count] of inWave) {
        if (count > (caps.get(id) ?? 0)) caps.set(id, count);
        const def = enemyById(id);
        if (def.splitsInto) waveSplitChildren += count * def.splitsInto;
      }
      if (waveSplitChildren > maxSplitChildren) maxSplitChildren = waveSplitChildren;
    }
    if (maxSplitChildren > 0) {
      caps.set('slimeSmall', (caps.get('slimeSmall') ?? 0) + maxSplitChildren);
    }
    if (level.bossId) {
      const minions = BOSS_MINIONS[level.bossId] ?? {};
      for (const id of Object.keys(minions)) {
        caps.set(id, (caps.get(id) ?? 0) + minions[id]!);
      }
    }
    return caps;
  }

  /** Construct every pooled mob (rigs and all) — call once at level enter. */
  prewarm(level: LevelDef): void {
    const caps = MobPool.planFor(level);
    for (const [enemyId, cap] of caps) {
      for (let i = 0; i < cap; i += 1) this.markFree(this.construct(enemyId));
    }
  }

  /**
   * Take a mob of this type. Falls back to constructing (with a warning) if
   * the plan under-counted — spawns must NEVER be silently lost, or the wave
   * counter would deadlock.
   */
  obtain(enemyId: string): Mob {
    const free = this.freeByType.get(enemyId);
    const mob = free?.pop();
    if (mob) {
      this.freeSet.delete(mob);
      return mob;
    }
    console.warn(`MobPool: cap miss for '${enemyId}' — constructing mid-match (plan bug?)`);
    return this.construct(enemyId);
  }

  /** Return a dead mob to its pool (idempotent). Hides the rig. */
  release(mob: Mob): void {
    if (this.freeSet.has(mob)) return;
    mob.group.visible = false;
    this.markFree(mob);
  }

  dispose(): void {
    for (const mob of this.all) mob.dispose();
    this.all.length = 0;
    this.freeByType.clear();
    this.freeSet.clear();
  }

  private construct(enemyId: string): Mob {
    const mob = new Mob(enemyById(enemyId));
    mob.alive = false;
    mob.group.visible = false;
    this.scene.add(mob.group);
    this.all.push(mob);
    return mob;
  }

  private markFree(mob: Mob): void {
    this.freeSet.add(mob);
    let free = this.freeByType.get(mob.enemyDef.id);
    if (!free) {
      free = [];
      this.freeByType.set(mob.enemyDef.id, free);
    }
    free.push(mob);
  }
}
