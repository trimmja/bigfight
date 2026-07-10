import * as THREE from 'three';
import { HEAL_ORB_AMOUNT, PLAYER_STOCKS, RAGE_MULT, RESPAWN_INVULN, SHIELD_HITS } from '../config';
import type { IIntentSource } from '../contracts';
import type { AttackDef, CharacterDef, PowerupDef, WeaponDef } from '../data/types';
import { simPhase } from '../net/simPhase';
import type { SimRegistry, StateIO } from '../net/snapshots';
import { WEAPONS } from '../data/weapons';
import { buildCharacterRig } from '../rigs/characterBuilders';
import { buildWeaponModel } from '../rigs/weaponBuilders';
import { makeToonMaterial } from '../render/toon';
import type { WorldCtx } from './Entity';
import { Fighter } from './Fighter';

const NO_HITBOX = { x: 0, y: 0, w: 0, h: 0 };
const SHIELD_GEOMETRY = new THREE.SphereGeometry(1, 24, 16);

/** Model-only stub for the hammer-mode visual (never equipped as a weapon). */
const GIANT_HAMMER_MODEL_STUB: WeaponDef = {
  id: 'powerupGiantHammer',
  name: 'Giant Hammer',
  tagline: 'SMASH.',
  category: 'melee',
  ability: {
    id: 'powerupGiantHammerSlam',
    damage: 0,
    baseKb: 0,
    kbGrowth: 0,
    angleDeg: 0,
    windup: 0,
    active: 0,
    recover: 0,
    hitbox: NO_HITBOX,
    sfx: 'slash',
    poseId: 'slam',
  },
  cooldown: 1,
  recipe: {},
  model: 'thunderHammer',
  color: 0xffe94a,
};

/** The relentless auto-swing (Smash Bros hammer): fast loop, huge launcher. */
const HAMMER_SWING: AttackDef = {
  id: 'powerupHammerSwing',
  damage: 15,
  baseKb: 11,
  kbGrowth: 0.2,
  angleDeg: 60,
  windup: 0.09,
  active: 0.1,
  recover: 0.09,
  hitbox: { x: 1.05, y: 0.9, w: 2.2, h: 1.8 },
  sfx: 'slash',
  poseId: 'slam',
};

const FREEZE_RAY_WEAPON: WeaponDef = {
  id: 'powerupFreezeRay',
  name: 'Freeze Ray',
  tagline: 'Temporary freeze beam.',
  category: 'magic',
  ability: {
    id: 'powerupFreezeRayBolt',
    damage: 6,
    baseKb: 3,
    kbGrowth: 0.04,
    angleDeg: 18,
    windup: 0.06,
    active: 0.04,
    recover: 0.12,
    hitbox: NO_HITBOX,
    sfx: 'magic',
    poseId: 'shoot',
    freezeTime: 1.8,
    projectile: {
      id: 'powerupFreezeRayProjectile',
      speed: 23,
      angleDeg: 0,
      gravityScale: 0,
      lifetime: 1.7,
      radius: 0.26,
      visual: 'orb',
      color: 0x9df3ff,
      piercing: true,
    },
  },
  cooldown: 0.8,
  recipe: {},
  model: 'freezeWand',
  color: 0x9df3ff,
};

export class Player extends Fighter {
  stocks = PLAYER_STOCKS;
  /** Match slot (0-3) — KO attribution + identity. Set once at match setup. */
  slotIndex = -1;

  private shieldTimer = 0;
  private hammerTimer = 0;
  private hammerPulse = 0;
  private hammerModel: THREE.Group | null = null;
  private rageTimer = 0;
  private ragePulseTime = 0;
  private temporaryWeaponTimer = 0;
  private restoreWeapon: WeaponDef | null = null;
  private shieldMesh: THREE.Mesh | null = null;
  private shieldMaterial: THREE.MeshToonMaterial | null = null;
  /** Which weapon the HELD MODEL currently shows (view state, for reconcile). */
  private viewWeaponId: string | null = null;

  constructor(def: CharacterDef, private readonly input: IIntentSource) {
    super(def, 'player', buildCharacterRig(def));
  }

  override equipWeapon(weapon: WeaponDef, model: THREE.Group): void {
    super.equipWeapon(weapon, model);
    this.viewWeaponId = weapon.id;
  }

