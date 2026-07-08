/** Tracks keyboard state from `event.code` for gameplay input. */
export class KeyboardInput {
  /** True while either left key is held. */
  leftHeld = false;
  /** True while either right key is held. */
  rightHeld = false;
  /** True while either up key is held. */
  upHeld = false;
  /** True while either down key is held. */
  downHeld = false;
  /** True while any jump key is held. */
  jumpHeld = false;
  /** True while any attack key is held. */
  attackHeld = false;
  /** True while any weapon key is held. */
  weaponHeld = false;
  /** True while any pause key is held. */
  pauseHeld = false;
  /** Horizontal movement axis, -1..1. */
  moveX = 0;
  /** Vertical movement axis, -1..1, up is positive. */
  moveY = 0;

  private readonly heldCodes = new Set<string>();
  private readonly target: Window | null;
  private interactionQueued = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!isGameCode(event.code)) return;
    event.preventDefault();
    this.heldCodes.add(event.code);
    this.interactionQueued = true;
    this.refresh();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!isGameCode(event.code)) return;
    event.preventDefault();
    this.heldCodes.delete(event.code);
    this.refresh();
  };

  /** Registers global key listeners. */
  constructor(target: Window | null = typeof window === 'undefined' ? null : window) {
    this.target = target;
    if (this.target) {
      this.target.addEventListener('keydown', this.onKeyDown);
      this.target.addEventListener('keyup', this.onKeyUp);
    }
  }

  /** Returns and clears whether a gameplay key went down since the last step. */
  consumeInteraction(): boolean {
    const interacted = this.interactionQueued;
    this.interactionQueued = false;
    return interacted;
  }

  /** Unregisters global key listeners. */
  destroy(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
  }

  private refresh(): void {
    this.leftHeld = this.heldCodes.has('KeyA') || this.heldCodes.has('ArrowLeft');
    this.rightHeld = this.heldCodes.has('KeyD') || this.heldCodes.has('ArrowRight');
    this.upHeld = this.heldCodes.has('KeyW') || this.heldCodes.has('ArrowUp');
    this.downHeld = this.heldCodes.has('KeyS') || this.heldCodes.has('ArrowDown');
    this.jumpHeld = this.heldCodes.has('Space') || this.upHeld;
    this.attackHeld = this.heldCodes.has('KeyJ') || this.heldCodes.has('KeyZ');
    this.weaponHeld = this.heldCodes.has('KeyK') || this.heldCodes.has('KeyX');
    this.pauseHeld = this.heldCodes.has('KeyP') || this.heldCodes.has('Escape');
    this.moveX = (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
    this.moveY = (this.upHeld ? 1 : 0) - (this.downHeld ? 1 : 0);
  }
}

function isGameCode(code: string): boolean {
  switch (code) {
    case 'KeyA':
    case 'ArrowLeft':
    case 'KeyD':
    case 'ArrowRight':
    case 'KeyW':
    case 'ArrowUp':
    case 'KeyS':
    case 'ArrowDown':
    case 'Space':
    case 'KeyJ':
    case 'KeyZ':
    case 'KeyK':
    case 'KeyX':
    case 'KeyP':
    case 'Escape':
      return true;
    default:
      return false;
  }
}
