import * as THREE from 'three';
import { characterById } from '../../data/characters';
import { danceFor, type Dance } from '../../rigs/dances';
import { buildCharacterRig } from '../../rigs/characterBuilders';
import type { Rig } from '../../rigs/FighterRig';
import { poseAttack, poseFightStance } from '../../rigs/poses';
import { makeToonMaterial } from '../../render/toon';

/** How long a triggered dance emote plays before returning to the stance. */
const DANCE_DURATION = 4.2;

/**
 * The cinematic 3D lobby stage: up to 4 lit pedestals in a shallow arc, each
 * holding a player's chosen fighter (or an empty glowing platform). This is
 * the heart of the "best-in-the-world lobby" — everyone SEES everyone's pick
 * in 3D, the local player's pedestal is spotlit, and readying pops confetti +
 * a color surge. The camera flies in on enter and drifts gently.
 *
 * View-only. The owning screen calls setFighter/setReady/setLocal from room
 * snapshots, update(camera, dt) every frame, and nameplateScreenPos to align
 * the DOM nameplates that float above each fighter.
 */

const CYL = new THREE.CylinderGeometry(1, 1.15, 1, 40);
const RING = new THREE.TorusGeometry(1, 0.06, 10, 48);
const DISC = new THREE.CircleGeometry(1, 40);

/** Pedestal world X per slot (4-wide arc, facing -Z toward the camera). */
const SLOT_X = [-6.0, -2.0, 2.0, 6.0];
const PEDESTAL_Y = -2.1;
const PEDESTAL_Z = 7.5;
const FIGHTER_SCALE = 1.02;
/** World-Y a touch above a standing fighter's head — where the nameplate floats. */
const HEAD_Y = PEDESTAL_Y + 2.95;

class Pedestal {
  readonly group = new THREE.Group();
  readonly baseGroup = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly spot: THREE.SpotLight;
  private rig: Rig | null = null;
  private characterId: string | null = null;
  private punchT = -1;
  private t: number;
  private readyT = 0;
  private ready = false;
  private local = false;
  private pulseFired = false;
  private dance: Dance | null = null;
  private danceT = 0;
  private readonly mats: THREE.Material[] = [];

  constructor(
    scene: THREE.Scene,
    readonly slot: number,
    readonly color: number,
  ) {
    this.t = slot * 1.3;
    this.group.position.set(SLOT_X[slot]!, PEDESTAL_Y, PEDESTAL_Z);
    this.group.add(this.baseGroup);

    // Column + top cap.
    const colMat = this.toon(0x2b3352);
    const col = new THREE.Mesh(CYL, colMat);
    col.scale.set(1.2, 1.1, 1.2);
    col.position.y = -0.55;
    this.baseGroup.add(col);
    const capMat = this.toon(0x3a4570);
    const cap = new THREE.Mesh(CYL, capMat);
    cap.scale.set(1.35, 0.14, 1.35);
    cap.position.y = 0.05;
    this.baseGroup.add(cap);

    // Glowing top disc + rim ring in the slot color.
    this.glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.34,
      toneMapped: false,
    });
    const disc = new THREE.Mesh(DISC, this.glowMat);
    disc.rotation.x = -Math.PI / 2;
    disc.scale.setScalar(1.28);
    disc.position.y = 0.13;
    this.baseGroup.add(disc);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    });
    this.ring = new THREE.Mesh(RING, this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.scale.setScalar(1.32);
    this.ring.position.y = 0.14;
    this.baseGroup.add(this.ring);

    // A soft spotlight from above for that "on-stage" pop.
    this.spot = new THREE.SpotLight(color, 0, 14, Math.PI / 7, 0.6, 1.2);
    this.spot.position.set(SLOT_X[slot]!, PEDESTAL_Y + 9, PEDESTAL_Z + 1.5);
    this.spot.target.position.set(SLOT_X[slot]!, PEDESTAL_Y, PEDESTAL_Z);
    scene.add(this.spot);
    scene.add(this.spot.target);

    scene.add(this.group);
  }

  private toon(hex: number): THREE.MeshToonMaterial {
    const m = makeToonMaterial(hex);
    this.mats.push(m);
    return m;
  }

  setFighter(characterId: string | null): void {
    if (characterId === this.characterId) return;
    this.characterId = characterId;
    if (this.rig) {
      this.group.remove(this.rig.root);
      this.rig.dispose();
      this.rig = null;
    }
    if (characterId) {
      const rig = buildCharacterRig(characterById(characterId));
      rig.setShadow(null, 0);
      rig.root.rotation.y = -Math.PI / 2; // face the camera
      rig.root.scale.setScalar(FIGHTER_SCALE);
      rig.root.position.y = 0.2;
      this.group.add(rig.root);
      this.rig = rig;
      this.punchT = 0; // greet with a punch on arrival
    }
  }

  setReady(ready: boolean): void {
    if (ready && !this.ready) {
      this.readyT = 0.0001; // trigger the ring surge
      this.pulseFired = true; // one-shot confetti flag for the owner
    }
    this.ready = ready;
  }

  setLocal(local: boolean): void {
    this.local = local;
  }

  /** Break into this fighter's signature dance (restarts if already dancing). */
  startDance(): void {
    if (!this.characterId) return;
    this.dance = danceFor(this.characterId);
    this.danceT = 0.0001;
    this.punchT = -1; // cancel any greeting
  }

  /** True once, the frame a player readies (owner spawns confetti). */
  consumeReadyPulse(): boolean {
    if (!this.pulseFired) return false;
    this.pulseFired = false;
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const blend = 1 - Math.exp(-14 * dt);

    // Ring/glow breathe; local pedestal is brighter and pulses faster.
    const base = this.local ? 0.75 : 0.5;
    const pulse = base + Math.sin(this.t * (this.local ? 3.4 : 1.8)) * 0.18;
    this.ringMat.opacity = this.characterId ? pulse : pulse * 0.5;
    this.glowMat.opacity = (this.characterId ? 0.34 : 0.16) + Math.sin(this.t * 2.2) * 0.05;
    this.spot.intensity = this.characterId ? (this.local ? 2.4 : 1.5) : 0.4;

    // Ready surge: quick ring scale-punch + brightness burst.
    if (this.readyT > 0) {
      this.readyT += dt;
      const k = Math.min(1, this.readyT * 2.5);
      const punch = 1.32 + Math.sin(k * Math.PI) * 0.28;
      this.ring.scale.setScalar(punch);
      this.ringMat.opacity = 1;
      this.spot.intensity += (1 - k) * 2;
      if (k >= 1) {
        this.readyT = 0;
        this.ring.scale.setScalar(1.32);
      }
    }

    // Dancing takes over the whole body (pose + bob/sway/spin); a readied
    // fighter otherwise holds a finisher; else greet / idle stance.
    if (this.rig) {
      const root = this.rig.root;
      const d = this.dance;
      if (d && this.danceT > 0) {
        this.danceT += dt;
        if (this.danceT >= DANCE_DURATION) this.dance = null; // ...back to stance
        else this.rig.setPose(d.pose(this.danceT), blend);
      } else if (this.punchT >= 0) {
        this.punchT += dt * 2.4;
        if (this.punchT >= 1) this.punchT = -1;
        else this.rig.setPose(poseAttack('finisher', this.punchT), blend);
      } else {
        this.rig.setPose(this.ready ? poseAttack('finisher', 0.55) : poseFightStance(this.t), blend);
      }
      // rig.update() rewrites root.rotation.y (facing), so apply the facing +
      // dance transform AFTER it, every frame.
      this.rig.update(dt);
      const dancing = this.dance && this.danceT > 0;
      root.position.set(dancing ? this.dance!.sway?.(this.danceT) ?? 0 : 0, 0.2 + (dancing ? this.dance!.bob?.(this.danceT) ?? 0 : 0), 0);
      root.rotation.y = -Math.PI / 2 + (dancing ? this.dance!.spin?.(this.danceT) ?? 0 : 0);
    }
  }

  dispose(scene: THREE.Scene): void {
    if (this.rig) {
      this.group.remove(this.rig.root);
      this.rig.dispose();
    }
    scene.remove(this.group);
    scene.remove(this.spot);
    scene.remove(this.spot.target);
    this.ringMat.dispose();
    this.glowMat.dispose();
    for (const m of this.mats) m.dispose();
  }
}

