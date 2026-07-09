import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { EnemyDef } from '../data/types';
import { makeToonMaterial } from '../render/toon';
import { FighterRig } from './FighterRig';
import type { JointName, Pose } from './poses';

export interface MobRig {
  root: THREE.Group;
  joints?: Partial<Record<JointName, THREE.Object3D>>;
  setPose(pose: Pose, blend: number): void;
  setFacing(f: 1 | -1): void;
  setShadow(groundLocalY: number | null, airborneT: number): void;
  flashColor(color: number, seconds: number): void;
  setGhostOpacity(a: number): void;
  update(dt: number): void;
  dispose(): void;
}

type TintMaterial = THREE.MeshToonMaterial;
type TintEntry = { material: TintMaterial; base: THREE.Color; opacity: number };
type MaterialEntry = { material: THREE.Material; opacity: number };

const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 4, 12);
const CONE = new THREE.ConeGeometry(1, 1, 18);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 24);
const SHADOW_CIRCLE = new THREE.CircleGeometry(1, 24);

const DARK = 0x242633;
const BONE_WHITE = 0xfff6df;
const CLUB_WOOD = 0xb86f35;
const CAPTAIN_RED = 0xff4b4b;

export function buildEnemyRig(def: EnemyDef): MobRig {
  switch (def.builder) {
    case 'skeleton':
      return buildSkeleton(def);
    case 'captain':
      return buildCaptain(def);
    case 'slime':
      return new SlimeRig(def);
    case 'ghost':
      return new GhostRig(def);
    case 'miniEagle':
      return new MiniEagleRig(def);
  }
}

class GarnishedRig implements MobRig {
  readonly root: THREE.Group;
  readonly joints: Record<JointName, THREE.Object3D>;

  private readonly materials: MaterialEntry[] = [];
  private readonly tintMaterials: TintEntry[] = [];
  private readonly flash = new THREE.Color(0xffffff);
  private flashTimer = 0;
  private flashDuration = 0;
  private ghostAlpha = 1;

  constructor(private readonly base: FighterRig) {
    this.root = base.root;
    this.joints = base.joints;
  }

  makeToon(color: number): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    this.materials.push({ material, opacity: material.opacity });
    this.tintMaterials.push({ material, base: material.color.clone(), opacity: material.opacity });
    return material;
  }

  setPose(pose: Pose, blend: number): void {
    this.base.setPose(pose, blend);
  }

  setFacing(f: 1 | -1): void {
    this.base.setFacing(f);
  }

  setShadow(groundLocalY: number | null, airborneT: number): void {
    this.base.setShadow(groundLocalY, airborneT);
  }

  flashColor(color: number, seconds: number): void {
    this.base.flashColor(color, seconds);
    this.flash.setHex(color, THREE.SRGBColorSpace);
    this.flashTimer = Math.max(0, seconds);
    this.flashDuration = Math.max(0.0001, seconds);
    for (let i = 0; i < this.tintMaterials.length; i += 1) {
      this.tintMaterials[i]!.material.color.copy(this.flash);
    }
  }

  setGhostOpacity(alpha: number): void {
    this.ghostAlpha = clamp(alpha, 0, 1);
    this.base.setGhostOpacity(alpha);
    for (let i = 0; i < this.materials.length; i += 1) {
      const entry = this.materials[i]!;
      entry.material.transparent = this.ghostAlpha < 0.98 || entry.opacity < 0.98;
      entry.material.opacity = entry.opacity * this.ghostAlpha;
      entry.material.depthWrite = this.ghostAlpha >= 0.95;
    }
  }

  update(dt: number): void {
    this.base.update(dt);
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = 1 - this.flashTimer / this.flashDuration;
      for (let i = 0; i < this.tintMaterials.length; i += 1) {
        const entry = this.tintMaterials[i]!;
        entry.material.color.copy(this.flash).lerp(entry.base, t);
      }
      return;
    }
    for (let i = 0; i < this.tintMaterials.length; i += 1) {
      const entry = this.tintMaterials[i]!;
      entry.material.color.copy(entry.base);
      entry.material.opacity = entry.opacity * this.ghostAlpha;
    }
  }

  dispose(): void {
    this.base.dispose();
    for (let i = 0; i < this.materials.length; i += 1) {
      this.materials[i]!.material.dispose();
    }
  }
}

abstract class CustomMobRig implements MobRig {
  readonly root = new THREE.Group();

  protected readonly bodyRoot = new THREE.Group();
  protected readonly materials: MaterialEntry[] = [];
  protected readonly tintMaterials: TintEntry[] = [];
  protected readonly flash = new THREE.Color(0xffffff);
  protected readonly shadow: THREE.Mesh;
  protected readonly shadowMat: THREE.MeshBasicMaterial;

