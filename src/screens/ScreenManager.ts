import type { Game } from '../Game';
import type { Screen } from './Screen';

/**
 * Stack-based screen FSM. Only the top screen updates; overlays (pause) let
 * the screen below keep rendering visually via its render() hook.
 */
export class ScreenManager {
  private stack: Screen[] = [];

  constructor(private game: Game) {}

  get top(): Screen | undefined {
    return this.stack[this.stack.length - 1];
  }

  push(screen: Screen): void {
    this.stack.push(screen);
    screen.enter(this.game);
  }

  pop(): void {
    const screen = this.stack.pop();
    screen?.exit(this.game);
  }

  /** Exits the whole stack and enters `screen` as the only screen. */
  replace(screen: Screen): void {
    while (this.stack.length > 0) this.pop();
    this.push(screen);
  }

  update(dt: number): void {
    this.top?.update(this.game, dt);
  }

  render(alpha: number): void {
    const top = this.top;
    if (!top) return;
    if (top.isOverlay) {
      const below = this.stack[this.stack.length - 2];
      below?.render?.(this.game, alpha);
    }
    top.render?.(this.game, alpha);
  }

  onResize(): void {
    for (const screen of this.stack) screen.onResize?.(this.game);
  }
}
