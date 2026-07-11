import * as THREE from 'three';
import { weaponById } from '../data/weapons';
import { makeToonMaterial } from '../render/toon';
import { poseAttack, poseFightStance, type Pose } from '../rigs/poses';
import { buildMockRig, type CharId, type MockRig } from './rigs';

// Adapted from Derek's shipped PedestalStage. The same world spacing, camera
// framing, projected nameplate anchors, glowing empty platforms, and ready
// surge are used here so the review mockup matches the proven lobby room.
const CYL = new THREE.CylinderGeometry(1, 1.15, 1, 40);
const RING = new THREE.TorusGeometry(1, 0.06, 10, 48);
const DISC = new THREE.CircleGeometry(1, 40);
const SLOT_X = [-6, -2, 2, 6] as const;
const PEDESTAL_Y = -2.1;
const PEDESTAL_Z = 7.5;
const FIGHTER_SCALE = 1.02;
const HEAD_Y = PEDESTAL_Y + 2.95;
const DANCE_DURATION = 4.2;

class Pedestal {
  readonly group = new THREE.Group();
  private readonly baseGroup = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly spot: THREE.SpotLight;
  private readonly mats: THREE.Material[] = [];
  private rig: MockRig | null = null;
  private characterId: CharId | null = null;
  private weaponId: string | null = null;
  private punchT = -1;
  private t: number;
  private readyT = 0;
  private ready = false;
  private local = false;
  private dancingT = 0;

  constructor(scene: THREE.Scene, readonly slot: number, color: number) {
    this.t = slot * 1.3;
    this.group.position.set(SLOT_X[slot]!, PEDESTAL_Y, PEDESTAL_Z);
    this.group.add(this.baseGroup);

    const column = new THREE.Mesh(CYL, this.toon(0x2b3352));
    column.scale.set(1.2, 1.1, 1.2);
    column.position.y = -0.55;
    this.baseGroup.add(column);
    const cap = new THREE.Mesh(CYL, this.toon(0x3a4570));
    cap.scale.set(1.35, 0.14, 1.35);
    cap.position.y = 0.05;
    this.baseGroup.add(cap);

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

    this.spot = new THREE.SpotLight(color, 0, 14, Math.PI / 7, 0.6, 1.2);
    this.spot.position.set(SLOT_X[slot]!, PEDESTAL_Y + 9, PEDESTAL_Z + 1.5);
    this.spot.target.position.set(SLOT_X[slot]!, PEDESTAL_Y, PEDESTAL_Z);
    scene.add(this.spot, this.spot.target, this.group);
  }

  private toon(hex: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(hex);
    this.mats.push(material);
    return material;
  }

  setFighter(characterId: CharId | null): void {
    if (characterId === this.characterId) return;
    this.characterId = characterId;
    this.rig?.dispose();
    this.rig = null;
    if (!characterId) return;
    const rig = buildMockRig('C', characterId);
    rig.root.scale.setScalar(FIGHTER_SCALE);
    rig.root.position.y = 0.2;
    this.group.add(rig.root);
    this.rig = rig;
    if (this.weaponId) rig.equipWeapon(weaponById(this.weaponId));
    this.punchT = 0;
  }

  setWeapon(weaponId: string | null): void {
    if (weaponId === this.weaponId) return;
    this.weaponId = weaponId;
    this.rig?.equipWeapon(weaponId ? weaponById(weaponId) : null);
  }

  setReady(ready: boolean): void {
    if (ready && !this.ready) this.readyT = 0.0001;
    this.ready = ready;
  }

  setLocal(local: boolean): void {
    this.local = local;
  }

  playDance(): void {
    if (!this.rig) return;
    this.dancingT = 0.0001;
    this.punchT = -1;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.spot.visible = visible;
    this.spot.target.visible = visible;
  }

