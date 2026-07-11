import * as THREE from 'three';
import { characterById } from '../../data/characters';
import { weaponById } from '../../data/weapons';
import { makeToonMaterial } from '../../render/toon';
import { buildCharacterRig } from '../../rigs/characterBuilders';
import { danceFor, type Dance } from '../../rigs/dances';
import type { Rig } from '../../rigs/FighterRig';
import { poseAttack, poseFightStance } from '../../rigs/poses';
import { buildWeaponModel } from '../../rigs/weaponBuilders';

const CYLINDER = new THREE.CylinderGeometry(1, 1.15, 1, 40);
const RING = new THREE.TorusGeometry(1, 0.06, 10, 48);
const DISC = new THREE.CircleGeometry(1, 40);
const SLOT_X = [-6, -2, 2, 6] as const;
const PEDESTAL_Y = -2.1;
const PEDESTAL_Z = 7.5;
const HEAD_Y = PEDESTAL_Y + 2.95;
const FIGHTER_SCALE = 1.02;
const DANCE_DURATION = 4.2;

/** One view-only lobby pedestal and the live fighter/weapon displayed on it. */
class Pedestal {
  readonly group = new THREE.Group();
  private readonly baseGroup = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly spotlight: THREE.SpotLight;
  private readonly materials: THREE.Material[] = [];
  private rig: Rig | null = null;
  private weaponModel: THREE.Group | null = null;
  private characterId: string | null = null;
  private weaponId: string | null = null;
  private ready = false;
  private local = false;
  private readyTime = 0;
  private greetingTime = -1;
  private dance: Dance | null = null;
  private danceTime = 0;
  private time: number;

