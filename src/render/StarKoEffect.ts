import * as THREE from 'three';
import type { Particles } from './Particles';

/**
 * Star KO cinematic (VIEW-ONLY — the sim resolved the KO the instant the
 * blast line was crossed; rollback never sees any of this).
 *
 * Clones the KO'd fighter's rig (materials shared — the source is hidden by
 * beginKo and must survive for respawn) and flies it INTO the background over
 * ~2s: shrink, tumble, then a white twinkle burst. Timed to the ElevenLabs
 * falling scream riding the same `ko` event.
 */

const FLIGHT_SECONDS = 2.0;

type StarFlight = {
  clone: THREE.Object3D;
  age: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  spinX: number;
  spinZ: number;
  color: number;
  done: boolean;
};

export class StarKoEffect {
  private readonly flights: StarFlight[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly particles: Particles,
  ) {}

  /** Launch the cinematic from the fighter's rig at the KO position. */
  launch(sourceRig: THREE.Object3D, x: number, y: number, color: number): void {
    const clone = sourceRig.clone(true);
    clone.visible = true;
    clone.position.set(x, Math.max(y, 2), 0);
    this.scene.add(clone);
    this.flights.push({
      clone,
      age: 0,
      startX: x,
      startY: Math.max(y, 2),
      endX: x * 0.25,
      endY: Math.max(y, 2) + 14,
      spinX: 2.4 + Math.random() * 2, // det-ok: view-only
      spinZ: 3.2 + Math.random() * 2, // det-ok: view-only
      color,
      done: false,
    });
  }

  update(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i -= 1) {
      const flight = this.flights[i]!;
      flight.age += dt;
      const t = Math.min(1, flight.age / FLIGHT_SECONDS);
      const ease = t * t;
      flight.clone.position.set(
        flight.startX + (flight.endX - flight.startX) * ease,
        flight.startY + (flight.endY - flight.startY) * ease,
        -30 * ease, // into the background
      );
      const scale = Math.max(0.04, 1 - ease * 0.96);
      flight.clone.scale.setScalar(scale);
      flight.clone.rotation.x += flight.spinX * dt;
      flight.clone.rotation.z += flight.spinZ * dt;
      if (t >= 1 && !flight.done) {
        flight.done = true;
        // Twinkle: white burst at the vanish point (projected back to z≈0
        // reads fine — the camera looks straight down -Z).
        this.particles.burst(flight.clone.position.x, flight.clone.position.y, 0xffffff, 20, 4);
        this.particles.burst(flight.clone.position.x, flight.clone.position.y, flight.color, 10, 2.5);
        this.scene.remove(flight.clone);
        this.flights.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const flight of this.flights) this.scene.remove(flight.clone);
    this.flights.length = 0;
  }
}
