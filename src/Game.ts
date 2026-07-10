import { MAX_FRAME_DELTA } from './config';
import { AudioEngine } from './audio/AudioEngine';
import type { IAudio, IInput, IRenderer } from './contracts';
import { events } from './core/events';
import { startLoop } from './core/loop';
import { loadSave, writeSave } from './core/save';
import type { SaveData } from './data/types';
import { InputManager } from './input/InputManager';
import { Renderer } from './render/Renderer';
import { goReplayLab, goTitle } from './flow';
import { ScreenManager } from './screens/ScreenManager';

/**
 * Composition root. Owns the loop and the service singletons; screens reach
 * everything through the `game` instance passed to their hooks.
 * (audio stays a placeholder until M4c lands.)
 */
export class Game {
  readonly screens = new ScreenManager(this);
  readonly events = events;
  save: SaveData = loadSave();

  renderer: IRenderer;
  input: IInput;
  audio: IAudio;

  private stopLoop: (() => void) | null = null;
  private lastRenderMs = performance.now();

  constructor() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas, this.save.settings.quality);
    this.input = new InputManager();
    this.audio = new AudioEngine();
    this.audio.setMuted(this.save.settings.muted);
    // Debug handle for console inspection (harmless in production).
    (window as unknown as { bigfight: Game }).bigfight = this;
  }

  start(): void {
    window.addEventListener('resize', () => {
      this.renderer.onResize();
      this.screens.onResize();
    });
    window.visualViewport?.addEventListener('resize', () => this.renderer.onResize());

    if (location.search.includes('replaylab')) goReplayLab(this);
    else goTitle(this);
    this.stopLoop = startLoop(
      (dt) => {
        this.input.update();
        this.screens.update(dt);
      },
      (alpha) => {
        // Real frame delta (not the fixed step) — the renderer's auto-quality
        // heuristic averages this. Clamped so page-load / tab-switch stalls
        // don't read as catastrophic frames and trip a bogus downgrade.
        const now = performance.now();
        const frameDt = Math.min((now - this.lastRenderMs) / 1000, MAX_FRAME_DELTA);
        this.lastRenderMs = now;
        this.screens.render(alpha);
        this.renderer.render(frameDt);
      },
    );
  }

  stop(): void {
    this.stopLoop?.();
    this.stopLoop = null;
  }

  persist(): void {
    writeSave(this.save);
  }
}