  constructor(
    private readonly scene: THREE.Scene,
    readonly slot: number,
    color: number,
  ) {
    this.time = slot * 1.3;
    this.group.position.set(SLOT_X[slot]!, PEDESTAL_Y, PEDESTAL_Z);
    this.group.add(this.baseGroup);

    const column = new THREE.Mesh(CYLINDER, this.toon(0x2b3352));
    column.scale.set(1.2, 1.1, 1.2);
    column.position.y = -0.55;
    this.baseGroup.add(column);

    const cap = new THREE.Mesh(CYLINDER, this.toon(0x3a4570));
    cap.scale.set(1.35, 0.14, 1.35);
    cap.position.y = 0.05;
    this.baseGroup.add(cap);

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.34,
      toneMapped: false,
    });
    const disc = new THREE.Mesh(DISC, this.glowMaterial);
    disc.rotation.x = -Math.PI / 2;
    disc.scale.setScalar(1.28);
    disc.position.y = 0.13;
    this.baseGroup.add(disc);

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(color, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
    });
    this.ring = new THREE.Mesh(RING, this.ringMaterial);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.scale.setScalar(1.32);
    this.ring.position.y = 0.14;
    this.baseGroup.add(this.ring);

    this.spotlight = new THREE.SpotLight(color, 0, 14, Math.PI / 7, 0.6, 1.2);
    this.spotlight.position.set(SLOT_X[slot]!, PEDESTAL_Y + 9, PEDESTAL_Z + 1.5);
    this.spotlight.target.position.set(SLOT_X[slot]!, PEDESTAL_Y, PEDESTAL_Z);
    scene.add(this.group, this.spotlight, this.spotlight.target);
  }

  private toon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push(material);
    return material;
  }

  setFighter(characterId: string | null): void {
    if (characterId === this.characterId) return;
    this.characterId = characterId;
    this.dance = null;
    this.danceTime = 0;
    this.greetingTime = -1;
    this.clearRig();
    if (!characterId) return;

    const rig = buildCharacterRig(characterById(characterId));
    rig.setShadow(null, 0);
    rig.root.scale.setScalar(FIGHTER_SCALE);
    rig.root.position.y = 0.2;
    rig.root.rotation.y = -Math.PI / 2;
    this.group.add(rig.root);
    this.rig = rig;
    this.attachWeapon();
    this.greetingTime = 0;
  }

  setWeapon(weaponId: string | null): void {
    if (weaponId === this.weaponId) return;
    this.weaponId = weaponId;
    this.clearWeapon();
    this.attachWeapon();
  }

  setReady(ready: boolean): void {
    if (ready && !this.ready) this.readyTime = 0.0001;
    this.ready = ready;
  }

  setLocal(local: boolean): void {
    this.local = local;
  }

  playDance(): void {
    if (!this.characterId) return;
    this.dance = danceFor(this.characterId);
    this.danceTime = 0.0001;
    this.greetingTime = -1;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.spotlight.visible = visible;
    this.spotlight.target.visible = visible;
  }

  setSelectionFocus(focused: boolean | null, visible: boolean): void {
    const show = visible && focused !== false;
    this.setVisible(show);
    const x = focused === true ? 0 : SLOT_X[this.slot]!;
    this.group.position.x = x;
    this.spotlight.position.x = x;
    this.spotlight.target.position.x = x;
  }

  update(dt: number): void {
    this.time += dt;
    const base = this.local ? 0.75 : 0.5;
    const pulse = base + Math.sin(this.time * (this.local ? 3.4 : 1.8)) * 0.18;
    this.ringMaterial.opacity = this.characterId ? pulse : pulse * 0.5;
    this.glowMaterial.opacity = (this.characterId ? 0.34 : 0.16) + Math.sin(this.time * 2.2) * 0.05;
    this.spotlight.intensity = this.characterId ? (this.local ? 2.4 : 1.5) : 0.4;

    // Open slots visibly hover and breathe, with staggered timing across all
    // four positions, rather than reading as dead scenery.
    if (!this.characterId) {
      this.baseGroup.position.y = Math.sin(this.time * 1.4) * 0.055;
      this.baseGroup.rotation.y = Math.sin(this.time * 0.75) * 0.045;
      this.ring.scale.setScalar(1.32 + Math.sin(this.time * 1.8) * 0.1);
    } else {
      this.baseGroup.position.y = 0;
      this.baseGroup.rotation.y = 0;
      if (this.readyTime <= 0) this.ring.scale.setScalar(1.32);
    }

    if (this.readyTime > 0) {
      this.readyTime += dt;
      const progress = Math.min(1, this.readyTime * 2.5);
      this.ring.scale.setScalar(1.32 + Math.sin(progress * Math.PI) * 0.28);
      this.ringMaterial.opacity = 1;
      this.spotlight.intensity += (1 - progress) * 2;
      if (progress >= 1) this.readyTime = 0;
    }

    if (!this.rig) return;
    const blend = 1 - Math.exp(-14 * dt);
    if (this.dance && this.danceTime > 0) {
      this.danceTime += dt;
      if (this.danceTime >= DANCE_DURATION) {
        this.dance = null;
        this.danceTime = 0;
      } else {
        this.rig.setPose(this.dance.pose(this.danceTime), blend);
      }
    } else if (this.greetingTime >= 0) {
      this.greetingTime += dt * 2.4;
      if (this.greetingTime >= 1) this.greetingTime = -1;
      else this.rig.setPose(poseAttack('finisher', this.greetingTime), blend);
    } else {
      this.rig.setPose(this.ready ? poseAttack('finisher', 0.55) : poseFightStance(this.time), blend);
    }

    this.rig.update(dt);
    const dancing = this.dance !== null && this.danceTime > 0;
    this.rig.root.position.set(
      dancing ? this.dance!.sway?.(this.danceTime) ?? 0 : 0,
      0.2 + (dancing ? this.dance!.bob?.(this.danceTime) ?? 0 : 0),
      0,
    );
    this.rig.root.rotation.y = -Math.PI / 2 + (dancing ? this.dance!.spin?.(this.danceTime) ?? 0 : 0);
  }

  dispose(): void {
    this.clearRig();
    this.scene.remove(this.group, this.spotlight, this.spotlight.target);
    this.ringMaterial.dispose();
    this.glowMaterial.dispose();
    for (const material of this.materials) material.dispose();
  }

  private attachWeapon(): void {
    if (!this.rig || !this.weaponId) return;
    const model = buildWeaponModel(weaponById(this.weaponId));
    this.rig.weaponSocket.add(model);
    this.weaponModel = model;
  }

  private clearWeapon(): void {
    if (!this.weaponModel) return;
    this.weaponModel.removeFromParent();
    disposeWeaponModel(this.weaponModel);
    this.weaponModel = null;
  }

  private clearRig(): void {
    this.clearWeapon();
    if (!this.rig) return;
    this.rig.root.removeFromParent();
    this.rig.dispose();
    this.rig = null;
  }
}