export class PedestalStage {
  private readonly pedestals: Pedestal[] = [];
  private flyT = 0;
  private driftT = 0;

  constructor(
    private readonly scene: THREE.Scene,
    slotColors: readonly number[],
    private readonly playerCount = 4,
  ) {
    for (let slot = 0; slot < 4; slot += 1) {
      this.pedestals.push(new Pedestal(scene, slot, slotColors[slot] ?? 0xffffff));
    }
  }

  setFighter(slot: number, characterId: string | null): void {
    this.pedestals[slot]?.setFighter(characterId);
  }
  setReady(slot: number, ready: boolean): void {
    this.pedestals[slot]?.setReady(ready);
  }
  setLocal(slot: number): void {
    for (const p of this.pedestals) p.setLocal(p.slot === slot);
  }
  /** Trigger the fighter on `slot` to break into its signature dance. */
  playDance(slot: number): void {
    this.pedestals[slot]?.startDance();
  }

  /** Screen fraction {x,y} of a pedestal top (confetti origin). */
  pedestalScreenPos(slot: number, cam: THREE.PerspectiveCamera): { x: number; y: number } {
    const v = new THREE.Vector3(SLOT_X[slot] ?? 0, PEDESTAL_Y + 0.3, PEDESTAL_Z).project(cam);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** Screen fraction {x,y} just above a fighter's head — where the nameplate floats. */
  nameplateScreenPos(slot: number, cam: THREE.PerspectiveCamera): { x: number; y: number } {
    const v = new THREE.Vector3(SLOT_X[slot] ?? 0, HEAD_Y, PEDESTAL_Z).project(cam);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** Which pedestals just fired their ready surge this frame. */
  consumeReadyPulses(): number[] {
    const out: number[] = [];
    for (const p of this.pedestals) if (p.consumeReadyPulse()) out.push(p.slot);
    return out;
  }

  /** Camera cinematic fly-in (call once at enter with the shared camera). */
  startFlyIn(cam: THREE.PerspectiveCamera): void {
    this.flyT = 0;
    this.driftT = 0;
    cam.position.set(0, 3.4, 31);
    cam.lookAt(0, -1.2, 0);
  }

  update(cam: THREE.PerspectiveCamera, dt: number): void {
    // Ease the camera from the pulled-back fly-in pose to the framing, then
    // let it drift gently forever (that subtle life = the AAA feel).
    this.flyT = Math.min(1, this.flyT + dt);
    this.driftT += dt;
    const e = easeOutCubic(this.flyT);
    // Gentle perpetual drift only AFTER the fly-in has settled (so it doesn't
    // fight the ease-in), and small enough to stay framed.
    const drift = Math.sin(this.driftT * 0.32) * 0.35 * e;
    cam.position.set(
      drift,
      lerp(3.4, 1.15, e),
      lerp(31, 17.5, e),
    );
    cam.lookAt(0, lerp(-1.2, -0.75, e), 0);

    for (const p of this.pedestals) p.update(dt);
    void this.playerCount;
  }

  dispose(): void {
    for (const p of this.pedestals) p.dispose(this.scene);
    this.pedestals.length = 0;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
