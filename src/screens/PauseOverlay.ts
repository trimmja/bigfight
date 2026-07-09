import { events } from '../core/events';
import type { Game } from '../Game';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Pause overlay (pushed on top of GameplayScreen). Resume / restart / quit +
 * mute toggle. The gameplay screen below keeps rendering, frozen.
 */
export class PauseOverlay implements Screen {
  readonly isOverlay = true;
  private root: HTMLElement | null = null;

  constructor(
    private readonly callbacks: {
      onRestart: () => void;
      onQuit: () => void;
    },
  ) {}

  enter(game: Game): void {
    this.root = uiRoot('bf-modal-backdrop');
    const panel = el('div', 'bf-panel', this.root);
    el('h1', 'bf-title', panel).textContent = 'PAUSED';

    const col = el('div', 'bf-button-col', panel);
    button('RESUME', () => game.screens.pop(), 'bf-button bf-button-green', col);
    button('RESTART LEVEL', () => this.callbacks.onRestart(), 'bf-button', col);
    button(
      game.audio.muted ? 'SOUND: OFF' : 'SOUND: ON',
      () => {
        const muted = !game.audio.muted;
        game.audio.setMuted(muted);
        game.save.settings.muted = muted;
        game.persist();
        const btn = col.children[2] as HTMLButtonElement;
        btn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
      },
      'bf-button',
      col,
    );
    button('QUIT TO MAP', () => this.callbacks.onQuit(), 'bf-button bf-button-red', col);
    events.emit('ui', { kind: 'confirm' });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(game: Game): void {
    if (game.input.state.pausePressed) game.screens.pop();
  }
}