  update(dt: number): void {
    this.t += dt;
    const base = this.local ? 0.75 : 0.5;
    const pulse = base + Math.sin(this.t * (this.local ? 3.4 : 1.8)) * 0.18;
    this.ringMat.opacity = this.characterId ? pulse : pulse * 0.5;
    this.glowMat.opacity = (this.characterId ? 0.34 : 0.16) + Math.sin(this.t * 2.2) * 0.05;
    this.spot.intensity = this.characterId ? (this.local ? 2.4 : 1.5) : 0.4;
    // Empty slots visibly breathe instead of reading as dead placeholders.
    if (!this.characterId) {
      const emptyScale = 1.32 + Math.sin(this.t * 1.8) * 0.08;
      this.ring.scale.setScalar(emptyScale);
      this.baseGroup.position.y = Math.sin(this.t * 1.4) * 0.04;
    } else {
      this.baseGroup.position.y = 0;
    }

    if (this.readyT > 0) {
      this.readyT += dt;
      const k = Math.min(1, this.readyT * 2.5);
      this.ring.scale.setScalar(1.32 + Math.sin(k * Math.PI) * 0.28);
      this.ringMat.opacity = 1;
      this.spot.intensity += (1 - k) * 2;
      if (k >= 1) this.readyT = 0;
    }

    if (!this.rig) return;
    const blend = 1 - Math.exp(-14 * dt);
    let pose: Pose;
    if (this.dancingT > 0) {
      this.dancingT += dt;
      if (this.dancingT >= DANCE_DURATION) this.dancingT = 0;
      pose = dancePose(this.dancingT || this.t);
    } else if (this.punchT >= 0) {
      this.punchT += dt * 2.4;
      if (this.punchT >= 1) this.punchT = -1;
      pose = this.punchT < 0 ? poseFightStance(this.t) : poseAttack('finisher', this.punchT);
    } else {
      pose = this.ready ? poseAttack('finisher', 0.55) : poseFightStance(this.t);
    }
    this.rig.setPose(pose, blend);
    this.rig.update(dt);
    this.rig.root.rotation.y = -Math.PI / 2;
  }
}

export class PedestalRoom {
  private readonly pedestals: Pedestal[] = [];
  private flyT = 1;
  private driftT = 0;
  private visible = false;

  constructor(scene: THREE.Scene, colors: readonly number[]) {
    for (let slot = 0; slot < 4; slot += 1) {
      this.pedestals.push(new Pedestal(scene, slot, colors[slot] ?? 0xffffff));
    }
    this.setVisible(false);
  }

  setFighter(slot: number, characterId: CharId | null): void {
    this.pedestals[slot]?.setFighter(characterId);
  }

  setReady(slot: number, ready: boolean): void {
    this.pedestals[slot]?.setReady(ready);
  }

  setWeapon(slot: number, weaponId: string | null): void {
    this.pedestals[slot]?.setWeapon(weaponId);
  }

  setLocal(slot: number): void {
    for (const pedestal of this.pedestals) pedestal.setLocal(pedestal.slot === slot);
  }

  playDance(slot: number): void {
    this.pedestals[slot]?.playDance();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const pedestal of this.pedestals) pedestal.setVisible(visible);
  }

  startFlyIn(camera: THREE.PerspectiveCamera): void {
    this.flyT = 0;
    this.driftT = 0;
    camera.position.set(0, 3.4, 31);
    camera.lookAt(0, -1.2, 0);
  }

  update(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.visible) return;
    this.flyT = Math.min(1, this.flyT + dt);
    this.driftT += dt;
    const eased = 1 - Math.pow(1 - this.flyT, 3);
    const drift = Math.sin(this.driftT * 0.32) * 0.35 * eased;
    // Derek's original 17.5 framing is ideal around 2.1:1. Pull back on
    // narrower landscape phones so P1/P4 and their projected plates stay in.
    const settledZ = 17.5 * Math.max(1, 2.05 / camera.aspect);
    camera.position.set(drift, lerp(3.4, 1.15, eased), lerp(31, settledZ, eased));
    camera.lookAt(0, lerp(-1.2, -0.75, eased), 0);
    for (const pedestal of this.pedestals) pedestal.update(dt);
  }

  nameplateScreenPos(slot: number, camera: THREE.PerspectiveCamera): { x: number; y: number } {
    const point = new THREE.Vector3(SLOT_X[slot] ?? 0, HEAD_Y, PEDESTAL_Z).project(camera);
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
  }
}

function dancePose(time: number): Pose {
  const beat = Math.sin(time * 6.3);
  const side = Math.sin(time * 3.15);
  return {
    root: { z: Math.abs(beat) * -0.08 },
    hips: { x: side * 0.3, z: -beat * 0.08 },
    torso: { x: -side * 0.25, z: beat * 0.12 },
    head: { x: side * 0.18, z: -beat * 0.08 },
    armL: { x: 0.35 + side * 0.4, z: 1.4 + beat * 0.42 },
    armR: { x: -0.35 + side * 0.4, z: 1.4 - beat * 0.42 },
    foreArmL: { z: 0.5 },
    foreArmR: { z: 0.5 },
    legL: { x: side * 0.15, z: beat * 0.25 },
    legR: { x: side * 0.15, z: -beat * 0.25 },
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
