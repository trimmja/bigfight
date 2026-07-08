import { clamp } from '../core/math';

const STICK_RADIUS = 60;
const STICK_DEADZONE = 15;

/** DOM touch overlay with a floating stick and neon action buttons. */
export class TouchInput {
  /** True while the jump button is held. */
  jumpHeld = false;
  /** True while the attack button is held. */
  attackHeld = false;
  /** True while the weapon button is held. */
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
  private readonly weaponButton: HTMLButtonElement | null = null;
  private stickPointerId: number | null = null;
  private jumpPointerId: number | null = null;
  private attackPointerId: number | null = null;
  private weaponPointerId: number | null = null;
  private pausePointerId: number | null = null;
  private stickBaseX = 0;
  private stickBaseY = 0;
  private interactionQueued = false;

  private readonly onRootPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.interactionQueued = true;
    if (this.stickPointerId !== null || event.clientX > window.innerWidth * 0.55) return;

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

    const jump = this.createButton('JUMP', 'var(--neon-cyan)', 76);
    jump.style.right = 'calc(var(--safe-r) + 22px)';
    jump.style.bottom = 'calc(var(--safe-b) + 22px)';
    this.bindButton(jump, 'jump');

    const attack = this.createButton('ATK', 'var(--neon-pink)', 64);
    attack.style.right = 'calc(var(--safe-r) + 112px)';
    attack.style.bottom = 'calc(var(--safe-b) + 28px)';
    this.bindButton(attack, 'attack');

    const weapon = this.createButton('PWR', 'var(--neon-yellow)', 56);
    weapon.style.right = 'calc(var(--safe-r) + 32px)';
    weapon.style.bottom = 'calc(var(--safe-b) + 112px)';
    weapon.style.setProperty('--cooldown-frac', '0');
    weapon.style.background = 'conic-gradient(var(--neon-yellow) calc(var(--cooldown-frac, 0) * 1turn),'
      + 'rgba(255,233,74,0.10) 0),rgba(5,5,12,0.58)';
    this.bindButton(weapon, 'weapon');
    this.weaponButton = weapon;

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
  }

  /** Shows or hides the overlay root. */
  setVisible(visible: boolean): void {
    if (!this.root) return;
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.releaseAll();
  }

  /** Sets the weapon cooldown ring fill, where 0 is ready and 1 is just used. */
  setWeaponCooldown(frac: number): void {
    this.weaponButton?.style.setProperty('--cooldown-frac', String(clamp(frac, 0, 1)));
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
      + 'font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
      + 'letter-spacing:0;text-align:center;padding:0;touch-action:none;user-select:none;'
      + '-webkit-user-select:none;pointer-events:auto;';
    this.root?.appendChild(button);
    return button;
  }

  private bindButton(button: HTMLButtonElement, kind: 'jump' | 'attack' | 'weapon' | 'pause'): void {
    button.addEventListener('pointerdown', (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      this.interactionQueued = true;
      button.setPointerCapture(event.pointerId);
      this.setButtonPointer(kind, event.pointerId);
      this.setButtonHeld(kind, true);
    });
    button.addEventListener('pointerup', (event: PointerEvent): void => {
      this.releaseButtonPointer(kind, event.pointerId);
    });
    button.addEventListener('pointercancel', (event: PointerEvent): void => {
      this.releaseButtonPointer(kind, event.pointerId);
    });
  }

  private setButtonPointer(kind: 'jump' | 'attack' | 'weapon' | 'pause', pointerId: number): void {
    switch (kind) {
      case 'jump':
        this.jumpPointerId = pointerId;
        return;
      case 'attack':
        this.attackPointerId = pointerId;
        return;
      case 'weapon':
        this.weaponPointerId = pointerId;
        return;
      case 'pause':
        this.pausePointerId = pointerId;
        return;
    }
  }

  private setButtonHeld(kind: 'jump' | 'attack' | 'weapon' | 'pause', held: boolean): void {
    switch (kind) {
      case 'jump':
        this.jumpHeld = held;
        return;
      case 'attack':
        this.attackHeld = held;
        return;
      case 'weapon':
        this.weaponHeld = held;
        return;
      case 'pause':
        this.pauseHeld = held;
        return;
    }
  }

  private releaseButtonPointer(kind: 'jump' | 'attack' | 'weapon' | 'pause', pointerId: number): void {
    switch (kind) {
      case 'jump':
        if (this.jumpPointerId !== pointerId) return;
        this.jumpPointerId = null;
        break;
      case 'attack':
        if (this.attackPointerId !== pointerId) return;
        this.attackPointerId = null;
        break;
      case 'weapon':
        if (this.weaponPointerId !== pointerId) return;
        this.weaponPointerId = null;
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
    this.releaseButtonPointer('weapon', pointerId);
    this.releaseButtonPointer('pause', pointerId);
  }

  private releaseAll(): void {
    this.stickPointerId = null;
    this.jumpPointerId = null;
    this.attackPointerId = null;
    this.weaponPointerId = null;
    this.pausePointerId = null;
    this.jumpHeld = false;
    this.attackHeld = false;
    this.weaponHeld = false;
    this.pauseHeld = false;
    this.moveX = 0;
    this.moveY = 0;
    this.showStick(false);
  }

  private showStick(visible: boolean): void {
    if (this.stickBase) this.stickBase.style.display = visible ? 'block' : 'none';
    if (this.stickKnob) this.stickKnob.style.display = visible ? 'block' : 'none';
  }
}
