/**
 * Generic fixed-size object pool. Pooled objects are created eagerly and
 * recycled — never allocated in the fixed step.
 */
export class Pool<T> {
  private items: T[] = [];
  private free: T[] = [];

  constructor(
    create: () => T,
    size: number,
    private onRelease?: (item: T) => void,
  ) {
    for (let i = 0; i < size; i++) {
      const item = create();
      this.items.push(item);
      this.free.push(item);
    }
  }

  /** Returns null when exhausted — callers must handle (skip the spawn). */
  obtain(): T | null {
    return this.free.pop() ?? null;
  }

  release(item: T): void {
    this.onRelease?.(item);
    this.free.push(item);
  }

  releaseAll(): void {
    this.free.length = 0;
    for (const item of this.items) {
      this.onRelease?.(item);
      this.free.push(item);
    }
  }

  get capacity(): number {
    return this.items.length;
  }
  get available(): number {
    return this.free.length;
  }
  /** All items ever created (active + free) — for iteration by owners. */
  get all(): readonly T[] {
    return this.items;
  }
}
