import * as THREE from 'three';
import { LAUNCH_THRESHOLD } from '../config';
import {
  ABILITY_AIR_COOLDOWN_MIN,
  ABILITY_COOLDOWN_SCALE,
  ABILITY_HITBOX_SCALE,
  ABILITY_WINDUP_CAP,
  AIR_CONTROL,
  DROP_THROUGH_TIME,
  FRICTION_GROUND,
  JETPACK_FUEL_MAX,
  JETPACK_REFUEL,
  LANDING_LAG,
  SPECIAL_DEADZONE,
  TUMBLE_AIR_CONTROL,
} from '../config';
import type { ActiveHitbox, HitResult, Hurtbox, Rect } from '../combat/types';
import { events } from '../core/events';
import { clamp } from '../core/math';
import { hypot } from '../core/simmath';
import type {
  AbilityDef,
  AbilityEffect,
  AttackDef,
  CharacterDef,
  Faction,
  Facing,
  FighterStateName,
  ProjectileDef,
  Vec2,
  WeaponDef,
} from '../data/types';
import { simPhase } from '../net/simPhase';
import { netIdOf, restoreIdSet, type SimRegistry, type StateIO } from '../net/snapshots';
import { Body } from '../physics/Body';
import { FighterRig, type Rig } from '../rigs/FighterRig';
import {
  poseAttack,
  poseFall,
  poseHit,
  poseIdle,
  poseJetpack,
  poseJump,
  poseKO,
  poseLanding,
  poseRun,
  poseTumble,
} from '../rigs/poses';
import type { TrailHandle } from '../render/Trails';
import { Entity, type WorldCtx } from './Entity';

export interface FighterIntent {
  moveX: number;
  moveY: number;
  jumpPressed: boolean;
  attackPressed: boolean;
  weaponPressed: boolean;
  /** Level-triggered Special/PWR — needed for held abilities (jetpack). */
  weaponHeld: boolean;
  /** Mobile: explicit ability slot (-1 none, 0-3); overrides direction classify. */
  specialSlot: number;
  /** Mobile: edge — the ability slot became active this step. */
  specialSlotPressed: boolean;
}

/** Directional-special slot order: index === encoded slot (neutral/side/up/down). */
const ABILITY_SLOT_KEYS = ['neutral', 'side', 'up', 'down'] as const;
/** Self-buff kinds as small ints for snapshotting. */
const BUFF_NONE = 0;
const BUFF_ARMOR = 1;
const BUFF_CLOAK = 2;
const BUFF_REFLECT = 3;
const BUFF_RAGE = 4;

const HURTBOX_PAD_X = 0.02;
const ATTACK_CHAIN_RESET = 0.4;
const ATTACK_STOP_ACCEL = FRICTION_GROUND * 2.4;
const POSE_DAMPING = 24;

/** Stable numeric ids for FighterStateName — replay digests + net snapshots. */
const STATE_IDS: Record<FighterStateName, number> = {
  idle: 0,
  run: 1,
  jump: 2,
  fall: 3,
  attack: 4,
  weaponAbility: 5,
  hitstun: 6,
  launched: 7,
  landing: 8,
  ko: 9,
  respawning: 10,
};
const STATE_NAMES: readonly FighterStateName[] = [
  'idle',
  'run',
  'jump',
  'fall',
  'attack',
  'weaponAbility',
  'hitstun',
  'launched',
  'landing',
  'ko',
  'respawning',
];

/**
 * currentAttack wire codes: -1 none · 0-2 combo · 3 weapon ability · 4 custom ·
 * 10-13 signature ability slots (neutral/side/up/down).
 */
const ATTACK_CODE_NONE = -1;
const ATTACK_CODE_WEAPON = 3;
const ATTACK_CODE_CUSTOM = 4;
const ATTACK_CODE_ABILITY_BASE = 10;

export class Fighter extends Entity {
  readonly def: CharacterDef;
  readonly faction: Faction;
  /** Combat gate (see combat/types.ts). Set once at match setup via setTeam. */
  teamId: number;
  /** Match slot for players (-1 for mobs/bosses) — KO attribution. */
  slotIndex = -1;
  readonly rig: Rig;
  readonly hurtbox: Hurtbox;
  readonly intents: FighterIntent = {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    attackPressed: false,
    weaponPressed: false,
    weaponHeld: false,
    specialSlot: -1,
    specialSlotPressed: false,
  };

  damage = 0;
  damageScale = 1;
  kbImmune = false;
  attackMult = 1;
  shieldHits = 0;
  facing: Facing = 1;
  state: FighterStateName = 'idle';
  stateTime = 0;
  jumpsUsed = 0;
  hitstopTimer = 0;
  invulnTimer = 0;
  comboIndex = 0;
  comboQueued = false;
  currentAttack: AttackDef | null = null;
  attackPhaseTime = 0;
  weaponCooldown = 0;

  // ---- signature abilities (directional specials) ----
  /** Active ability slot (0-3), or -1 when the current action isn't an ability. */
  currentAbilitySlot = -1;
  /** Per-slot cooldowns, seconds. */
  readonly abilityCooldowns: [number, number, number, number] = [0, 0, 0, 0];
  /** Jetpack fuel (Comet); refuels on the ground. */
  thrustFuel = JETPACK_FUEL_MAX;
  /** Self-buff (armor/cloak/reflect/rage) timer + kind. */
  buffTimer = 0;
  buffKind = BUFF_NONE;
  /** Movement-speed multiplier from a buff (cloak) — applied to run/air move. */
  speedMult = 1;
  /** True between a `slam` cast in the air and its landing shockwave. */
  meteorActive = false;
  private abilityEffectFired = false;
  private jetpackSfxTimer = 0;
  /** View-only: true on frames the jetpack is thrusting (drives the fly pose). */
  private flying = false;

  private readonly hurtRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly activeRect: Rect = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private readonly alreadyHit = new Set<object>();
  private readonly activeHitbox: ActiveHitbox;
  private readonly projectileAttackScratch: AttackDef = {
    id: 'projectileScratch',
    damage: 0,
    baseKb: 0,
    kbGrowth: 0,
    angleDeg: 0,
    windup: 0,
    active: 0,
    recover: 0,
    hitbox: { x: 0, y: 0, w: 0, h: 0 },
    sfx: 'shoot',
    poseId: 'shoot',
  };
  /** Hammer powerup: keep running while auto-swinging. */
  autoSwingMove = false;

  private trail: TrailHandle | null = null;
  private equippedWeapon: WeaponDef | null = null;
  private weaponModel: THREE.Group | null = null;
  private modelOverride: THREE.Group | null = null;
  private currentAttackIsWeapon = false;
  private projectileFired = false;
  private slashWaveFired = false;
  private comboResetTimer = 0;
  private wasGroundedForStep = false;
  private hitFlashTimer = 0;
  private freezeTimer = 0;