  override update(ctx: WorldCtx, dt: number): void {
    const state = this.input.state;
    this.intents.moveX = state.moveX;
    this.intents.moveY = state.moveY;
    this.intents.jumpPressed = state.jumpPressed;
    this.intents.attackPressed = state.attackPressed;
    this.intents.weaponPressed = state.weaponPressed;
    this.updatePowerupTimers(dt);

    // HAMMER MODE (Smash Bros style): relentless auto-swinging; manual
    // attacks and weapon abilities are locked out; you steer the rampage.
    if (this.hammerTimer > 0 && this.hitstopTimer <= 0) {
      this.intents.attackPressed = false;
      this.intents.weaponPressed = false;
      if (
        this.state === 'idle' ||
        this.state === 'run' ||
        this.state === 'jump' ||
        this.state === 'fall' ||
        (this.state === 'attack' && this.currentAttack === null)
      ) {
        this.startCustomAttack(HAMMER_SWING);
      }
      // Danger flash: pulse red the whole time (view-only pacing).
      if (!simPhase.resimulating) {
        this.hammerPulse += dt;
        if (this.hammerPulse >= 0.16) {
          this.hammerPulse = 0;
          this.rig.flashColor(0xff3030, 0.09);
        }
      }
    }

    super.update(ctx, dt);
    if (!simPhase.resimulating) {
      this.updateShieldVisual(dt);
      this.updateRagePulse(dt);
    }
  }

  respawn(ctx: WorldCtx, offsetX = 0): void {
    const point = ctx.stage.respawnPoint;
    this.koReset(offsetX === 0 ? point : { x: point.x + offsetX, y: point.y });
    this.invulnTimer = RESPAWN_INVULN;
    this.damage = 0;
  }

  override digestInto(out: number[]): void {
    super.digestInto(out);
    out.push(
      this.stocks,
      this.shieldTimer,
      this.hammerTimer,
      this.rageTimer,
      this.temporaryWeaponTimer,
      this.restoreWeapon ? 1 : 0,
      this.autoSwingMove ? 1 : 0,
    );
  }

  override syncState(io: StateIO, registry: SimRegistry): void {
    super.syncState(io, registry);
    this.stocks = io.i32(this.stocks);
    this.shieldTimer = io.f64(this.shieldTimer);
    this.hammerTimer = io.f64(this.hammerTimer);
    this.rageTimer = io.f64(this.rageTimer);
    this.temporaryWeaponTimer = io.f64(this.temporaryWeaponTimer);
    const equippedCode = io.i32(weaponCodeOf(this.weaponDef));
    if (io.reading) this.setEquippedWeaponSim(weaponForCode(equippedCode));
    const restoreCode = io.i32(weaponCodeOf(this.restoreWeapon));
    if (io.reading) this.restoreWeapon = weaponForCode(restoreCode);
  }

  override reconcileView(): void {
    super.reconcileView();
    // Held model must match the restored equipped weapon (cooldown untouched).
    const desired = this.weaponDef;
    if (desired && this.viewWeaponId !== desired.id) {
      const cooldown = this.weaponCooldown;
      this.equipWeapon(desired, buildWeaponModel(desired));
      this.weaponCooldown = cooldown;
    }
    // Hammer-mode override model follows the restored timer.
    if (this.hammerTimer > 0) this.startHammerMode(this.hammerTimer);
    else if (this.autoSwingMove === false && this.hammerTimer === 0) this.setWeaponModelOverride(null);
  }

  protected override attackForCode(code: number): AttackDef | null {
    if (code === 4) return HAMMER_SWING; // custom attack = giant-hammer swing
    return super.attackForCode(code);
  }

  applyPowerup(def: PowerupDef): void {
    switch (def.id) {
      case 'healOrb':
        this.damage = Math.max(0, this.damage - HEAL_ORB_AMOUNT);
        this.rig.flashColor(def.color, 0.18);
        break;
      case 'shieldBubble':
        this.shieldHits = SHIELD_HITS;
        this.shieldTimer = def.duration;
        this.ensureShieldMesh();
        this.rig.flashColor(def.color, 0.2);
        break;
      case 'rageMode':
        this.attackMult = RAGE_MULT;
        this.rageTimer = def.duration;
        this.ragePulseTime = 0;
        this.rig.flashColor(def.color, 0.18);
        break;
      case 'giantHammer':
        this.startHammerMode(def.duration);
        this.rig.flashColor(def.color, 0.18);
        break;
      case 'freezeRay':
        this.activateTemporaryWeapon(FREEZE_RAY_WEAPON, def.duration);
        this.rig.flashColor(def.color, 0.18);
        break;
    }
  }

