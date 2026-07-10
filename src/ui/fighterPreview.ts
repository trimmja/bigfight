import * as THREE from 'three';
import type { CharacterDef } from '../data/types';
import { buildCharacterRig } from '../rigs/characterBuilders';
import type { Rig } from '../rigs/FighterRig';
import { poseAttack, poseFightStance } from '../rigs/poses';

/**
 * FighterTurntable — the live 3D character-select preview, extracted verbatim
 * from CharacterSelectScreen so the online select can reuse it: greeting
 * punch on every character change, fight-stance idle with gentle sway, and
 * drag-to-spin with momentum. The owner adds `group` to the scene, calls
 * `update(camera, dt)` every fixed step, and `dispose()`s on screen exit.
 */

export interface TurntablePlacement {
  /** Horizontal anchor as a fraction of the camera half-width at z=10. */
  xFrac: number;
  /** Vertical anchor as a fraction of the camera half-height at z=10. */
  yFrac: number;
  /** Rig scale (campaign preview uses 2.0). */
  scale: number;
}

/** Campaign character-select placement: middle of the right-hand zone. */
const DEFAULT_PLACEMENT: TurntablePlacement = { xFrac: 0.47, yFrac: 0.18, scale: 2.0 };

export class FighterTurntable {
  /** Wrapper group: carries position/scale/spin (rig root yaw = facing turns). */
  readonly group = new THREE.Group();

  private preview: Rig | null = null;
  private t = 0;
  private punchT = -1;
  /** Drag-to-spin state: user yaw persists, idle sway rides on top. */
  private userYaw = -Math.PI / 2;
  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private spinVelocity = 0;
  private detachDrag: (() => void) | null = null;

  constructor(private readonly placement: TurntablePlacement = DEFAULT_PLACEMENT) {}

  /** Swap in a fighter: greeting punch, face the camera, kill spin momentum. */
  setCharacter(def: CharacterDef): void {
    if (this.preview) {
      this.group.remove(this.preview.root);
      this.preview.dispose();
    }
    this.preview = buildCharacterRig(def);
    // Rig at the group origin; the group carries position/scale/spin —
    // placement is aspect-aware and happens every frame in update().
    this.preview.setShadow(null, 0);
    this.group.add(this.preview.root);
    this.punchT = 0; // greet with a punch
    this.userYaw = -Math.PI / 2; // new fighter faces the camera
    this.spinVelocity = 0;
  }

  /** Drag anywhere on `root` that isn't a button to spin the fighter around. */
  attachDrag(root: HTMLElement): void {
    this.detachDrag?.();
    const onDown = (e: PointerEvent): void => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.dragPointerId = e.pointerId;
      this.lastDragX = e.clientX;
      this.spinVelocity = 0;
    };
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== this.dragPointerId) return;
      const dx = e.clientX - this.lastDragX;
      this.lastDragX = e.clientX;
      this.userYaw += dx * 0.013;
      this.spinVelocity = dx * 0.013 * 60;
    };
    const endDrag = (e: PointerEvent): void => {
      if (e.pointerId === this.dragPointerId) this.dragPointerId = null;
    };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    this.detachDrag = () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', endDrag);
      root.removeEventListener('pointercancel', endDrag);
    };
  }

  update(cam: THREE.PerspectiveCamera, dt: number): void {
    this.t += dt;
    if (!this.preview) return;

    // Anchor the fighter regardless of aspect ratio (phones squished him
    // small and high) — fractions of the visible half-extent at z=10.
    const dist = cam.position.z - 10;
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * dist;
    const halfW = halfH * cam.aspect;
    const { xFrac, yFrac, scale } = this.placement;
    this.group.scale.setScalar(scale);
    this.group.position.set(halfW * xFrac, halfH * yFrac - 1.05 * scale, 10);

    const blend = 1 - Math.exp(-14 * dt);
    if (this.punchT >= 0) {
      this.punchT += dt * 2.4;
      if (this.punchT >= 1) this.punchT = -1;
      else this.preview.setPose(poseAttack('finisher', this.punchT), blend);
    }
    if (this.punchT < 0) this.preview.setPose(poseFightStance(this.t), blend);
    // Drag-to-spin with momentum; gentle idle sway rides on top. (Yaw lives
    // on the wrapper group — the rig's own root yaw belongs to facing turns.)
    if (this.dragPointerId === null && Math.abs(this.spinVelocity) > 0.01) {
      this.userYaw += this.spinVelocity * dt;
      this.spinVelocity *= Math.exp(-3.2 * dt);
    }
    this.group.rotation.y = this.userYaw + Math.sin(this.t * 0.5) * 0.1;
    this.preview.update(dt);
  }

  dispose(): void {
    this.detachDrag?.();
    this.detachDrag = null;
    if (this.preview) {
      this.group.remove(this.preview.root);
      this.preview.dispose();
      this.preview = null;
    }
  }
}