  constructor(def: CharacterDef, faction: Faction, customRig?: Rig) {
    const body = new Body(0.42 * def.proportions.bulk, def.proportions.height);
    const rig = customRig ?? new FighterRig({ palette: def.palette, proportions: def.proportions });
    super(body, rig.root);
    this.def = def;
    this.faction = faction;
    this.teamId = faction === 'player' ? 1 : 0;
    this.rig = rig;
    this.hurtbox = {
      owner: this,
      faction,
      enabled: true,
      rect: () => this.readHurtbox(),
    };
    this.activeHitbox = {
      attacker: this,
      def: def.combo[0],
      faction,
      teamId: this.teamId,
      alreadyHit: this.alreadyHit,
      worldRect: () => this.readAttackBox(),
    };
  }

  /** Assign the combat team (FFA slots / 2v2 teams). Call at match setup only. */
  setTeam(teamId: number): void {
    this.teamId = teamId;
    this.activeHitbox.teamId = teamId;
  }

  /**
   * Rollback snapshots: one method both writes and reads (StateIO echoes on
   * write, substitutes on read) — field-order bugs are impossible. Subclasses
   * extend AFTER super. View side effects are re-applied by reconcileView().
   */
  syncState(io: StateIO, registry: SimRegistry): void {
    this.alive = io.bool(this.alive);
    this.body.syncState(io);
    // Intents are read EARLY in the frame (respawn-cloud drop checks, DI) —
    // before this frame's refresh — so the previous frame's values are state.
    this.intents.moveX = io.f64(this.intents.moveX);
    this.intents.moveY = io.f64(this.intents.moveY);
    this.intents.jumpPressed = io.bool(this.intents.jumpPressed);
    this.intents.attackPressed = io.bool(this.intents.attackPressed);
    this.intents.weaponPressed = io.bool(this.intents.weaponPressed);
    this.intents.weaponHeld = io.bool(this.intents.weaponHeld);
    this.intents.specialSlot = io.i32(this.intents.specialSlot);
    this.intents.specialSlotPressed = io.bool(this.intents.specialSlotPressed);
    this.damage = io.f64(this.damage);
    this.damageScale = io.f64(this.damageScale);
    this.kbImmune = io.bool(this.kbImmune);
    this.attackMult = io.f64(this.attackMult);
    this.shieldHits = io.i32(this.shieldHits);
    this.facing = io.i32(this.facing) as Facing;
    this.state = STATE_NAMES[io.i32(STATE_IDS[this.state])] ?? 'idle';
    this.stateTime = io.f64(this.stateTime);
    this.jumpsUsed = io.i32(this.jumpsUsed);
    this.hitstopTimer = io.f64(this.hitstopTimer);
    this.invulnTimer = io.f64(this.invulnTimer);
    this.comboIndex = io.i32(this.comboIndex);
    this.comboQueued = io.bool(this.comboQueued);
    const attackCode = io.i32(this.encodeAttack());
    if (io.reading) this.currentAttack = this.attackForCode(attackCode);
    this.currentAttackIsWeapon = io.bool(this.currentAttackIsWeapon);
    this.attackPhaseTime = io.f64(this.attackPhaseTime);
    this.weaponCooldown = io.f64(this.weaponCooldown);
    this.abilityCooldowns[0] = io.f64(this.abilityCooldowns[0]);
    this.abilityCooldowns[1] = io.f64(this.abilityCooldowns[1]);
    this.abilityCooldowns[2] = io.f64(this.abilityCooldowns[2]);
    this.abilityCooldowns[3] = io.f64(this.abilityCooldowns[3]);
    this.thrustFuel = io.f64(this.thrustFuel);
    this.buffTimer = io.f64(this.buffTimer);
    this.buffKind = io.i32(this.buffKind);
    this.speedMult = io.f64(this.speedMult);
    this.meteorActive = io.bool(this.meteorActive);
    this.abilityEffectFired = io.bool(this.abilityEffectFired);
    this.projectileFired = io.bool(this.projectileFired);
    this.slashWaveFired = io.bool(this.slashWaveFired);
    this.comboResetTimer = io.f64(this.comboResetTimer);
    this.freezeTimer = io.f64(this.freezeTimer);
    this.autoSwingMove = io.bool(this.autoSwingMove);
    this.wasGroundedForStep = io.bool(this.wasGroundedForStep);
    const hitIds = io.idList(() => {
      const ids: number[] = [];
      for (const obj of this.alreadyHit) {
        const id = netIdOf(obj);
        if (id >= 0) ids.push(id);
      }
      return ids;
    });
    if (io.reading) restoreIdSet(this.alreadyHit, hitIds, registry);
  }

  /** Post-rollback view repair: visibility + transform snap (pose follows). */
  reconcileView(): void {
    this.group.visible = this.alive;
    this.syncGroupToBody();
  }

  private encodeAttack(): number {
    const attack = this.currentAttack;
    if (!attack) return ATTACK_CODE_NONE;
    if (this.currentAbilitySlot >= 0) return ATTACK_CODE_ABILITY_BASE + this.currentAbilitySlot;
    for (let i = 0; i < this.def.combo.length; i += 1) {
      if (this.def.combo[i] === attack) return i;
    }
    if (this.equippedWeapon && attack === this.equippedWeapon.ability) return ATTACK_CODE_WEAPON;
    return ATTACK_CODE_CUSTOM;
  }

  /** Custom attacks (code 4) resolve in subclasses (Player: giant hammer). */
  protected attackForCode(code: number): AttackDef | null {
    if (code >= ATTACK_CODE_ABILITY_BASE) {
      const slot = code - ATTACK_CODE_ABILITY_BASE;
      this.currentAbilitySlot = slot;
      return this.abilityAttackForSlot(slot);
    }
    this.currentAbilitySlot = -1;
    if (code === ATTACK_CODE_NONE) return null;
    if (code >= 0 && code < this.def.combo.length) return this.def.combo[code] ?? null;
    if (code === ATTACK_CODE_WEAPON) return this.equippedWeapon?.ability ?? null;
    return this.def.combo[0] ?? null;
  }

  /** The AbilityDef for a directional slot (0=neutral…3=down), or null. */
  private abilityDefForSlot(slot: number): AbilityDef | null {
    const key = ABILITY_SLOT_KEYS[slot];
    if (!key) return null;
    return this.def.abilities?.[key] ?? null;
  }

  private abilityAttackForSlot(slot: number): AttackDef | null {
    return this.abilityDefForSlot(slot)?.attack ?? null;
  }

  /** Sim-only weapon assignment (rollback restore — no model work here). */
  protected setEquippedWeaponSim(weapon: WeaponDef | null): void {
    this.equippedWeapon = weapon;
  }

  /**
   * True while a temporary POWERUP weapon (e.g. freeze ray) is active — it takes
   * the neutral special slot while it lasts. Overridden by Player.
   */
  protected hasPowerupWeapon(): boolean {
    return false;
  }