  override dispose(): void {
    this.disposeShieldMesh();
    super.dispose();
  }

  private startHammerMode(duration: number): void {
    this.hammerTimer = duration;
    this.autoSwingMove = true;
    if (!this.hammerModel) {
      this.hammerModel = buildWeaponModel(GIANT_HAMMER_MODEL_STUB);
      this.hammerModel.scale.setScalar(1.6);
    }
    this.setWeaponModelOverride(this.hammerModel);
  }

  private endHammerMode(): void {
    this.autoSwingMove = false;
    this.setWeaponModelOverride(null);
    // Let the current swing finish naturally; no new ones start.
  }

  private updatePowerupTimers(dt: number): void {
    if (this.hammerTimer > 0) {
      this.hammerTimer = Math.max(0, this.hammerTimer - dt);
      if (this.hammerTimer === 0) this.endHammerMode();
    }
    if (this.rageTimer > 0) {
      this.rageTimer = Math.max(0, this.rageTimer - dt);
      if (this.rageTimer === 0) this.attackMult = 1;
    }
    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
      if (this.shieldTimer === 0) this.shieldHits = 0;
    }
    if (this.temporaryWeaponTimer > 0) {
      this.temporaryWeaponTimer = Math.max(0, this.temporaryWeaponTimer - dt);
      if (this.temporaryWeaponTimer === 0) this.restoreTemporaryWeapon();
    }
  }

  private updateShieldVisual(dt: number): void {
    const shield = this.shieldMesh;
    if (!shield) return;
    const active = this.shieldHits > 0 && this.shieldTimer > 0 && this.alive;
    shield.visible = active;
    if (!active) return;
    const pulse = 1 + Math.sin(this.shieldTimer * 9) * 0.035; // det-ok: view-only
    shield.scale.set(1.2 * pulse, 1.55 * pulse, 1.2 * pulse);
    shield.rotation.y += dt * 1.4;
  }

  private updateRagePulse(dt: number): void {
    if (this.rageTimer <= 0) return;
    this.ragePulseTime += dt;
    if (Math.sin(this.ragePulseTime * 11) > 0.9) { // det-ok: view-only flash
      this.rig.flashColor(0xff4f5e, 0.045);
    }
  }

  private activateTemporaryWeapon(weapon: WeaponDef, duration: number): void {
    if (!this.restoreWeapon) this.restoreWeapon = this.weaponDef;
    this.temporaryWeaponTimer = duration;
    this.equipWeapon(weapon, buildWeaponModel(weapon));
    this.weaponCooldown = 0;
  }

  private restoreTemporaryWeapon(): void {
    const restore = this.restoreWeapon;
    this.restoreWeapon = null;
    if (!restore) return;
    this.equipWeapon(restore, buildWeaponModel(restore));
    this.weaponCooldown = 0;
  }

  private ensureShieldMesh(): void {
    if (this.shieldMesh) {
      this.shieldMesh.visible = true;
      return;
    }
    this.shieldMaterial = makeToonMaterial(0x8ff6ff);
    this.shieldMaterial.transparent = true;
    this.shieldMaterial.opacity = 0.28;
    this.shieldMaterial.depthWrite = false;
    this.shieldMesh = new THREE.Mesh(SHIELD_GEOMETRY, this.shieldMaterial);
    this.shieldMesh.position.y = this.def.proportions.height * 0.53;
    this.shieldMesh.renderOrder = 2;
    this.rig.root.add(this.shieldMesh);
  }

  private disposeShieldMesh(): void {
    this.shieldMesh?.removeFromParent();
    this.shieldMaterial?.dispose();
    this.shieldMesh = null;
    this.shieldMaterial = null;
  }
}

/** Weapon wire codes: -1 none · -2 the powerup freeze ray · else WEAPONS index. */
function weaponCodeOf(weapon: WeaponDef | null): number {
  if (!weapon) return -1;
  if (weapon.id === FREEZE_RAY_WEAPON.id) return -2;
  for (let i = 0; i < WEAPONS.length; i += 1) {
    if (WEAPONS[i]!.id === weapon.id) return i;
  }
  return -1;
}

function weaponForCode(code: number): WeaponDef | null {
  if (code === -2) return FREEZE_RAY_WEAPON;
  if (code < 0) return null;
  return WEAPONS[code] ?? null;
}
