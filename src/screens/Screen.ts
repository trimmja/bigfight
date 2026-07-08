import type { Game } from '../Game';

/**
 * A screen owns a DOM root under #ui (created in enter, removed in exit) and
 * optionally drives the shared Three scene. Frozen contract.
 */
export interface Screen {
  /** Called when the screen becomes active. */
  enter(game: Game): void;
  /** Called when the screen is removed/replaced. Must clean up DOM + scene. */
  exit(game: Game): void;
  /** Fixed-timestep update. Only the top screen of the stack updates. */
  update(game: Game, dt: number): void;
  /** Per-rAF render hook (camera work, visual-only animation). */
  render?(game: Game, alpha: number): void;
  onResize?(game: Game): void;
  /** Overlays (pause) return true so the screen below keeps rendering. */
  readonly isOverlay?: boolean;
}
