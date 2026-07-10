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
  /** Level-triggered twin of attackPressed — netcode transmits HELD states. */
  attackHeld: boolean;
  weaponPressed: boolean;
  weaponHeld: boolean;
  /**
   * Explicit signature-ability slot requested this step (mobile ability
   * buttons): -1 = none (keyboard falls back to weapon+direction), 0 = neutral,
   * 1 = side, 2 = up, 3 = down. Held for holdable abilities (jetpack).
   */
  specialSlot: number;
  /** Edge: specialSlot became active / changed this step (fire once). */
  specialSlotPressed: boolean;
  pausePressed: boolean;
  /** Any interaction this step (menus, audio unlock). */
  anyPressed: boolean;
}

/** Per-button config for the mobile ability buttons (one per directional slot). */
export interface AbilityButtonInfo {
  /** Emoji glyph shown on the button. */
  icon: string;
  /** Tiny slot hint, e.g. 'B' / '→' / '↑' / '↓'. */
  dir: string;
  /** Held-to-use (jetpack) vs tap-to-fire — affects the ring meaning. */
  holdable: boolean;
}

/**
 * Anything that can drive a Fighter's per-step intents: the live InputManager,
 * a replay playback source, a scripted test bot, or (netplay) a remote peer's
 * input stream. Player consumes THIS, never devices directly.
 */
export interface IIntentSource {
  readonly state: InputState;
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
  /**
   * Configure the mobile ability buttons for the local character (one per
   * directional slot: neutral/side/up/down). Pass null to hide them. `tint` is
   * the character's accent color (hex) for a uniform per-fighter look.
   */
  setAbilityButtons(buttons: readonly AbilityButtonInfo[] | null, tint: number): void;
  /** Per-frame cooldown-ring fill for the 4 ability buttons, 0 (ready) – 1. */
  setAbilityCooldowns(fracs: readonly number[]): void;
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
