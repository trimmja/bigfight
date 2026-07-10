import type { AbilityButtonInfo } from '../contracts';
import { clamp } from '../core/math';

const STICK_RADIUS = 60;
const STICK_DEADZONE = 15;

/** Slot index → position within the diamond (up on top, down on bottom). */
const DIAMOND_POS = [
  'right:4px;top:52px;', // 0 neutral → right point
  'left:4px;top:52px;', //  1 side    → left point
  'left:52px;top:4px;', //  2 up      → top point
  'left:52px;bottom:4px;', // 3 down   → bottom point
];

/** DOM touch overlay: floating stick + JUMP/ATK + a directional ability diamond. */
export class TouchInput {
  /** True while the jump button is held. */
  jumpHeld = false;
  /** True while the attack button is held. */
  attackHeld = false;
  /** Unused now (specials go through the ability diamond) — kept for the merge. */
  weaponHeld = false;
  /** True while the pause button is held. */
  pauseHeld = false;
  /** Horizontal virtual-stick axis, -1..1. */
  moveX = 0;
  /** Vertical virtual-stick axis, -1..1, up is positive. */
  moveY = 0;

  private readonly root: HTMLElement | null;
  private readonly stickBase: HTMLDivElement | null = null;
  private readonly stickKnob: HTMLDivElement | null = null;
  private stickPointerId: number | null = null;
  private jumpPointerId: number | null = null;
  private attackPointerId: number | null = null;
  private pausePointerId: number | null = null;
  private stickBaseX = 0;
  private stickBaseY = 0;
  private interactionQueued = false;

  // Ability diamond (4 directional-special buttons).
  private readonly abilityWrap: HTMLDivElement | null = null;
  private readonly abilityButtons: HTMLButtonElement[] = [];
  private readonly abilityIcons: HTMLSpanElement[] = [];
  private readonly abilityRings: HTMLDivElement[] = [];
  private readonly abilityPointerIds: (number | null)[] = [null, null, null, null];
  private readonly abilityHoldable: boolean[] = [false, false, false, false];
  /** Held ability slots in press order — the last one wins (multi-touch safe). */
  private readonly heldStack: number[] = [];
  private abilitiesConfigured = false;

  /** The active ability slot this frame (most-recently-pressed held), or -1. */
  get specialSlot(): number {
    return this.heldStack.length > 0 ? this.heldStack[this.heldStack.length - 1]! : -1;
  }

  private readonly onRootPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.interactionQueued = true;
    if (event.clientX > window.innerWidth * 0.5) return;

