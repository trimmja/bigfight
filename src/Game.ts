import * as THREE from 'three';
import { COLOR_BG, CAM_FOV } from './config';
import type { IAudio, IInput, IRenderer, InputState } from './contracts';
import { events } from './core/events';
import { startLoop } from './core/loop';
import { loadSave, writeSave } from './core/save';
import type { SaveData } from './data/types';
import { ScreenManager } from './screens/ScreenManager';
import { BootScreen } from './screens/BootScreen';

/**
 * Composition root. Owns the loop and the service singletons; screens reach
 * everything through the `game` instance passed to their hooks.
 *
 * NOTE (M1): renderer/input/audio are minimal placeholders, swapped for the
 * real implementations as M2a/M2b/M4c land. Their types are the frozen
 * contracts in contracts.ts.
 */
export class Game {
  readonly screens = new ScreenManager(this);
  readonly events = events;
  save: SaveData = loadSave();

  renderer: IRenderer;
  input: IInput;
  audio: IAudio;

  private stopLoop: (() => void) | null = null;

  constructor() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.renderer = new PlaceholderRenderer(canvas);
    this.input = new PlaceholderInput();
    this.audio = new PlaceholderAudio();
  }

  start(): void {
    window.addEventListener('resize', () => {
      this.renderer.onResize();
      this.screens.onResize();
    });
    window.visualViewport?.addEventListener('resize', () => this.renderer.onResize());

    this.screens.replace(new BootScreen());
    this.stopLoop = startLoop(
      (dt) => {
        this.input.update();
        this.screens.update(dt);
      },
      (alpha) => {
        this.screens.render(alpha);
        this.renderer.render(1 / 60);
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

// ---------------------------------------------------------------------------
// M1 placeholders (replaced by real implementations at integration time)
// ---------------------------------------------------------------------------

class PlaceholderRenderer implements IRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly tier = 'mobile' as const;
  private gl: THREE.WebGLRenderer;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.setSize(innerWidth, innerHeight);
    this.gl.setClearColor(COLOR_BG);
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(0, 2, 20);
  }

  setQuality(): void {}

  render(): void {
    this.gl.render(this.scene, this.camera);
  }

  onResize(): void {
    this.gl.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}

class PlaceholderInput implements IInput {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    weaponPressed: false,
    pausePressed: false,
    anyPressed: false,
  };
  readonly isTouch = navigator.maxTouchPoints > 1;
  update(): void {}
  setTouchControlsVisible(): void {}
  setWeaponCooldown(): void {}
}

class PlaceholderAudio implements IAudio {
  muted = false;
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}
