import type { Game } from '../Game';
import { resetSave } from '../core/save';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/** Settings: sound, quality, screen shake, reset progress (with confirm). */
export class SettingsScreen implements Screen {
  private root: HTMLElement | null = null;
  private confirmingReset = false;

  constructor(private readonly onBack: () => void) {}

  enter(game: Game): void {
    this.root = uiRoot('bf-modal-backdrop');
    const panel = el('div', 'bf-panel', this.root);
    el('h1', 'bf-title', panel).textContent = 'SETTINGS';
    const col = el('div', 'bf-button-col', panel);

    const soundBtn = button(
      game.audio.muted ? 'SOUND: OFF' : 'SOUND: ON',
      () => {
        const muted = !game.audio.muted;
        game.audio.setMuted(muted);
        game.save.settings.muted = muted;
        game.persist();
        soundBtn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
      },
      'bf-button',
      col,
    );

    const qualities: ('auto' | 'mobile' | 'high')[] = ['auto', 'mobile', 'high'];
    const qualityBtn = button(
      `GRAPHICS: ${game.save.settings.quality.toUpperCase()}`,
      () => {
        const i = qualities.indexOf(game.save.settings.quality);
        const next = qualities[(i + 1) % qualities.length]!;
        game.save.settings.quality = next;
        game.renderer.setQuality(next);
        game.persist();
        qualityBtn.textContent = `GRAPHICS: ${next.toUpperCase()}`;
      },
      'bf-button',
      col,
    );

    const shakeBtn = button(
      game.save.settings.shake ? 'SCREEN SHAKE: ON' : 'SCREEN SHAKE: OFF',
      () => {
        game.save.settings.shake = !game.save.settings.shake;
        game.persist();
        shakeBtn.textContent = game.save.settings.shake ? 'SCREEN SHAKE: ON' : 'SCREEN SHAKE: OFF';
      },
      'bf-button',
      col,
    );

    const resetBtn = button(
      'RESET PROGRESS',
      () => {
        if (!this.confirmingReset) {
          this.confirmingReset = true;
          resetBtn.textContent = 'REALLY DELETE EVERYTHING?';
          resetBtn.classList.add('bf-button-red');
          return;
        }
        game.save = resetSave();
        this.onBack();
      },
      'bf-button',
      col,
    );

    button('DONE', () => this.onBack(), 'bf-button bf-button-green', col);
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