    // A fresh finger on the stick zone ALWAYS takes over the stick. iOS can
    // drop pointerup during rapid multi-touch, which would otherwise leave the
    // stick owned by a dead pointer forever.
    if (this.stickPointerId !== null) this.releasePointer(this.stickPointerId);
    this.stickPointerId = event.pointerId;
    this.stickBaseX = event.clientX;
    this.stickBaseY = event.clientY;
    this.root?.setPointerCapture(event.pointerId);
    this.showStick(true);
    this.positionStick(this.stickBaseX, this.stickBaseY, this.stickBaseX, this.stickBaseY);
    this.updateStick(event.clientX, event.clientY);
  };

  private readonly onRootPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointerId) return;
    event.preventDefault();
    this.updateStick(event.clientX, event.clientY);
  };

  private readonly onRootPointerUp = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);
  };

  /** Builds controls inside the supplied `#touch` root. */
  constructor(root: HTMLElement | null) {
    this.root = root;
    if (!this.root) return;

    this.root.textContent = '';
    this.root.style.display = 'none';
    this.root.style.pointerEvents = 'auto';

    const base = document.createElement('div');
    base.style.cssText = 'position:absolute;width:112px;height:112px;border-radius:999px;'
      + 'border:2px solid var(--neon-cyan);background:rgba(0,234,255,0.10);'
      + 'box-shadow:0 0 18px rgba(0,234,255,0.45),inset 0 0 18px rgba(0,234,255,0.12);'
      + 'display:none;transform:translate(-50%,-50%);pointer-events:none;';
    this.root.appendChild(base);
    this.stickBase = base;

    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;width:56px;height:56px;border-radius:999px;'
      + 'border:2px solid var(--neon-cyan);background:rgba(5,5,12,0.58);'
      + 'box-shadow:0 0 20px rgba(0,234,255,0.62),inset 0 0 12px rgba(0,234,255,0.18);'
      + 'display:none;transform:translate(-50%,-50%);pointer-events:none;';
    this.root.appendChild(knob);
    this.stickKnob = knob;

    // Primary actions: JUMP in the corner (thumb home), ATK just up-left of it.
    const jump = this.createButton('JUMP', 'var(--neon-cyan)', 78);
    jump.style.right = 'calc(var(--safe-r) + 22px)';
    jump.style.bottom = 'calc(var(--safe-b) + 22px)';
    this.bindButton(jump, 'jump');

    const attack = this.createButton('ATK', 'var(--neon-pink)', 68);
    attack.style.right = 'calc(var(--safe-r) + 108px)';
    attack.style.bottom = 'calc(var(--safe-b) + 30px)';
    this.bindButton(attack, 'attack');

    // Ability diamond: 4 signature-special buttons, positioned so each button's
    // spot mirrors its direction (up on top, down on bottom, side/neutral on the
    // sides). Hidden until a character configures it via setAbilityButtons().
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;right:calc(var(--safe-r) + 14px);'
      + 'bottom:calc(var(--safe-b) + 118px);width:156px;height:156px;pointer-events:none;display:none;';
    this.root.appendChild(wrap);
    this.abilityWrap = wrap;
    for (let slot = 0; slot < 4; slot += 1) this.createAbilityButton(slot);

    const pause = this.createButton('⏸', 'var(--neon-violet)', 44);
    pause.style.right = 'calc(var(--safe-r) + 16px)';
    pause.style.top = 'calc(var(--safe-t) + 14px)';
    pause.style.fontSize = '18px';
    pause.style.minWidth = '44px';
    pause.style.minHeight = '44px';
    this.bindButton(pause, 'pause');

    this.root.addEventListener('pointerdown', this.onRootPointerDown);
    this.root.addEventListener('pointermove', this.onRootPointerMove);
    this.root.addEventListener('pointerup', this.onRootPointerUp);
    this.root.addEventListener('pointercancel', this.onRootPointerUp);
    // Safety nets: ups/cancels that escape the overlay (iOS gesture zones,
    // rapid multi-touch) still release whatever they owned; losing the page
    // releases everything so nothing stays held.
    window.addEventListener('pointerup', this.onRootPointerUp, { capture: true });
    window.addEventListener('pointercancel', this.onRootPointerUp, { capture: true });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.releaseAll();
    });
    window.addEventListener('pagehide', () => this.releaseAll());

    // Ghost-stick reconciliation: iOS can end a touch WITHOUT any up/cancel
    // event (system gestures, palm edges), leaving the stick "held" at its
    // last vector — the character runs away forever. On every real touch
    // interaction, if NO finger is anywhere near the stick anchor, the stick
    // owner is a ghost → release it.
    const reconcileStick = (event: TouchEvent): void => {
      if (this.stickPointerId === null) return;
      for (let i = 0; i < event.touches.length; i += 1) {
        const touch = event.touches.item(i);
        if (!touch) continue;
        const dx = touch.clientX - this.stickBaseX;
        const dy = touch.clientY - this.stickBaseY;
        if (dx * dx + dy * dy < 220 * 220) return; // plausibly still the stick finger
      }
      this.releasePointer(this.stickPointerId);
    };
    window.addEventListener('touchstart', reconcileStick, { capture: true, passive: true });
    window.addEventListener('touchend', reconcileStick, { capture: true, passive: true });
    window.addEventListener('touchcancel', reconcileStick, { capture: true, passive: true });
  }

  /** Shows or hides the overlay root. */
  setVisible(visible: boolean): void {
    if (!this.root) return;
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.releaseAll();
  }

  /** No-op retained for the IInput contract — cooldowns feed via setAbilityCooldowns. */
  setWeaponCooldown(_frac: number): void {
    /* the neutral ability button's ring shows the weapon/neutral cooldown */
  }

  /** Configure the 4 ability buttons for the local character (null = hide). */
  setAbilityButtons(buttons: readonly AbilityButtonInfo[] | null, tint: number): void {
    if (!this.abilityWrap) return;
    if (!buttons || buttons.length < 4) {
      this.abilityWrap.style.display = 'none';
      this.abilitiesConfigured = false;
      this.clearHeldAbilities();
      return;
    }
    const col = `#${(tint >>> 0).toString(16).padStart(6, '0')}`;
    for (let slot = 0; slot < 4; slot += 1) {
      const info = buttons[slot]!;
      const btn = this.abilityButtons[slot]!;
      const ring = this.abilityRings[slot]!;
      this.abilityHoldable[slot] = info.holdable;
      const iconEl = this.abilityIcons[slot];
      if (iconEl) iconEl.textContent = info.icon;
      btn.style.borderColor = col;
      btn.style.boxShadow = `0 2px 12px rgba(0,0,0,0.4), 0 0 12px color-mix(in srgb, ${col} 45%, transparent)`;
      ring.style.setProperty('--cd-color', col);
      ring.style.setProperty('--cd', '0');
    }
    this.abilityWrap.style.display = 'block';
    this.abilitiesConfigured = true;
  }

  /** Per-frame cooldown-ring fill (0 ready … 1 just used) for the 4 buttons. */
  setAbilityCooldowns(fracs: readonly number[]): void {
    if (!this.abilitiesConfigured) return;
    for (let slot = 0; slot < 4; slot += 1) {
      const f = clamp(fracs[slot] ?? 0, 0, 1);
      const ring = this.abilityRings[slot];
      const btn = this.abilityButtons[slot];
      if (!ring || !btn) continue;
      ring.style.setProperty('--cd', String(f));
      // The clock-wipe carries the cooldown; a whisper of dim reinforces it.
      if (this.abilityPointerIds[slot] === null) btn.style.opacity = f > 0.02 ? '0.82' : '1';
    }
  }

  /** Returns and clears whether any pointer went down since the last step. */
  consumeInteraction(): boolean {
    const interacted = this.interactionQueued;
    this.interactionQueued = false;
    return interacted;
  }

  private createButton(label: string, color: string, size: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'position:absolute;display:flex;align-items:center;justify-content:center;'
      + `width:${size}px;height:${size}px;min-width:56px;min-height:56px;border-radius:999px;`
      + `border:2px solid ${color};background:rgba(5,5,12,0.58);color:${color};`
      + `box-shadow:0 0 18px color-mix(in srgb, ${color} 58%, transparent),`
      + `inset 0 0 12px color-mix(in srgb, ${color} 18%, transparent);`
      + 'font:800 14px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
      + 'letter-spacing:0;text-align:center;padding:0;touch-action:none;user-select:none;'
      + '-webkit-user-select:none;pointer-events:auto;transition:transform 0.07s ease,filter 0.07s ease;';
    this.root?.appendChild(button);
    return button;
  }

  /** One ability button (icon + conic cooldown ring) placed in the diamond. */
  private createAbilityButton(slot: number): void {
    if (!this.abilityWrap) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'position:absolute;width:52px;height:52px;border-radius:999px;box-sizing:border-box;'
      + 'display:flex;align-items:center;justify-content:center;overflow:hidden;'
      + 'border:2px solid rgba(255,255,255,0.5);background:rgba(8,10,20,0.62);'
      + 'padding:0;touch-action:none;user-select:none;-webkit-user-select:none;'
      + 'pointer-events:auto;transition:transform 0.07s ease,filter 0.07s ease,opacity 0.12s ease;'
      + 'box-shadow:0 2px 12px rgba(0,0,0,0.4);' + DIAMOND_POS[slot];

    // Icon lives in its own span so the cooldown ring (a separate child) is not
    // wiped when the icon text is set.
    const icon = document.createElement('span');
    icon.style.cssText = 'position:relative;z-index:1;font-size:26px;line-height:1;';
    btn.appendChild(icon);

    // Cooldown "clock wipe": a dark pie (above the icon) covering the remaining-
    // cooldown slice, unwinding clockwise as the ability recovers.
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;inset:0;border-radius:999px;pointer-events:none;z-index:2;'
      + 'background:conic-gradient(rgba(4,6,16,0.66) calc(var(--cd,0) * 1turn), transparent 0);';
    btn.appendChild(ring);

    this.abilityWrap.appendChild(btn);
    this.abilityButtons[slot] = btn;
    this.abilityIcons[slot] = icon;
    this.abilityRings[slot] = ring;
    this.bindAbilityButton(btn, slot);
  }

  private bindAbilityButton(button: HTMLButtonElement, slot: number): void {
    button.addEventListener('pointerdown', (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.interactionQueued = true;
      button.setPointerCapture(event.pointerId);
      this.abilityPointerIds[slot] = event.pointerId;
      this.pushHeldSlot(slot);
      button.style.transform = 'scale(0.9)';
      button.style.filter = 'brightness(1.35)';
      button.style.opacity = '1';
    });
    const release = (event: PointerEvent): void => {
      if (this.abilityPointerIds[slot] !== event.pointerId) return;
      this.releaseAbility(slot);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
  }

  private releaseAbility(slot: number): void {
    this.abilityPointerIds[slot] = null;
    this.removeHeldSlot(slot);
    const btn = this.abilityButtons[slot];
    if (btn) {
      btn.style.transform = 'scale(1)';
      btn.style.filter = 'none';
    }
  }

  private pushHeldSlot(slot: number): void {
    this.removeHeldSlot(slot);
    this.heldStack.push(slot);
  }

  private removeHeldSlot(slot: number): void {
    const idx = this.heldStack.lastIndexOf(slot);
    if (idx >= 0) this.heldStack.splice(idx, 1);
  }

  private clearHeldAbilities(): void {
    this.heldStack.length = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      this.abilityPointerIds[slot] = null;
      const btn = this.abilityButtons[slot];
      if (btn) {
        btn.style.transform = 'scale(1)';
        btn.style.filter = 'none';
      }
    }
  }

  private bindButton(button: HTMLButtonElement, kind: 'jump' | 'attack' | 'pause'): void {
    button.addEventListener('pointerdown', (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.interactionQueued = true;
      button.setPointerCapture(event.pointerId);
      this.setButtonPointer(kind, event.pointerId);
      this.setButtonHeld(kind, true);
      button.style.transform = 'scale(0.92)';
    });
    const release = (event: PointerEvent): void => {
      this.releaseButtonPointer(kind, event.pointerId);
      button.style.transform = 'scale(1)';
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
  }

  private setButtonPointer(kind: 'jump' | 'attack' | 'pause', pointerId: number): void {
    switch (kind) {
      case 'jump':
        this.jumpPointerId = pointerId;
        return;
      case 'attack':
        this.attackPointerId = pointerId;
        return;
      case 'pause':
        this.pausePointerId = pointerId;
        return;
    }
  }

  private setButtonHeld(kind: 'jump' | 'attack' | 'pause', held: boolean): void {
    switch (kind) {
      case 'jump':
        this.jumpHeld = held;
        return;
      case 'attack':
        this.attackHeld = held;
        return;
      case 'pause':
        this.pauseHeld = held;
        return;
    }
  }

  private releaseButtonPointer(kind: 'jump' | 'attack' | 'pause', pointerId: number): void {
    switch (kind) {
      case 'jump':
        if (this.jumpPointerId !== pointerId) return;
        this.jumpPointerId = null;
        break;
      case 'attack':
        if (this.attackPointerId !== pointerId) return;
        this.attackPointerId = null;
        break;
      case 'pause':
        if (this.pausePointerId !== pointerId) return;
        this.pausePointerId = null;
        break;
    }
    this.setButtonHeld(kind, false);
  }

  private updateStick(clientX: number, clientY: number): void {
    const rawDx = clientX - this.stickBaseX;
    const rawDy = clientY - this.stickBaseY;
    const rawLen = Math.hypot(rawDx, rawDy);
    const clampedLen = Math.min(rawLen, STICK_RADIUS);
    const scale = rawLen > 0 ? clampedLen / rawLen : 0;
    const dx = rawDx * scale;
    const dy = rawDy * scale;

    this.positionStick(this.stickBaseX, this.stickBaseY, this.stickBaseX + dx, this.stickBaseY + dy);

    if (clampedLen <= STICK_DEADZONE || rawLen === 0) {
      this.moveX = 0;
      this.moveY = 0;
      return;
    }

    const axis = (clampedLen - STICK_DEADZONE) / (STICK_RADIUS - STICK_DEADZONE);
    this.moveX = (dx / clampedLen) * axis;
    this.moveY = (-dy / clampedLen) * axis;
  }

  private positionStick(baseX: number, baseY: number, knobX: number, knobY: number): void {
    if (this.stickBase) {
      this.stickBase.style.left = `${baseX}px`;
      this.stickBase.style.top = `${baseY}px`;
    }
    if (this.stickKnob) {
      this.stickKnob.style.left = `${knobX}px`;
      this.stickKnob.style.top = `${knobY}px`;
    }
  }

  private releasePointer(pointerId: number): void {
    if (pointerId === this.stickPointerId) {
      this.stickPointerId = null;
      this.moveX = 0;
      this.moveY = 0;
      this.showStick(false);
    }

    this.releaseButtonPointer('jump', pointerId);
    this.releaseButtonPointer('attack', pointerId);
    this.releaseButtonPointer('pause', pointerId);
    for (let slot = 0; slot < 4; slot += 1) {
      if (this.abilityPointerIds[slot] === pointerId) this.releaseAbility(slot);
    }
  }

  private releaseAll(): void {
    this.stickPointerId = null;
    this.jumpPointerId = null;
    this.attackPointerId = null;
    this.pausePointerId = null;
    this.jumpHeld = false;
    this.attackHeld = false;
    this.weaponHeld = false;
    this.pauseHeld = false;
    this.moveX = 0;
    this.moveY = 0;
    this.clearHeldAbilities();
    this.showStick(false);
  }

  private showStick(visible: boolean): void {
    if (this.stickBase) this.stickBase.style.display = visible ? 'block' : 'none';
    if (this.stickKnob) this.stickKnob.style.display = visible ? 'block' : 'none';
  }
}