  private readonly baseShadowX: number;
  private readonly baseShadowY: number;
  private readonly baseShadowOpacity: number;
  private flashTimer = 0;
  private flashDuration = 0;
  private facingTarget: 1 | -1 = 1;
  private facingScale = 1;
  private ghostAlpha = 1;
  private animTime = 0;

  protected constructor(
    shadowX: number,
    shadowY: number,
    shadowOpacity: number,
    private readonly bobAmp: number,
    private readonly bobSpeed: number,
  ) {
    this.baseShadowX = shadowX;
    this.baseShadowY = shadowY;
    this.baseShadowOpacity = shadowOpacity;
    this.root.add(this.bodyRoot);

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x203448,
      transparent: true,
      opacity: shadowOpacity,
      depthWrite: false,
    });
    this.materials.push({ material: this.shadowMat, opacity: shadowOpacity });
    this.shadow = new THREE.Mesh(SHADOW_CIRCLE, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(shadowX, shadowY, 1);
    this.shadow.renderOrder = -1;
    this.root.add(this.shadow);
  }

  setPose(pose: Pose, blend: number): void {
    const torsoZ = pose.torso?.z ?? 0;
    const rootZ = pose.root?.z ?? 0;
    const armLZ = pose.armL?.z ?? 0;
    const armRZ = pose.armR?.z ?? 0;
    const windup = torsoZ > 0.25 || armLZ > 1.4 || armRZ < -0.45 ? 1 : 0;
    const active = torsoZ < -0.22 || rootZ < -0.12 || rootZ > 0.18 || armRZ > 1.2 ? 1 : 0;
    const amount = clamp(blend, 0, 1);
    this.bodyRoot.scale.x = lerp(this.bodyRoot.scale.x, 1 + windup * 0.16 + active * 0.08, amount);
    this.bodyRoot.scale.y = lerp(this.bodyRoot.scale.y, 1 - windup * 0.18 + active * 0.18, amount);
    this.bodyRoot.scale.z = lerp(this.bodyRoot.scale.z, 1 + windup * 0.1, amount);
  }

  setFacing(f: 1 | -1): void {
    this.facingTarget = f;
  }

  setShadow(groundLocalY: number | null, airborneT: number): void {
    if (groundLocalY === null) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    const air = clamp(airborneT, 0, 1);
    const s = 1 - 0.45 * air;
    this.shadow.position.y = groundLocalY + 0.08;
    this.shadow.scale.set(this.baseShadowX * s, this.baseShadowY * s, 1);
    this.shadowMat.opacity = this.baseShadowOpacity * (1 - 0.55 * air) * this.ghostAlpha;
  }

  flashColor(color: number, seconds: number): void {
    this.flash.setHex(color, THREE.SRGBColorSpace);
    this.flashTimer = Math.max(0, seconds);
    this.flashDuration = Math.max(0.0001, seconds);
    for (let i = 0; i < this.tintMaterials.length; i += 1) {
      this.tintMaterials[i]!.material.color.copy(this.flash);
    }
  }

  setGhostOpacity(alpha: number): void {
    this.ghostAlpha = clamp(alpha, 0, 1);
    for (let i = 0; i < this.materials.length; i += 1) {
      const entry = this.materials[i]!;
      entry.material.transparent = this.ghostAlpha < 0.98 || entry.opacity < 0.98;
      entry.material.opacity = entry.material === this.shadowMat
        ? this.shadowMat.opacity
        : entry.opacity * this.ghostAlpha;
      entry.material.depthWrite = this.ghostAlpha >= 0.95 && entry.opacity >= 0.95;
    }
  }

  update(dt: number): void {
    this.animTime += dt;
    this.facingScale = damp(this.facingScale, this.facingTarget, 28, dt);
    this.root.scale.x = this.facingScale;
    this.bodyRoot.position.y = Math.sin(this.animTime * this.bobSpeed) * this.bobAmp;
    this.updateCustom(dt, this.animTime);

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = 1 - this.flashTimer / this.flashDuration;
      for (let i = 0; i < this.tintMaterials.length; i += 1) {
        const entry = this.tintMaterials[i]!;
        entry.material.color.copy(this.flash).lerp(entry.base, t);
      }
      return;
    }
    for (let i = 0; i < this.tintMaterials.length; i += 1) {
      const entry = this.tintMaterials[i]!;
      entry.material.color.copy(entry.base);
      entry.material.opacity = entry.opacity * this.ghostAlpha;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (let i = 0; i < this.materials.length; i += 1) {
      this.materials[i]!.material.dispose();
    }
  }

  protected makeToon(color: number, opacity = 1): THREE.MeshToonMaterial {
    const material = makeToonMaterial(color);
    material.transparent = opacity < 0.98;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.95;
    this.materials.push({ material, opacity });
    this.tintMaterials.push({ material, base: material.color.clone(), opacity });
    return material;
  }

  protected updateCustom(_dt: number, _time: number): void {}
}

