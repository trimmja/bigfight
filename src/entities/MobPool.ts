import * as THREE from 'three';
import { enemyById } from '../data/enemies';
import type { LevelDef } from '../data/types';
import { simPhase } from '../net/simPhase';
import { Mob } from './Mob';

/**
 * Per-level mob pool (netplay requirement): every mob a level can EVER show is
 * constructed once at level load — rigs included — so nothing allocates or
 * touches the scene graph mid-match. That makes spawn/despawn a pure flag flip,
 * which rollback can replay for free, and keeps entity ids deterministic
 * (nothing constructs mid-match → resetEntityIds() at enter reproduces ids).
 *
 * ACQUISITION IS STATE-DERIVED (first reusable slot of the type in creation
 * order), never free-list based — free-list order isn't canonical across
 * peers after rollbacks; a scan over deterministic state is.
 *
 * Sizing: waves are sequential and only advance at liveMobCount === 0, so the
 * per-id concurrent cap is the max single-wave count, plus split children
 * (slime → 2× slimeSmall on death), plus each boss's minion cap.
 */

/**
 * Mirrors each boss's requestMinion(id, cap, …) calls — keep in sync.
 * Minions that split must ALSO list their split children here (the wave-based
 * split math below never sees boss minions).
 */
const BOSS_MINIONS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  skeletonKing: { skeleton: 3 },
  giantGhost: {},
  giantEagle: { miniEagle: 4 },
  lavaGolem: { magmaSlime: 2, magmaSlimeSmall: 4 },
};

export class MobPool {
  /** All pooled mobs in stable creation order — the sim iterates THIS. */
  readonly all: Mob[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Compute per-enemyId pool caps for a level (see header). */
  static planFor(level: LevelDef): Map<string, number> {
    const caps = new Map<string, number>();
    const maxSplitChildren = new Map<string, number>();
    for (const wave of level.waves) {
      const inWave = new Map<string, number>();
      for (const entry of wave.enemies) {
        inWave.set(entry.enemyId, (inWave.get(entry.enemyId) ?? 0) + entry.count);
      }
      const waveSplitChildren = new Map<string, number>();
      for (const [id, count] of inWave) {
        if (count > (caps.get(id) ?? 0)) caps.set(id, count);
        const def = enemyById(id);
        if (def.splitsInto) {
          const childId = def.splitChildId ?? 'slimeSmall';
          waveSplitChildren.set(childId, (waveSplitChildren.get(childId) ?? 0) + count * def.splitsInto);
        }
      }
      for (const [childId, count] of waveSplitChildren) {
        if (count > (maxSplitChildren.get(childId) ?? 0)) maxSplitChildren.set(childId, count);
      }
    }
    for (const [childId, count] of maxSplitChildren) {
      caps.set(childId, (caps.get(childId) ?? 0) + count);
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
      for (let i = 0; i < cap; i += 1) this.construct(enemyId);
    }
  }

  /**
   * Take a mob of this type: first reusable slot in creation order (dead and
   * out of hitstop — mirrors the sweep's release criteria, so acquisition is
   * a pure function of sim state). Falls back to constructing (warn) if the
   * plan under-counted — spawns must NEVER be lost or waves would deadlock.
   */
  obtain(enemyId: string): Mob {
    for (let i = 0; i < this.all.length; i += 1) {
      const mob = this.all[i]!;
      if (mob.enemyDef.id === enemyId && !mob.alive && mob.hitstopTimer <= 0) return mob;
    }
    console.warn(`MobPool: cap miss for '${enemyId}' — constructing mid-match (plan bug?)`);
    return this.construct(enemyId);
  }

  /** Hide a dead mob's rig (view bookkeeping — sim truth is the alive flag). */
  release(mob: Mob): void {
    if (!simPhase.resimulating) mob.group.visible = false;
  }

  dispose(): void {
    for (const mob of this.all) mob.dispose();
    this.all.length = 0;
  }

  private construct(enemyId: string): Mob {
    const mob = new Mob(enemyById(enemyId));
    mob.alive = false;
    mob.group.visible = false;
    this.scene.add(mob.group);
    this.all.push(mob);
    return mob;
  }
}
