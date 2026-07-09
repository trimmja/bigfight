/**
 * Follow camera for the battle. Frames all follow points (player weighted
 * heaviest), pulls the distance in/out so everyone fits with a margin, and
 * smooths toward the target. Stays axis-aligned (looking down -Z) so the stage
 * never tilts. Screen shake rides on top as a decaying random offset.
 */
import * as THREE from 'three';
import { CAM_MIN_DIST, CAM_MAX_DIST, CAM_SMOOTHING, SHAKE_DECAY } from '../config';
import { clamp, damp, degToRad } from '../core/math';
import { events } from '../core/events';

/** Extra world units of breathing room around the framed points. */
const MARGIN = 4;
const TWO_PI = Math.PI * 2;

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;

  // Smoothed base position (shake is layered on afterwards).
  private baseX: number;
  private baseY: number;
  private baseZ: number;

  // Desired targets set by follow().
  private targetX: number;
  private targetY: number;
  private targetZ: number;

  private minX = Number.NEGATIVE_INFINITY;
  private maxX = Number.POSITIVE_INFINITY;
  private minY = Number.NEGATIVE_INFINITY;

  private shake = 0;
  private readonly shakeUnsub: () => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    private readonly shakeEnabled: () => boolean = () => true,
  ) {
    this.camera = camera;
    // Take over orientation: look straight down -Z regardless of prior lookAt.
    camera.rotation.set(0, 0, 0);
    this.baseX = camera.position.x;
    this.baseY = camera.position.y;
    this.baseZ = camera.position.z;
    this.targetX = this.baseX;
    this.targetY = this.baseY;
    this.targetZ = this.baseZ;

    this.shakeUnsub = events.on('screenShake', ({ amount }) => {
      if (!this.shakeEnabled()) return;
      this.shake = Math.max(this.shake, amount);
    });
  }

  /** Unsubscribes from the event bus — call when the owning screen exits. */
  dispose(): void {
    this.shakeUnsub();
  }

  /** Clamp the framed view so it never drifts off-stage / below the floor. */
  setBounds(minX: number, maxX: number, minY: number): void {
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
  }

  /**
   * Recompute the camera target from the points to keep on screen. Point 0
   * (the player) is weighted double. Call each frame with the live positions.
   */
  follow(points: { x: number; y: number }[]): void {
    const count = points.length;
    if (count === 0) return;

    let wsum = 0;
    let cx = 0;
    let cy = 0;
    let minPX = Number.POSITIVE_INFINITY;
    let maxPX = Number.NEGATIVE_INFINITY;
    let minPY = Number.POSITIVE_INFINITY;
    let maxPY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const p = points[i]!;
      const w = i === 0 ? 2 : 1;
      wsum += w;
      cx += p.x * w;
      cy += p.y * w;
      if (p.x < minPX) minPX = p.x;
      if (p.x > maxPX) maxPX = p.x;
      if (p.y < minPY) minPY = p.y;
      if (p.y > maxPY) maxPY = p.y;
    }
    cx /= wsum;
    cy /= wsum;

    const tanV = Math.tan(degToRad(this.camera.fov) / 2);
    const aspect = this.camera.aspect || 1;
    const spreadX = maxPX - minPX;
    const spreadY = maxPY - minPY;
    const needY = (spreadY / 2 + MARGIN) / tanV;
    const needX = (spreadX / 2 + MARGIN) / (tanV * aspect);
    const dist = clamp(Math.max(needX, needY), CAM_MIN_DIST, CAM_MAX_DIST);

    // Half-extents of the view at this distance.
    const halfH = dist * tanV;
    const halfW = halfH * aspect;

    // Horizontal: keep centred, but don't show past the stage side bounds.
    let tx = cx;
    const loX = this.minX + halfW;
    const hiX = this.maxX - halfW;
    tx = loX <= hiX ? clamp(tx, loX, hiX) : (this.minX + this.maxX) / 2;

    // Vertical: bias toward the action, but keep the floor from showing.
    let ty = cy * 0.6 + 2;
    const floorTy = this.minY + halfH;
    if (ty < floorTy) ty = floorTy;

    this.targetX = tx;
    this.targetY = ty;
    this.targetZ = dist;
  }

  /** Smooth toward the target and apply the current shake offset. */
  update(dt: number): void {
    this.baseX = damp(this.baseX, this.targetX, CAM_SMOOTHING, dt);
    this.baseY = damp(this.baseY, this.targetY, CAM_SMOOTHING, dt);
    this.baseZ = damp(this.baseZ, this.targetZ, CAM_SMOOTHING, dt);

    this.shake = damp(this.shake, 0, SHAKE_DECAY, dt);
    let ox = 0;
    let oy = 0;
    if (this.shake > 0.001) {
      const a = Math.random() * TWO_PI;
      ox = Math.cos(a) * this.shake;
      oy = Math.sin(a) * this.shake;
    }

    this.camera.position.set(this.baseX + ox, this.baseY + oy, this.baseZ);
  }
}