  /**
   * Append every sim-relevant scalar (replay digests; the field list is the
   * blueprint for net snapshots). Subclasses append AFTER calling super.
   */
  digestInto(out: number[]): void {
    out.push(
      this.alive ? 1 : 0,
      this.body.pos.x,
      this.body.pos.y,
      this.body.vel.x,
      this.body.vel.y,
      this.body.grounded ? 1 : 0,
      this.body.fastFalling ? 1 : 0,
      this.body.dropThroughTimer,
      this.body.noclip ? 1 : 0,
      this.damage,
      this.damageScale,
      this.kbImmune ? 1 : 0,
      this.attackMult,
      this.shieldHits,
      this.facing,
      STATE_IDS[this.state],
      this.stateTime,
      this.jumpsUsed,
      this.hitstopTimer,
      this.invulnTimer,
      this.comboIndex,
      this.comboQueued ? 1 : 0,
      this.currentAttack ? 1 : 0,
      this.attackPhaseTime,
      this.weaponCooldown,
      this.currentAttackIsWeapon ? 1 : 0,
      this.projectileFired ? 1 : 0,
      this.slashWaveFired ? 1 : 0,
      this.comboResetTimer,
      this.freezeTimer,
      this.teamId,
      this.currentAbilitySlot,
      this.abilityCooldowns[0],
      this.abilityCooldowns[1],
      this.abilityCooldowns[2],
      this.abilityCooldowns[3],
      this.thrustFuel,
      this.buffTimer,
      this.buffKind,
      this.speedMult,
      this.meteorActive ? 1 : 0,
      this.abilityEffectFired ? 1 : 0,
    );
  }

  get power(): number {
    return this.def.power;
  }

  get weight(): number {
    return this.def.weight;
  }

  get isInvulnerable(): boolean {
    return this.invulnTimer > 0;
  }

  get diY(): number {
    return clamp(this.intents.moveY, -1, 1);
  }

  get weaponDef(): WeaponDef | null {
    return this.equippedWeapon;
  }

  get weaponCooldownFrac(): number {
    const cooldown = this.equippedWeapon?.cooldown ?? 0;
    return cooldown > 0 ? clamp(this.weaponCooldown / cooldown, 0, 1) : 0;
  }

  /** Mobile ability-button ring fill for a slot: 1 = just used/empty, 0 = ready. */
  abilityCooldownFrac(slot: number): number {
    const ab = this.abilityDefForSlot(slot);
    if (!ab) return 0;
    // Jetpack-style: the ring shows fuel depletion (empty = 1).
    if (ab.holdable) return clamp(1 - this.thrustFuel / JETPACK_FUEL_MAX, 0, 1);
    const cd = ab.cooldown * ABILITY_COOLDOWN_SCALE;
    return cd > 0 ? clamp((this.abilityCooldowns[slot] ?? 0) / cd, 0, 1) : 0;
  }

