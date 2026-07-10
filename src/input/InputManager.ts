import type { AbilityButtonInfo, IInput, InputState } from '../contracts';
import { clamp } from '../core/math';
import { KeyboardInput } from './keyboard';
import { TouchInput } from './touch';

/** Merges keyboard and touch input into the frozen per-step input contract. */
export class InputManager implements IInput {
  /** Current input snapshot. Refreshed once per fixed step. */
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    attackHeld: false,
    weaponPressed: false,
    weaponHeld: false,
    specialSlot: -1,
    specialSlotPressed: false,
    pausePressed: false,
    anyPressed: false,
  };

  /**
   * True when the browser reports a touch-capable device — or when `?touch` is
   * in the URL, which force-shows the mobile overlay on desktop for review
   * (keyboard still works; click the on-screen buttons with the mouse).
   */
  readonly isTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
    || (typeof location !== 'undefined' && location.search.includes('touch'));

  private readonly keyboard = new KeyboardInput();
  private readonly touch: TouchInput;
  private prevJumpHeld = false;
  private prevAttackHeld = false;
  private prevWeaponHeld = false;
  private prevPauseHeld = false;
  private prevSpecialSlot = -1;

  /** Finds `#touch` and creates the hidden touch overlay. */
  constructor() {
    const touchRoot = typeof document === 'undefined' ? null : document.getElementById('touch');
    this.touch = new TouchInput(touchRoot);
    this.touch.setVisible(false);
  }

  /** Refreshes axes and edge-triggered buttons for one fixed simulation step. */
  update(): void {
    const jumpHeld = this.keyboard.jumpHeld || this.touch.jumpHeld;
    const attackHeld = this.keyboard.attackHeld || this.touch.attackHeld;
    const weaponHeld = this.keyboard.weaponHeld || this.touch.weaponHeld;
    const pauseHeld = this.keyboard.pauseHeld || this.touch.pauseHeld;
    const jumpPressed = jumpHeld && !this.prevJumpHeld;
    const attackPressed = attackHeld && !this.prevAttackHeld;
    const weaponPressed = weaponHeld && !this.prevWeaponHeld;
    const pausePressed = pauseHeld && !this.prevPauseHeld;
    const keyboardInteracted = this.keyboard.consumeInteraction();
    const touchInteracted = this.touch.consumeInteraction();
    // Explicit ability slot comes from the mobile ability buttons; keyboard has
    // no explicit slot (it uses weapon+direction), so it contributes -1.
    const specialSlot = this.touch.specialSlot;
    const specialSlotPressed = specialSlot >= 0 && specialSlot !== this.prevSpecialSlot;

    this.state.moveX = clamp(this.keyboard.moveX + this.touch.moveX, -1, 1);
    this.state.moveY = clamp(this.keyboard.moveY + this.touch.moveY, -1, 1);
    this.state.jumpPressed = jumpPressed;
    this.state.jumpHeld = jumpHeld;
    this.state.attackPressed = attackPressed;
    this.state.attackHeld = attackHeld;
    this.state.weaponPressed = weaponPressed;
    this.state.weaponHeld = weaponHeld;
    this.state.specialSlot = specialSlot;
    this.state.specialSlotPressed = specialSlotPressed;
    this.state.pausePressed = pausePressed;
    this.state.anyPressed = jumpPressed
      || attackPressed
      || weaponPressed
      || specialSlotPressed
      || pausePressed
      || keyboardInteracted
      || touchInteracted;

    this.prevJumpHeld = jumpHeld;
    this.prevAttackHeld = attackHeld;
    this.prevWeaponHeld = weaponHeld;
    this.prevPauseHeld = pauseHeld;
    this.prevSpecialSlot = specialSlot;
  }

  /** Shows gameplay touch controls only on touch-capable devices. */
  setTouchControlsVisible(visible: boolean): void {
    this.touch.setVisible(this.isTouch && visible);
  }

  /** Updates the weapon-button cooldown ring fill. */
  setWeaponCooldown(frac: number): void {
    this.touch.setWeaponCooldown(frac);
  }

  setAbilityButtons(buttons: readonly AbilityButtonInfo[] | null, tint: number): void {
    this.touch.setAbilityButtons(buttons, tint);
  }

  setAbilityCooldowns(fracs: readonly number[]): void {
    this.touch.setAbilityCooldowns(fracs);
  }
}