class SlimeRig extends CustomMobRig {
  constructor(def: EnemyDef) {
    const height = def.proportions.height;
    const width = height * def.proportions.bulk * 0.62;
    super(width * 1.25, width * 0.78, 0.25, 0.035 * height, 3.2);

    const body = this.makeToon(def.palette.core);
    const white = this.makeToon(0xffffff);
    const dark = this.makeToon(DARK);
    const shine = this.makeToon(def.palette.accent, 0.78);
    const centerY = height * 0.48;

    addBall(this.bodyRoot, body, width, height * 0.45, width * 0.86, 0, centerY, 0);
    addBall(this.bodyRoot, shine, width * 0.38, height * 0.16, width * 0.28, width * 0.44, centerY + height * 0.14, -width * 0.2);
    for (const side of [-1, 1] as const) {
      addBall(this.bodyRoot, white, width * 0.22, height * 0.18, width * 0.13, width * 0.72, centerY + height * 0.12, side * width * 0.28);
      addBall(this.bodyRoot, dark, width * 0.09, height * 0.08, width * 0.06, width * 0.87, centerY + height * 0.11, side * width * 0.28);
    }
    addBall(this.bodyRoot, dark, width * 0.34, height * 0.035, width * 0.07, width * 0.82, centerY - height * 0.12, 0);
  }
}

class GhostRig extends CustomMobRig {
  constructor(def: EnemyDef) {
    const height = def.proportions.height;
    const width = height * def.proportions.bulk * 0.34;
    super(width * 1.25, width * 0.72, 0.14, 0.08, 2.5);

    const body = this.makeToon(def.palette.core, 0.85);
    const shade = this.makeToon(def.palette.glow, 0.75);
    const dark = this.makeToon(DARK, 0.92);
    const bodyY = height * 0.7;

    addBall(this.bodyRoot, body, width * 1.12, height * 0.36, width, 0, bodyY, 0);
    const skirt = new THREE.Mesh(CONE, shade);
    skirt.scale.set(width * 1.08, height * 0.34, width * 1.02);
    skirt.position.set(0, height * 0.34, 0);
    skirt.rotation.z = Math.PI;
    this.bodyRoot.add(skirt);
    for (let i = 0; i < 5; i += 1) {
      const z = (i - 2) * width * 0.38;
      const y = height * 0.23 + (i % 2) * height * 0.025;
      addBall(this.bodyRoot, body, width * 0.22, height * 0.09, width * 0.2, 0, y, z);
    }
    addBall(this.bodyRoot, body, width * 0.24, height * 0.14, width * 0.18, width * 0.36, height * 0.58, -width * 0.95);
    addBall(this.bodyRoot, body, width * 0.24, height * 0.14, width * 0.18, width * 0.36, height * 0.58, width * 0.95);
    for (const side of [-1, 1] as const) {
      addBall(this.bodyRoot, dark, width * 0.13, height * 0.16, width * 0.06, width * 0.9, bodyY + height * 0.02, side * width * 0.28);
    }
  }
}

class MiniEagleRig extends CustomMobRig {
  private readonly wingL: THREE.Object3D;
  private readonly wingR: THREE.Object3D;

  constructor(def: EnemyDef) {
    const height = def.proportions.height;
    const width = height * def.proportions.bulk * 0.32;
    super(width * 1.2, width * 0.7, 0.18, 0.06, 4.2);

    const body = this.makeToon(def.palette.core);
    const wing = this.makeToon(def.palette.glow);
    const accent = this.makeToon(def.palette.accent);
    const orange = this.makeToon(0xff8a1e);
    const dark = this.makeToon(DARK);
    const white = this.makeToon(0xffffff);
    const bodyY = height * 0.5;

    addBall(this.bodyRoot, body, width * 0.9, height * 0.26, width * 0.75, 0, bodyY, 0);
    addBall(this.bodyRoot, accent, width * 0.66, height * 0.24, width * 0.6, width * 0.34, bodyY + height * 0.16, 0);

    const beak = new THREE.Mesh(CONE, orange);
    beak.scale.set(width * 0.18, width * 0.42, width * 0.18);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(width * 0.9, bodyY + height * 0.17, 0);
    this.bodyRoot.add(beak);

    this.wingL = addBall(this.bodyRoot, wing, width * 0.16, height * 0.13, width * 0.78, -width * 0.1, bodyY + height * 0.03, -width * 0.78);
    this.wingR = addBall(this.bodyRoot, wing, width * 0.16, height * 0.13, width * 0.78, -width * 0.1, bodyY + height * 0.03, width * 0.78);

    const tail = new THREE.Mesh(CONE, wing);
    tail.scale.set(width * 0.18, width * 0.36, width * 0.18);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-width * 0.78, bodyY, 0);
    this.bodyRoot.add(tail);