  update(ctx: WorldCtx, dt: number): void {
    this.flying = false;
    if (this.weaponCooldown > 0) this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    for (let i = 0; i < 4; i += 1) {
      if (this.abilityCooldowns[i]! > 0) this.abilityCooldowns[i] = Math.max(0, this.abilityCooldowns[i]! - dt);
    }
    if (this.buffTimer > 0) {
      this.buffTimer = Math.max(0, this.buffTimer - dt);
      if (this.buffTimer === 0) this.expireBuff();
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    this.wasGroundedForStep = this.body.grounded;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.hurtbox.enabled = !this.isInvulnerable;

    if (this.comboResetTimer > 0) {
      this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
      if (this.comboResetTimer === 0) this.comboIndex = 0;
    }
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    if (this.freezeTimer > 0) {
      this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      this.body.fastFalling = false;
      this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
      this.state = 'hitstun';
      this.stateTime = -this.freezeTimer;
      if (this.freezeTimer > 0) {
        if (!simPhase.resimulating) this.updateVisuals(ctx, dt);
        return;
      }
      this.state = this.body.grounded ? 'idle' : 'fall';
      this.stateTime = 0;
    }

    switch (this.state) {
      case 'idle':
      case 'run':
        this.updateGrounded(ctx, dt);
        break;
      case 'jump':
      case 'fall':
        this.updateAir(ctx, dt);
        break;
      case 'attack':
      case 'weaponAbility':
        this.updateAttack(ctx, dt);
        break;
      case 'hitstun':
        this.updateHitstun(dt);
        break;
      case 'launched':
        this.updateLaunched(ctx, dt);
        break;
      case 'landing':
        this.updateLanding(dt);
        break;
      case 'ko':
      case 'respawning':
        this.stateTime += dt;
        break;
    }

    if (!simPhase.resimulating) this.updateVisuals(ctx, dt);
  }

  afterPhysics(ctx: WorldCtx): void {
    if (this.hitstopTimer > 0) return;

    const landed = !this.wasGroundedForStep && this.body.grounded;
    if (landed) {
      this.jumpsUsed = 0;
      this.body.fastFalling = false;
      // Meteor/slam impact: shockwave both ways the instant we touch down.
      if (this.meteorActive) {
        this.meteorActive = false;
        const slam = this.slamEffect();
        if (slam) this.fireGroundShock(ctx, slam.shockwave, slam.shockAttack);
        if (!simPhase.resimulating) {
          const x = this.body.pos.x;
          const y = this.body.pos.y + 0.15;
          ctx.particles.ring(x, y, this.def.palette.accent, 46, 17); // det-ok: view-only (crater ring)
          ctx.particles.burst(x, y + 0.2, this.def.palette.glow, 60, 11); // det-ok: view-only (debris)
          ctx.particles.burst(x, y, 0xffffff, 24, 15); // det-ok: view-only (flash sparks)
          events.emit('screenShake', { amount: 0.6 });
        }
      }
      if (!simPhase.resimulating) {
        ctx.particles.burst(this.body.pos.x, this.body.pos.y + 0.08, this.def.palette.glow, 8, 3.5);
      }
      if (this.state === 'launched') {
        this.state = 'landing';
        this.stateTime = 0;
        this.trail?.setActive(false);
      } else if (this.state === 'jump' || this.state === 'fall') {
        this.state = Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
        this.stateTime = 0;
      }
    }

    if (
      !this.body.grounded &&
      this.body.vel.y < 0 &&
      (this.state === 'jump' || this.state === 'idle' || this.state === 'run')
    ) {
      this.state = 'fall';
      this.stateTime = 0;
    }
  }

  onHit(result: HitResult): void {
    if (!simPhase.resimulating) this.rig.flashColor(0xffffff, 0.06);
    this.hitFlashTimer = 0.06;
    // Super-armor (armored charges, Light Shield): the damage is already applied
    // by HitResolver — absorb it and keep the current action going.
    if (this.kbImmune) return;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.meteorActive = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.comboResetTimer = 0;
    this.body.fastFalling = false;
    this.state = result.launched ? 'launched' : 'hitstun';
    this.stateTime = -result.hitstun;
    if (result.kb <= LAUNCH_THRESHOLD) {
      this.trail?.setActive(false);
    }
  }

  onDealtHit(_result: HitResult): void {
    if (!simPhase.resimulating) this.rig.flashColor(this.def.palette.accent, 0.035);
  }

  onShieldBlocked(): void {
    if (!simPhase.resimulating) this.rig.flashColor(0x8ff6ff, 0.08);
  }

  applyFreeze(seconds: number): void {
    if (seconds <= 0) return;
    events.emit('shoot', {
      kind: 'freeze',
      pos: { x: this.body.pos.x, y: this.body.pos.y + this.body.height * 0.5 },
    });
    this.freezeTimer = Math.max(this.freezeTimer, seconds);
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.meteorActive = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.body.fastFalling = false;
    this.body.vel.x *= 0.15;
    if (this.body.vel.y > 1) this.body.vel.y = 1;
    this.state = 'hitstun';
    this.stateTime = -this.freezeTimer;
    if (!simPhase.resimulating) this.rig.flashColor(0x9df3ff, seconds);
  }

  equipWeapon(weapon: WeaponDef, model: THREE.Group): void {
    if (this.weaponModel) {
      this.rig.weaponSocket.remove(this.weaponModel);
      disposeWeaponModel(this.weaponModel);
    }
    this.equippedWeapon = weapon;
    this.weaponModel = model;
    if (!this.modelOverride) this.rig.weaponSocket.add(model);
    this.weaponCooldown = Math.min(this.weaponCooldown, weapon.cooldown);
  }

  /**
   * Visually swap the held model WITHOUT touching the equipped weapon
   * (giant-hammer powerup). Pass null to restore the real weapon's model.
   */
  setWeaponModelOverride(model: THREE.Group | null): void {
    if (this.modelOverride) {
      this.rig.weaponSocket.remove(this.modelOverride);
      this.modelOverride = null;
      if (this.weaponModel) this.rig.weaponSocket.add(this.weaponModel);
    }
    if (model) {
      if (this.weaponModel) this.rig.weaponSocket.remove(this.weaponModel);
      this.modelOverride = model;
      this.rig.weaponSocket.add(model);
    }
  }

  /** Trigger an attack outside the combo system (hammer-mode auto swings). */
  startCustomAttack(def: AttackDef): void {
    this.currentAttack = def;
    this.currentAttackIsWeapon = true;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'attack';
    this.alreadyHit.clear();
  }

  private handleFacing2(): void {
    if (this.intents.moveX > 0.15) this.facing = 1;
    if (this.intents.moveX < -0.15) this.facing = -1;
  }

  koReset(pos: Vec2): void {
    this.damage = 0;
    this.damageScale = 1;
    this.kbImmune = false;
    this.shieldHits = 0;
    this.freezeTimer = 0;
    this.alive = true;
    this.group.visible = true;
    this.body.pos.x = pos.x;
    this.body.pos.y = pos.y;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.fastFalling = false;
    this.body.dropThroughTimer = 0;
    this.body.noclip = false;
    this.state = 'idle';
    this.stateTime = 0;
    this.jumpsUsed = 0;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.meteorActive = false;
    this.abilityCooldowns[0] = 0;
    this.abilityCooldowns[1] = 0;
    this.abilityCooldowns[2] = 0;
    this.abilityCooldowns[3] = 0;
    this.thrustFuel = JETPACK_FUEL_MAX;
    this.buffTimer = 0;
    this.buffKind = BUFF_NONE;
    this.speedMult = 1;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.comboIndex = 0;
    this.comboResetTimer = 0;
    this.trail?.setActive(false);
    this.hurtbox.enabled = true;
    this.syncGroupToBody();
  }

  beginKo(): void {
    this.alive = false;
    this.group.visible = false;
    this.hurtbox.enabled = false;
    this.state = 'ko';
    this.stateTime = 0;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.meteorActive = false;
    this.buffTimer = 0;
    this.buffKind = BUFF_NONE;
    this.speedMult = 1;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.damageScale = 1;
    this.kbImmune = false;
    this.shieldHits = 0;
    this.freezeTimer = 0;
    this.body.vel.x = 0;
    this.body.vel.y = 0;
    this.body.noclip = true;
    this.trail?.setActive(false);
  }

  dispose(): void {
    this.trail?.release();
    this.trail = null;
    if (this.weaponModel) {
      this.rig.weaponSocket.remove(this.weaponModel);
      disposeWeaponModel(this.weaponModel);
      this.weaponModel = null;
    }
    this.rig.dispose();
  }

  private updateGrounded(ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    this.body.fastFalling = false;
    this.refuelJetpack(dt);
    this.handleFacing();
    // Special wins over jump when the button is pressed this frame (up-specials
    // share the Up direction with the jump key).
    if (this.tryStartSpecial(ctx)) return;
    if (this.tryStartJump()) return;
    if (this.tryStartAttack()) return;
    this.applyGroundMove(dt);
    this.state = Math.abs(this.body.vel.x) > 0.2 || Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
    this.trail?.setActive(false);
    this.keepInsideStageHint(ctx);
  }

  private updateAir(ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    if (this.tryFly(ctx, dt)) return;
    if (this.tryStartSpecial(ctx)) return;
    if (this.tryStartJump()) return;
    if (this.tryStartAttack()) return;
    this.applyAirMove(dt, AIR_CONTROL);
    if (this.intents.moveY < -0.5 && this.body.vel.y < 0) this.body.fastFalling = true;
    this.state = this.body.vel.y >= 0 ? 'jump' : 'fall';
  }

  private updateAttack(ctx: WorldCtx, dt: number): void {
    const attack = this.currentAttack;
    if (!attack) {
      this.endAttack();
      return;
    }

    this.stateTime += dt;
    this.attackPhaseTime += dt;
    if (this.body.grounded) {
      // Hammer mode: keep running while swinging (Smash-style rampage).
      if (this.autoSwingMove) {
        this.handleFacing2();
        this.applyGroundMove(dt);
      } else {
        this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
      }
    } else {
      this.applyAirMove(dt, AIR_CONTROL);
    }

    // Abilities fire near-instantly — cap their wind-up (weapon/combo unchanged).
    const activeStart = this.currentAbilitySlot >= 0 ? Math.min(attack.windup, ABILITY_WINDUP_CAP) : attack.windup;
    const activeEnd = activeStart + attack.active;
    const total = activeEnd + attack.recover;
    const activeOrLater = this.attackPhaseTime >= activeStart;
    if (!this.currentAttackIsWeapon && this.intents.attackPressed && activeOrLater && this.comboIndex < 2) {
      this.comboQueued = true;
    }
    // Signature-ability special effect (dash / thrust / tether / teleport /
    // buff / slam) fires once at the active frame — BEFORE the hitbox, so a
    // teleport repositions us before the strike reads our position.
    if (this.currentAbilitySlot >= 0 && activeOrLater && !this.abilityEffectFired) {
      this.abilityEffectFired = true;
      const ability = this.abilityDefForSlot(this.currentAbilitySlot);
      if (ability?.effect) this.applyAbilityEffect(ctx, ability.effect);
    }
    if (attack.projectile && activeOrLater && !this.projectileFired) {
      this.fireProjectileAttack(ctx, attack);
      this.projectileFired = true;
    } else if (!attack.projectile && this.attackPhaseTime >= activeStart && this.attackPhaseTime < activeEnd) {
      this.activeHitbox.def = attack;
      ctx.requestHitbox(this.activeHitbox);
    }
    // Melee weapon signature effect (slash wave / hammer lightning): fired once
    // at the active frame alongside the blade hitbox. ONLY for an actual weapon
    // ability — a signature ability (currentAbilitySlot >= 0) must never drag the
    // equipped weapon's slash-wave along with it.
    const wave = this.currentAttackIsWeapon && this.currentAbilitySlot < 0
      ? this.equippedWeapon?.slashWave
      : undefined;
    if (wave && activeOrLater && !this.slashWaveFired) {
      this.slashWaveFired = true;
      const spawnY = this.body.pos.y + this.body.height * 0.55;
      const spawnOff = this.body.halfW + wave.projectile.radius + 0.3;
      ctx.fireProjectile(
        wave.projectile,
        wave.attack,
        this.body.pos.x + this.facing * spawnOff,
        spawnY,
        this.facing,
        this.faction,
        this.teamId,
        this.power,
        this.slotIndex,
      );
      if (wave.bothDirections) {
        ctx.fireProjectile(
          wave.projectile,
          wave.attack,
          this.body.pos.x - this.facing * spawnOff,
          spawnY,
          (this.facing * -1) as Facing,
          this.faction,
          this.teamId,
          this.power,
          this.slotIndex,
        );
      }
      // (ProjectileManager.fire emits the 'shoot' sfx event per wave.)
    }
    if (this.attackPhaseTime >= total) {
      if (!this.currentAttackIsWeapon && this.comboQueued && this.comboIndex < 2) {
        this.startAttack(this.comboIndex + 1);
      } else {
        this.endAttack();
      }
    }
  }

  private updateHitstun(dt: number): void {
    this.stateTime += dt;
    if (this.stateTime >= 0) {
      this.state = this.body.grounded ? 'idle' : 'fall';
      this.stateTime = 0;
    }
  }

  private updateLaunched(ctx: WorldCtx, dt: number): void {
    this.stateTime += dt;
    if (!simPhase.resimulating) {
      this.ensureTrail(ctx);
      this.trail?.push(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, 0.08);
    }
    this.applyAirMove(dt, AIR_CONTROL * TUMBLE_AIR_CONTROL);
  }

  private updateLanding(dt: number): void {
    this.stateTime += dt;
    this.body.vel.x = moveToward(this.body.vel.x, 0, ATTACK_STOP_ACCEL * dt);
    if (this.stateTime >= LANDING_LAG) {
      this.state = Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle';
      this.stateTime = 0;
    }
  }

  private tryStartJump(): boolean {
    if (!this.intents.jumpPressed) return false;
    if (this.body.grounded && this.intents.moveY < -0.5) {
      this.body.dropThroughTimer = DROP_THROUGH_TIME;
      this.body.grounded = false;
      return true;
    }
    if (this.body.grounded) {
      this.body.vel.y = this.def.jumpVel;
      this.body.grounded = false;
      this.jumpsUsed = 1;
      this.state = 'jump';
      this.stateTime = 0;
      events.emit('jump', { isPlayer: this.faction === 'player' });
      return true;
    }
    if (this.jumpsUsed < this.def.jumps) {
      this.body.vel.y = this.def.jumpVel * 0.9;
      this.body.fastFalling = false;
      this.jumpsUsed += 1;
      this.state = 'jump';
      this.stateTime = 0;
      events.emit('jump', { isPlayer: this.faction === 'player' });
      return true;
    }
    return false;
  }

  private tryStartAttack(): boolean {
    if (!this.intents.attackPressed) return false;
    // Spin fighters (Kaze, Shade) use their spin as the air attack directly.
    if (!this.body.grounded && this.def.combo[2].poseId === 'spin') {
      this.startAttack(2);
      return true;
    }
    const nextIndex = this.comboResetTimer > 0 ? clamp(this.comboIndex + 1, 0, 2) : 0;
    this.startAttack(nextIndex);
    return true;
  }

  /**
   * Directional-special dispatch. Neutral fires the equipped weapon (if any) or
   * the neutral signature; side/up/down fire the matching signature. Jetpack-
   * style held abilities are driven by tryFly, not this press.
   */
  private tryStartSpecial(ctx: WorldCtx): boolean {
    let slot: number;
    if (this.intents.specialSlot >= 0) {
      // Mobile: an ability button was tapped — fire that exact slot on its edge.
      if (!this.intents.specialSlotPressed) return false;
      slot = this.intents.specialSlot;
    } else {
      // Keyboard: Special button + stick direction.
      if (!this.intents.weaponPressed) return false;
      slot = this.classifySpecialSlot();
    }
    // The four special buttons fire the character's SIGNATURE abilities — a normal
    // equipped weapon never overrides them (that stray slash-wave is gone). Only a
    // temporary POWERUP weapon (freeze ray) claims the neutral slot while active.
    if (slot === 0 && this.hasPowerupWeapon() && this.equippedWeapon && this.weaponCooldown <= 0) {
      this.startWeaponAbility(this.equippedWeapon);
      return true;
    }
    const ability = this.abilityDefForSlot(slot);
    if (!ability || ability.holdable) return false;
    if (this.abilityCooldowns[slot]! > 0) return false;
    if (slot === 1) {
      if (this.intents.moveX > 0.15) this.facing = 1;
      else if (this.intents.moveX < -0.15) this.facing = -1;
    }
    this.startAbility(ctx, slot, ability);
    return true;
  }

  /** Classify the stick into a directional-special slot: 0=N 1=S 2=U 3=D. */
  private classifySpecialSlot(): number {
    const ax = this.intents.moveX;
    const ay = this.intents.moveY;
    if (ay > SPECIAL_DEADZONE && ay >= Math.abs(ax)) return 2;
    if (ay < -SPECIAL_DEADZONE && -ay >= Math.abs(ax)) return 3;
    if (Math.abs(ax) > SPECIAL_DEADZONE) return 1;
    return 0;
  }

  private startAbility(ctx: WorldCtx, slot: number, ability: AbilityDef): void {
    this.comboQueued = false;
    this.currentAttack = ability.attack;
    this.currentAttackIsWeapon = true;
    this.currentAbilitySlot = slot;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.abilityEffectFired = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'weaponAbility';
    this.comboResetTimer = 0;
    // Tight cooldowns; recovery moves used airborne keep at least a small floor
    // so up-specials can't be chained into infinite height.
    const cd = ability.cooldown * ABILITY_COOLDOWN_SCALE;
    this.abilityCooldowns[slot] = this.body.grounded ? cd : Math.max(cd, ABILITY_AIR_COOLDOWN_MIN);
    this.alreadyHit.clear();
    // Cast BLAST (view-only): a big layered shockwave + spark cloud in the
    // character's colors, a hot flash, and a shake scaled to how heavy the move
    // is — every special erupts. Non-projectile abilities also emit their SFX.
    if (!simPhase.resimulating) {
      const pop = clamp(0.5 + ability.cooldown * 0.14, 0.5, 1.4);
      const x = this.body.pos.x + this.facing * 0.4;
      const y = this.body.pos.y + this.body.height * 0.55;
      ctx.particles.blast(x, y, this.def.palette.glow, this.def.palette.accent, 1 + pop); // det-ok: view-only
      this.rig.flashColor(this.def.palette.accent, 0.14);
      events.emit('screenShake', { amount: 0.12 + pop * 0.14 });
      if (!ability.attack.projectile) {
        events.emit('shoot', {
          kind: ability.attack.sfx,
          pos: { x: this.body.pos.x, y: this.body.pos.y + this.body.height * 0.55 },
        });
      }
    }
  }

  /** Apply a signature ability's special behaviour at its active frame. */
  private applyAbilityEffect(ctx: WorldCtx, effect: AbilityEffect): void {
    const glow = this.def.palette.glow;
    const accent = this.def.palette.accent;
    const cx = this.body.pos.x;
    const midY = this.body.pos.y + this.body.height * 0.5;
    const view = !simPhase.resimulating;
    switch (effect.kind) {
      case 'dash':
        this.body.vel.x = this.facing * effect.speed;
        if (effect.vy !== undefined) {
          this.body.vel.y = effect.vy;
          this.body.grounded = false;
        }
        if (effect.armor) this.applyBuff('armor', effect.armor);
        if (view) {
          // A comet-tail of sparks streaming out BEHIND the dash.
          ctx.particles.directional(cx - this.facing * 0.5, midY, -this.facing, 0.15, glow, 32, effect.speed); // det-ok: view-only
          ctx.particles.directional(cx - this.facing * 0.5, midY, -this.facing, -0.15, accent, 18, effect.speed * 0.7); // det-ok: view-only
        }
        break;
      case 'thrust':
        this.body.vel.y = effect.vy;
        if (effect.vx !== undefined) this.body.vel.x = this.facing * effect.vx;
        this.body.grounded = false;
        this.body.fastFalling = false;
        if (effect.armor) this.applyBuff('armor', effect.armor);
        if (view) {
          ctx.particles.directional(cx, this.body.pos.y + 0.15, 0, -1, accent, 28, 14); // det-ok: view-only (blast-off plume)
          ctx.particles.burst(cx, midY, glow, 22, 8); // det-ok: view-only
        }
        break;
      case 'tether':
        this.applyTether(ctx, effect.range, effect.strength, effect.up ?? 4, effect.damage ?? 3);
        break;
      case 'teleport':
        this.applyTeleport(ctx, effect.dist, effect.toTarget === true, effect.behind ?? 1.3, effect.invuln ?? 0);
        break;
      case 'buff':
        this.applyBuff(effect.buff, effect.duration, effect.speedMult);
        if (view) {
          ctx.particles.ring(cx, midY, accent, 32, 7); // det-ok: view-only (aura shockwave)
          ctx.particles.burst(cx, midY, glow, 26, 4); // det-ok: view-only
        }
        break;
      case 'slam':
        if (!this.body.grounded) {
          this.body.vel.y = effect.vy;
          if (effect.vy < 0) {
            this.body.vel.x *= 0.3;
            this.body.fastFalling = true;
          }
          this.meteorActive = true;
          if (view) ctx.particles.directional(cx, this.body.pos.y + 0.2, 0, 1, accent, 22, 11); // det-ok: view-only (dive flare)
        } else {
          this.fireGroundShock(ctx, effect.shockwave, effect.shockAttack);
          if (view) {
            ctx.particles.ring(cx, this.body.pos.y + 0.15, accent, 36, 14); // det-ok: view-only
            ctx.particles.burst(cx, this.body.pos.y + 0.35, glow, 48, 9); // det-ok: view-only
            events.emit('screenShake', { amount: 0.38 });
          }
        }
        break;
      case 'fly':
        break; // handled by tryFly
    }
  }

  private applyTether(ctx: WorldCtx, range: number, strength: number, up: number, damage: number): void {
    const target = this.nearestOpponent(ctx, range);
    if (!target) return;
    const grabbed = target.receiveTether(
      this.body.pos.x,
      this.body.pos.y + this.body.height * 0.4,
      strength,
      up,
      damage,
    );
    if (grabbed && !simPhase.resimulating) {
      events.emit('shoot', {
        kind: 'lassosnap',
        pos: { x: target.body.pos.x, y: target.body.pos.y + 0.8 },
      });
      const vx = target.body.pos.x;
      const vy = target.body.pos.y + target.body.height * 0.5;
      ctx.particles.burst(vx, vy, this.def.palette.accent, 28, 10); // det-ok: view-only
      ctx.particles.directional(vx, vy, this.body.pos.x - vx, 0.2, this.def.palette.glow, 22, 13); // det-ok: view-only (yank streak)
      events.emit('screenShake', { amount: 0.22 });
    }
  }

  /** Yanked by an opposing tether (lasso/vine): dragged toward the caster. */
  receiveTether(fromX: number, fromY: number, strength: number, up: number, damage: number): boolean {
    if (!this.alive || this.isInvulnerable || this.kbImmune) return false;
    const dx = fromX - this.body.pos.x;
    const dy = fromY - this.body.pos.y;
    const len = Math.max(0.001, hypot(dx, dy));
    this.body.vel.x = (dx / len) * strength;
    this.body.vel.y = up + (dy / len) * strength * 0.35;
    this.body.grounded = false;
    this.body.fastFalling = false;
    this.damage += damage;
    this.state = 'hitstun';
    this.stateTime = -0.32;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.comboQueued = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    return true;
  }

  private applyTeleport(ctx: WorldCtx, dist: number, toTarget: boolean, behind: number, invuln: number): void {
    const fromX = this.body.pos.x;
    const fromY = this.body.pos.y + this.body.height * 0.5;
    if (toTarget) {
      const target = this.nearestOpponent(ctx, Infinity);
      if (target) {
        this.facing = target.body.pos.x >= this.body.pos.x ? 1 : -1;
        this.body.pos.x = target.body.pos.x - this.facing * behind;
        this.body.pos.y = target.body.pos.y;
      } else {
        this.body.pos.x += this.facing * dist;
      }
    } else {
      const ax = this.intents.moveX;
      const ay = this.intents.moveY;
      if (Math.abs(ax) > 0.3) this.facing = ax > 0 ? 1 : -1;
      if (ay > 0.3) {
        this.body.pos.y += dist; // up-blink recovery (Void Rise)
        this.body.pos.x += this.facing * dist * 0.35;
      } else {
        this.body.pos.x += this.facing * dist;
      }
    }
    this.body.vel.x = 0;
    if (this.body.vel.y < 0) this.body.vel.y = 0;
    this.body.grounded = false;
    if (invuln > 0) this.invulnTimer = Math.max(this.invulnTimer, invuln);
    if (!simPhase.resimulating) {
      ctx.particles.ring(fromX, fromY, this.def.palette.glow, 26, 8); // det-ok: view-only (vanish)
      const nx = this.body.pos.x;
      const ny = this.body.pos.y + this.body.height * 0.5;
      ctx.particles.burst(nx, ny, this.def.palette.accent, 28, 10); // det-ok: view-only (reappear)
      ctx.particles.ring(nx, ny, this.def.palette.glow, 20, 6); // det-ok: view-only
    }
  }

  /** Nearest alive opposing fighter (stable slot order) within `maxRange`. */
  private nearestOpponent(ctx: WorldCtx, maxRange: number): Fighter | null {
    let best: Fighter | null = null;
    let bestSq = maxRange === Infinity ? Infinity : maxRange * maxRange;
    const me = this.body.pos;
    const players = ctx.players;
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i]!;
      if (p === this || !p.alive || p.teamId === this.teamId || p.isInvulnerable) continue;
      const dx = p.body.pos.x - me.x;
      const dy = p.body.pos.y - me.y;
      const dsq = dx * dx + dy * dy;
      if (dsq < bestSq) {
        bestSq = dsq;
        best = p;
      }
    }
    return best;
  }

  private fireGroundShock(ctx: WorldCtx, shockwave: ProjectileDef, shockAttack: AttackDef): void {
    const y = this.body.pos.y + 0.25;
    const off = this.body.halfW + shockwave.radius;
    const power = this.power * this.attackMult;
    ctx.fireProjectile(shockwave, shockAttack, this.body.pos.x + off, y, 1, this.faction, this.teamId, power, this.slotIndex);
    ctx.fireProjectile(shockwave, shockAttack, this.body.pos.x - off, y, -1 as Facing, this.faction, this.teamId, power, this.slotIndex);
  }

  /** The slam shockwave to fire on landing (reconstructed from the def). */
  private slamEffect(): { shockwave: ProjectileDef; shockAttack: AttackDef } | null {
    for (let slot = 0; slot < 4; slot += 1) {
      const e = this.abilityDefForSlot(slot)?.effect;
      if (e && e.kind === 'slam') return { shockwave: e.shockwave, shockAttack: e.shockAttack };
    }
    return null;
  }

  private applyBuff(buff: 'armor' | 'cloak' | 'reflect' | 'rage', duration: number, speedMult?: number): void {
    this.buffTimer = Math.max(this.buffTimer, duration);
    switch (buff) {
      case 'armor':
        this.buffKind = BUFF_ARMOR;
        this.kbImmune = true;
        this.damageScale = 0.6;
        break;
      case 'cloak':
        this.buffKind = BUFF_CLOAK;
        this.invulnTimer = Math.max(this.invulnTimer, duration);
        this.speedMult = speedMult ?? 1.5;
        break;
      case 'reflect':
        this.buffKind = BUFF_REFLECT;
        this.kbImmune = true;
        this.damageScale = 0.5;
        break;
      case 'rage':
        this.buffKind = BUFF_RAGE;
        this.attackMult = 1.4;
        break;
    }
  }

  private expireBuff(): void {
    switch (this.buffKind) {
      case BUFF_ARMOR:
      case BUFF_REFLECT:
        this.kbImmune = false;
        this.damageScale = 1;
        break;
      case BUFF_CLOAK:
        this.speedMult = 1;
        break;
      case BUFF_RAGE:
        this.attackMult = 1;
        break;
    }
    this.buffKind = BUFF_NONE;
  }

  /** True while Nova's Light Shield is up — projectiles deflect off it. */
  get isReflecting(): boolean {
    return this.buffKind === BUFF_REFLECT && this.buffTimer > 0;
  }

  /** Sustained jetpack thrust (Comet's up-special). Returns true if flying. */
  private tryFly(ctx: WorldCtx, dt: number): boolean {
    const up = this.abilityDefForSlot(2);
    if (!up || up.effect?.kind !== 'fly') return false;
    // Mobile: holding the up-ability button (slot 2). Keyboard: Special + up.
    const wantFly = this.intents.specialSlot === 2
      || (this.intents.specialSlot < 0 && this.intents.weaponHeld && this.intents.moveY > SPECIAL_DEADZONE);
    if (!wantFly || this.thrustFuel <= 0) return false;
    const eff = up.effect;
    this.thrustFuel = Math.max(0, this.thrustFuel - dt);
    this.body.vel.y = Math.min(this.body.vel.y + eff.accel * dt, eff.maxRise);
    this.body.fastFalling = false;
    this.applyAirMove(dt, AIR_CONTROL);
    this.state = 'jump';
    this.flying = true;
    if (!simPhase.resimulating) {
      this.jetpackSfxTimer -= dt;
      if (this.jetpackSfxTimer <= 0) {
        this.jetpackSfxTimer = 0.16;
        events.emit('shoot', { kind: 'jetpack', pos: { x: this.body.pos.x, y: this.body.pos.y } });
      }
      // Constant roaring exhaust plume: a dense downward jet stream from the
      // pack every frame, hot yellow-white core layered over the accent flame
      // so it reads as a continuous rocket burn, not a puff. (view-only)
      const nozzleX = this.body.pos.x - this.facing * 0.12;
      const nozzleY = this.body.pos.y + 0.12;
      ctx.particles.directional(nozzleX, nozzleY, 0, -1, this.def.palette.accent, 6, 13); // det-ok: view-only
      ctx.particles.directional(nozzleX, nozzleY, 0, -1, 0xffe27a, 4, 9.5); // det-ok: hot core
    }
    return true;
  }

  private refuelJetpack(dt: number): void {
    if (this.thrustFuel < JETPACK_FUEL_MAX) {
      this.thrustFuel = Math.min(JETPACK_FUEL_MAX, this.thrustFuel + JETPACK_REFUEL * dt);
    }
  }

  private startAttack(index: number): void {
    const attack = this.def.combo[index];
    if (attack === undefined) return;
    // Grounded spin gets a little hop (Link-style spin attack) — carries the
    // spin clear of the floor and feels great.
    if (attack.poseId === 'spin' && this.body.grounded) {
      this.body.vel.y = 5.5;
      this.body.grounded = false;
    }
    this.comboIndex = index;
    this.comboQueued = false;
    this.currentAttack = attack;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'attack';
    this.comboResetTimer = 0;
    this.alreadyHit.clear();
  }

  private startWeaponAbility(weapon: WeaponDef): void {
    this.comboQueued = false;
    this.currentAttack = weapon.ability;
    this.currentAttackIsWeapon = true;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.attackPhaseTime = 0;
    this.stateTime = 0;
    this.state = 'weaponAbility';
    this.comboResetTimer = 0;
    this.weaponCooldown = weapon.cooldown;
    this.alreadyHit.clear();
  }

  private endAttack(): void {
    const wasWeapon = this.currentAttackIsWeapon;
    this.currentAttack = null;
    this.currentAttackIsWeapon = false;
    this.currentAbilitySlot = -1;
    this.abilityEffectFired = false;
    this.projectileFired = false;
    this.slashWaveFired = false;
    this.comboQueued = false;
    this.attackPhaseTime = 0;
    this.comboResetTimer = wasWeapon ? this.comboResetTimer : ATTACK_CHAIN_RESET;
    this.state = this.body.grounded
      ? Math.abs(this.intents.moveX) > 0.1 ? 'run' : 'idle'
      : this.body.vel.y >= 0 ? 'jump' : 'fall';
    this.stateTime = 0;
  }

  private applyGroundMove(dt: number): void {
    const target = this.intents.moveX * this.def.speed * this.speedMult;
    this.body.vel.x = moveToward(this.body.vel.x, target, FRICTION_GROUND * dt);
  }

  private applyAirMove(dt: number, accel: number): void {
    const target = this.intents.moveX * this.def.speed * this.speedMult;
    this.body.vel.x = moveToward(this.body.vel.x, target, accel * dt);
  }

  private handleFacing(): void {
    if ((this.state !== 'idle' && this.state !== 'run') || !this.body.grounded) return;
    if (this.intents.moveX > 0.15) this.facing = 1;
    if (this.intents.moveX < -0.15) this.facing = -1;
  }

  private updateVisuals(ctx: WorldCtx, dt: number): void {
    // Attacks blend twice as fast — punches must SNAP; smoothing is for
    // locomotion.
    const rate = this.state === 'attack' || this.state === 'weaponAbility' ? POSE_DAMPING * 2.2 : POSE_DAMPING;
    const blend = 1 - Math.exp(-rate * dt); // det-ok: view-only pose blending
    const t = this.stateTime;
    const pose = this.selectPose(t);
    this.syncGroupToBody();
    this.rig.setFacing(this.facing);
    this.rig.setGhostOpacity(this.isInvulnerable ? 0.62 : 1);
    this.rig.setPose(pose, blend);
    this.updateShadow(ctx);
    this.rig.update(dt);
  }

  /** Blob shadow: project down to the highest platform top under our feet. */
  private updateShadow(ctx: WorldCtx): void {
    const x = this.body.pos.x;
    const y = this.body.pos.y;
    let ground = -Infinity;
    const solids = ctx.stage.colliders.solids;
    for (let i = 0; i < solids.length; i += 1) {
      const s = solids[i]!;
      if (x >= s.minX && x <= s.maxX && s.maxY <= y + 0.05 && s.maxY > ground) ground = s.maxY;
    }
    const oneWays = ctx.stage.colliders.oneWays;
    for (let i = 0; i < oneWays.length; i += 1) {
      const p = oneWays[i]!;
      if (x >= p.minX && x <= p.maxX && p.y <= y + 0.05 && p.y > ground) ground = p.y;
    }
    if (ground === -Infinity) {
      this.rig.setShadow(null, 0);
      return;
    }
    const airborne = clamp((y - ground) / 6, 0, 1);
    this.rig.setShadow(ground - y, airborne);
  }

  private selectPose(t: number) {
    switch (this.state) {
      case 'idle':
        return poseIdle(t);
      case 'run':
        return poseRun(t, Math.abs(this.body.vel.x) / Math.max(0.0001, this.def.speed));
      case 'jump':
        return this.flying ? poseJetpack(t) : poseJump();
      case 'fall':
        return poseFall();
      case 'attack':
      case 'weaponAbility':
        return poseAttack(this.currentAttack?.poseId ?? 'finisher', this.attackPhase());
      case 'hitstun':
        return poseHit();
      case 'launched':
        return poseTumble(t);
      case 'landing':
        return poseLanding();
      case 'ko':
        return poseKO();
      case 'respawning':
        return poseIdle(t);
    }
  }

  private fireProjectileAttack(ctx: WorldCtx, attack: AttackDef): void {
    const projectile = attack.projectile;
    if (!projectile) return;
    const spawnX = this.body.pos.x + this.facing * (this.body.halfW + projectile.radius + 0.2);
    const spawnY = this.body.pos.y + this.body.height * 0.62;
    ctx.fireProjectile(
      projectile,
      this.projectileAttackFor(attack),
      spawnX,
      spawnY,
      this.facing,
      this.faction,
      this.teamId,
      this.power * this.attackMult,
      this.slotIndex,
    );
  }

  private projectileAttackFor(attack: AttackDef): AttackDef {
    if (this.attackMult === 1) return attack;
    const out = this.projectileAttackScratch;
    out.id = attack.id;
    out.damage = attack.damage * this.attackMult;
    out.baseKb = attack.baseKb;
    out.kbGrowth = attack.kbGrowth;
    out.angleDeg = attack.angleDeg;
    out.windup = attack.windup;
    out.active = attack.active;
    out.recover = attack.recover;
    out.hitbox = attack.hitbox;
    out.sfx = attack.sfx;
    out.poseId = attack.poseId;
    out.projectile = attack.projectile;
    out.freezeTime = attack.freezeTime;
    return out;
  }

  private attackPhase(): number {
    const attack = this.currentAttack;
    if (!attack) return 0;
    const windup = this.currentAbilitySlot >= 0 ? Math.min(attack.windup, ABILITY_WINDUP_CAP) : attack.windup;
    return this.attackPhaseTime / Math.max(0.0001, windup + attack.active + attack.recover);
  }

  private ensureTrail(ctx: WorldCtx): void {
    if (this.trail) {
      this.trail.setActive(true);
      return;
    }
    this.trail = ctx.trails.acquire(this.def.palette.glow, 0.5);
  }

  private syncGroupToBody(): void {
    this.group.position.set(this.body.pos.x, this.body.pos.y, 0);
  }

  private readHurtbox(): Rect {
    this.hurtRect.minX = this.body.minX + HURTBOX_PAD_X;
    this.hurtRect.maxX = this.body.maxX - HURTBOX_PAD_X;
    this.hurtRect.minY = this.body.minY;
    this.hurtRect.maxY = this.body.maxY;
    return this.hurtRect;
  }

  private readAttackBox(): Rect {
    const attack = this.currentAttack ?? this.def.combo[0];
    const hb = attack.hitbox;
    // Signature abilities hit BROADER than authored (juicy, forgiving specials).
    const scale = this.currentAbilitySlot >= 0 ? ABILITY_HITBOX_SCALE : 1;
    const centerX = this.body.pos.x + hb.x * this.facing;
    const centerY = this.body.pos.y + hb.y;
    const halfW = hb.w * 0.5 * scale;
    const halfH = hb.h * 0.5 * scale;
    this.activeRect.minX = centerX - halfW;
    this.activeRect.maxX = centerX + halfW;
    this.activeRect.minY = centerY - halfH;
    this.activeRect.maxY = centerY + halfH;
    return this.activeRect;
  }

  private keepInsideStageHint(_ctx: WorldCtx): void {
    // Placeholder hook: entities stay decoupled from stage-specific policy in this slice.
  }
}

function moveToward(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}

function disposeWeaponModel(model: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material = obj.material;
    if (Array.isArray(material)) {
      for (let i = 0; i < material.length; i += 1) materials.add(material[i]!);
    } else {
      materials.add(material);
    }
  });
  materials.forEach((material) => material.dispose());
}