/** Cinematic four-pedestal stage shared by the production online lobby. */
export class PedestalStage {
  private readonly pedestals: Pedestal[] = [];
  private visible = true;
  private flyTime = 1;
  private driftTime = 0;
  private selectionSlot: number | null = null;

  constructor(
    scene: THREE.Scene,
    slotColors: readonly number[],
  ) {
    for (let slot = 0; slot < 4; slot += 1) {
      this.pedestals.push(new Pedestal(scene, slot, slotColors[slot] ?? 0xffffff));
    }
  }

  setFighter(slot: number, characterId: string | null): void {
    this.pedestals[slot]?.setFighter(characterId);
  }

  setWeapon(slot: number, weaponId: string | null): void {
    this.pedestals[slot]?.setWeapon(weaponId);
  }

  setReady(slot: number, ready: boolean): void {
    this.pedestals[slot]?.setReady(ready);
  }

  setLocal(slot: number): void {
    for (const pedestal of this.pedestals) pedestal.setLocal(pedestal.slot === slot);
  }

  playDance(slot: number): void {
    this.pedestals[slot]?.playDance();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.applyLayout();
  }

  /** Loadout steps focus one player's pedestal in the center of the room. */
  setSelectionSlot(slot: number | null): void {
    this.selectionSlot = slot;
    this.applyLayout();
  }

  startFlyIn(camera: THREE.PerspectiveCamera): void {
    this.flyTime = 0;
    this.driftTime = 0;
    camera.position.set(0, 3.4, 31);
    camera.lookAt(0, -1.2, 0);
  }

  update(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.visible) return;
    if (this.selectionSlot !== null) {
      camera.position.set(0, 0.65, 14.7);
      camera.lookAt(0, -0.8, PEDESTAL_Z);
      for (const pedestal of this.pedestals) pedestal.update(dt);
      return;
    }
    this.flyTime = Math.min(1, this.flyTime + dt);
    this.driftTime += dt;
    const eased = 1 - Math.pow(1 - this.flyTime, 3);
    const drift = Math.sin(this.driftTime * 0.32) * 0.35 * eased;
    // Keep outside pedestals and their projected labels visible on narrow
    // landscape phones while retaining Derek's 17.5 desktop framing.
    const settledZ = 17.5 * Math.max(1, 2.05 / camera.aspect);
    camera.position.set(drift, lerp(3.4, 1.15, eased), lerp(31, settledZ, eased));
    camera.lookAt(0, lerp(-1.2, -0.75, eased), 0);
    for (const pedestal of this.pedestals) pedestal.update(dt);
  }

  nameplateScreenPos(slot: number, camera: THREE.PerspectiveCamera): { x: number; y: number } {
    const point = new THREE.Vector3(SLOT_X[slot] ?? 0, HEAD_Y, PEDESTAL_Z).project(camera);
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 };
  }

  dispose(): void {
    for (const pedestal of this.pedestals) pedestal.dispose();
    this.pedestals.length = 0;
  }

  private applyLayout(): void {
    for (const pedestal of this.pedestals) {
      const focus = this.selectionSlot === null ? null : pedestal.slot === this.selectionSlot;
      pedestal.setSelectionFocus(focus, this.visible);
    }
  }
}

function disposeWeaponModel(model: THREE.Group): void {
  const materials = model.userData.weaponMaterials as THREE.Material[] | undefined;
  for (const material of materials ?? []) material.dispose();
  model.traverse((child) => {
    if (!(child instanceof THREE.Sprite)) return;
    if (!materials?.includes(child.material)) child.material.dispose();
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