    for (const side of [-1, 1] as const) {
      addBall(this.bodyRoot, white, width * 0.14, height * 0.12, width * 0.07, width * 0.64, bodyY + height * 0.22, side * width * 0.18);
      addBall(this.bodyRoot, dark, width * 0.055, height * 0.055, width * 0.035, width * 0.75, bodyY + height * 0.22, side * width * 0.18);
    }
  }

  protected override updateCustom(_dt: number, time: number): void {
    const flap = Math.sin(time * 14) * 0.75;
    this.wingL.rotation.x = -0.45 + flap;
    this.wingR.rotation.x = 0.45 - flap;
    this.wingL.rotation.z = -0.2 + flap * 0.25;
    this.wingR.rotation.z = 0.2 - flap * 0.25;
  }
}

function buildSkeleton(def: EnemyDef): MobRig {
  const base = new FighterRig({ palette: def.palette, proportions: def.proportions });
  const rig = new GarnishedRig(base);
  const dark = rig.makeToon(DARK);
  const bone = rig.makeToon(BONE_WHITE);
  const wood = rig.makeToon(CLUB_WOOD);
  const headR = def.proportions.height * 0.17 * def.proportions.headSize * 0.62;
  const bulk = def.proportions.bulk;

  for (const side of [-1, 1] as const) {
    addBall(base.joints.head, dark, headR * 0.22, headR * 0.28, headR * 0.08, headR * 1.08, headR * 0.08, side * headR * 0.2);
  }
  for (let i = 0; i < 3; i += 1) {
    const rib = new THREE.Mesh(CAPSULE, bone);
    rib.scale.set(0.018 * bulk, 0.18 * bulk, 0.018 * bulk);
    rib.rotation.x = Math.PI / 2;
    rib.position.set(0.23 * bulk, 0.34 - i * 0.12, 0);
    base.joints.torso.add(rib);
  }
  addClub(base.weaponSocket, wood, bone, 1);
  return rig;
}

function buildCaptain(def: EnemyDef): MobRig {
  const base = new FighterRig({ palette: def.palette, proportions: def.proportions });
  const rig = new GarnishedRig(base);
  const red = rig.makeToon(CAPTAIN_RED);
  const shield = rig.makeToon(def.palette.accent);
  const shieldLip = rig.makeToon(0xffffff);
  const wood = rig.makeToon(CLUB_WOOD);
  const bone = rig.makeToon(BONE_WHITE);
  const headR = def.proportions.height * 0.17 * def.proportions.headSize * 0.62;

  const hat = new THREE.Mesh(CONE, red);
  hat.scale.set(headR * 0.58, headR * 1.05, headR * 0.58);
  hat.position.set(0, headR * 0.85, 0);
  base.joints.head.add(hat);

  const disc = new THREE.Mesh(CYLINDER, shield);
  disc.scale.set(0.34, 0.07, 0.34);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0.02, -0.22, -0.12);
  base.joints.foreArmL.add(disc);
  const boss = new THREE.Mesh(CYLINDER, shieldLip);
  boss.scale.set(0.18, 0.08, 0.18);
  boss.rotation.x = Math.PI / 2;
  boss.position.copy(disc.position);
  boss.position.z -= 0.04;
  base.joints.foreArmL.add(boss);

  addClub(base.weaponSocket, wood, bone, 1.22);
  return rig;
}

function addClub(
  socket: THREE.Object3D,
  wood: THREE.Material,
  bone: THREE.Material,
  scale: number,
): void {
  const handle = new THREE.Mesh(CAPSULE, wood);
  handle.scale.set(0.045 * scale, 0.32 * scale, 0.045 * scale);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.18 * scale, 0, 0);
  socket.add(handle);

  addBall(socket, bone, 0.13 * scale, 0.13 * scale, 0.13 * scale, 0.46 * scale, 0, 0);
  addBall(socket, bone, 0.085 * scale, 0.085 * scale, 0.085 * scale, 0.57 * scale, 0.08 * scale, 0.04 * scale);
}

function addBall(
  parent: THREE.Object3D,
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(SPHERE, material);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
