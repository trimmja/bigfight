/**
 * Service interfaces (frozen contract, M1). Concrete implementations:
 *   IRenderer → render/Renderer.ts   (M2b)
 *   IInput    → input/InputManager.ts (M2a)
 *   IAudio    → audio/AudioEngine.ts  (M4c)
 * Game.ts wires them together; screens/entities code against these types.
 */
import type * as THREE from 'three';
import type { SaveSettings } from './data/types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Snapshot of player intent for one fixed step. `*Pressed` flags are
 * edge-triggered (true only on the step the button went down); `*Held` are
 * level-triggered. InputManager.update() refreshes the snapshot once per step.
 */
export interface InputState {
  /** -1..1 horizontal stick/keys. */
  moveX: number;
  /** -1..1 vertical, up = +1 (used for DI and drop-through with -1). */
  moveY: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  attackPressed: boolean;
  weaponPressed: boolean;
  pausePressed: boolean;
  /** Any interaction this step (menus, audio unlock). */
  anyPressed: boolean;
}

export interface IInput {
  readonly state: InputState;
  /** Snapshot + edge detection; call exactly once per fixed step. */
  update(): void;
  /** Show/hide the touch overlay (gameplay vs menus). */
  setTouchControlsVisible(visible: boolean): void;
  /** True when running on a touch device. */
  readonly isTouch: boolean;
  /** Set the weapon-button cooldown ring fill, 0 (ready) – 1 (just used). */
  setWeaponCooldown(frac: number): void;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export type QualityTier = 'mobile' | 'high';

export interface IRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly tier: QualityTier;
  setQuality(q: SaveSettings['quality']): void;
  /** Renders the scene (through bloom on high tier); tracks auto-downgrade. */
  render(dt: number): void;
  onResize(): void;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface IAudio {
  /** Audio reacts to the event bus; this surface is just user settings. */
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}
