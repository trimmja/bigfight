import type { MaterialId, PowerupId, Vec2 } from '../data/types';

/**
 * Global game events (frozen contract). Payloads are plain data so audio/UI/
 * particles can react without importing entity classes.
 */
export interface GameEvents {
  /** Any successful hit. intensity ≈ damage dealt; pos = impact point. */
  hit: { pos: Vec2; damage: number; kb: number; victimIsPlayer: boolean };
  /** A fighter crossed a blast zone. */
  ko: { pos: Vec2; isPlayer: boolean; color: number };
  jump: { isPlayer: boolean };
  shoot: { kind: string; pos: Vec2 };
  explosion: { pos: Vec2; radius: number };
  /** Player picked up gold/materials. */
  loot: { gold: number; material?: MaterialId };
  powerup: { id: PowerupId; pos: Vec2 };
  waveCleared: { wave: number; totalWaves: number };
  levelCleared: { levelId: number };
  levelFailed: { levelId: number };
  bossSpawned: { name: string; title: string };
  bossDefeated: { name: string };
  bossHp: { frac: number };
  /** UI blips. */
  ui: { kind: 'move' | 'confirm' | 'back' | 'buy' | 'error' | 'unlock' };
  /** Music mood change request. */
  music: { mood: 'menu' | 'battle' | 'boss' | 'victory' | 'defeat' | 'off' };
  screenShake: { amount: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) (fn as Handler<GameEvents[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Single shared bus — systems subscribe in their constructors. */
export const events = new EventBus();
