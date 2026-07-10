import type { IIntentSource, InputState } from '../contracts';

/**
 * Netplay input wire format: 3 bytes per player per frame.
 *   byte0  bit0 jumpHeld · bit1 attackHeld · bit2 weaponHeld
 *   byte1  moveX quantized to int8 (-127..127 → -1..1)
 *   byte2  moveY quantized to int8
 *
 * Only HELD states cross the wire — edge flags (jumpPressed etc.) are derived
 * per player from the held-state stream inside the session, so edge detection
 * is deterministic on every peer regardless of local sampling quirks.
 */

export const INPUT_BYTES = 3;

export function encodeInput(state: InputState, out: Uint8Array, offset: number): void {
  let buttons = 0;
  if (state.jumpHeld) buttons |= 1;
  if (state.attackHeld) buttons |= 2;
  if (state.weaponHeld) buttons |= 4;
  out[offset] = buttons;
  out[offset + 1] = quantizeAxis(state.moveX);
  out[offset + 2] = quantizeAxis(state.moveY);
}

function quantizeAxis(v: number): number {
  const q = Math.round(Math.max(-1, Math.min(1, v)) * 127);
  return q < 0 ? q + 256 : q; // two's complement byte
}

function dequantizeAxis(byte: number): number {
  const signed = byte > 127 ? byte - 256 : byte;
  return signed / 127;
}

/**
 * A mutable IIntentSource the rollback session drives: decode a wire frame
 * into it (edges derived from the PREVIOUS decoded frame) and the Player
 * reads it exactly like live device input.
 */
export class NetIntentSource implements IIntentSource {
  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    attackHeld: false,
    weaponPressed: false,
    weaponHeld: false,
    pausePressed: false,
    anyPressed: false,
  };

  private prevJumpHeld = false;
  private prevAttackHeld = false;
  private prevWeaponHeld = false;

  /** Apply one decoded wire frame (buttons byte + quantized axes). */
  applyFrame(bytes: Uint8Array, offset: number): void {
    const buttons = bytes[offset] ?? 0;
    const jumpHeld = (buttons & 1) !== 0;
    const attackHeld = (buttons & 2) !== 0;
    const weaponHeld = (buttons & 4) !== 0;
    const s = this.state;
    s.moveX = dequantizeAxis(bytes[offset + 1] ?? 128);
    s.moveY = dequantizeAxis(bytes[offset + 2] ?? 128);
    s.jumpPressed = jumpHeld && !this.prevJumpHeld;
    s.jumpHeld = jumpHeld;
    s.attackPressed = attackHeld && !this.prevAttackHeld;
    s.attackHeld = attackHeld;
    s.weaponPressed = weaponHeld && !this.prevWeaponHeld;
    s.weaponHeld = weaponHeld;
    s.pausePressed = false;
    s.anyPressed = s.jumpPressed || s.attackPressed || s.weaponPressed;
    this.prevJumpHeld = jumpHeld;
    this.prevAttackHeld = attackHeld;
    this.prevWeaponHeld = weaponHeld;
  }

  /**
   * Rollback: reset edge-derivation to the state just before frame `g` by
   * re-priming from frame g-1's buttons (or clear at match start).
   */
  primeFromButtons(buttons: number): void {
    this.prevJumpHeld = (buttons & 1) !== 0;
    this.prevAttackHeld = (buttons & 2) !== 0;
    this.prevWeaponHeld = (buttons & 4) !== 0;
  }

  reset(): void {
    this.prevJumpHeld = false;
    this.prevAttackHeld = false;
    this.prevWeaponHeld = false;
  }
}
