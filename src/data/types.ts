/**
 * BIG FIGHT — frozen content & interface contracts.
 *
 * This file is the shared contract between all systems and all content data.
 * Changes here require coordination across every module — treat as frozen
 * after M1. Pure types only: no imports, no runtime code.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Facing along X: 1 = right, -1 = left. */
export type Facing = 1 | -1;

export interface Vec2 {
  x: number;
  y: number;
}

/** Neon palette for a fighter/mob rig. Hex colors. */
export interface Palette {
  /** Near-black body core color. */
  core: number;
  /** Primary glow color (edges, trim, glow sprites, trails). */
  glow: number;
  /** Secondary accent color (details, weapon flashes). */
  accent: number;
}

export type MaterialId =
  | 'boneShard'
  | 'slimeGoo'
  | 'ghostEssence'
  | 'feather'
  | 'energyCore';

/** Cost in crafting materials, e.g. { boneShard: 4, energyCore: 1 }. */
export type MaterialCost = Partial<Record<MaterialId, number>>;

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export type FighterStateName =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'attack'
  | 'weaponAbility'
  | 'hitstun'
  | 'launched'
  | 'landing'
  | 'ko'
  | 'respawning';

/** Which side a hitbox/projectile hurts. */
export type Faction = 'player' | 'enemy';

export interface HitboxRect {
  /** Offset from fighter origin (feet center), facing-relative: +x = forward. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectileDef {
  id: string;
  /** Initial speed, u/s, fired along facing (angleDeg rotates it). */
  speed: number;
  /** Launch angle in degrees; 0 = straight ahead, 90 = straight up. */
  angleDeg: number;
  /** 0 = no gravity (lasers), 1 = full gravity (lobbed bombs). */
  gravityScale: number;
  /** Seconds before despawn. */
  lifetime: number;
  /** Half-size of the projectile AABB in world units. */
  radius: number;
  /** Visual style key understood by weaponBuilders/enemyBuilders. */
  visual:
    | 'bullet'
    | 'laser'
    | 'rocket'
    | 'bomb'
    | 'mine'
    | 'orb'
    | 'bolt'
    | 'wave'
    | 'feather'
    | 'shockwave'
    | 'slash'
    | 'flame';
  color: number;
  /** If set, projectile has a hurtbox and can be destroyed by attacks (ghost lasers). */
  hp?: number;
  /** If set, explodes into an AoE hit on impact/expiry with this radius. */
  explodeRadius?: number;
  /** Sticks to the first surface hit, then triggers on enemy proximity (mines/sticky bombs). */
  sticky?: boolean;
  /** Slow-homing toward nearest opposing fighter, turn rate in deg/s. */
  homing?: number;
  /** If true, projectile pierces through fighters instead of despawning on hit. */
  piercing?: boolean;
  /** Sparkle/ember trail in this color while flying. */
  trailColor?: number;
  /** Gravitational pull on opposing fighters while alive (black hole). */
  pull?: { radius: number; strength: number };
  /**
   * Persistent damage field: never despawns on contact; instead re-arms its
   * hitbox every tickInterval seconds so enemies inside take repeated hits.
   * Combine with `sticky` to park in place and `pull` to trap victims.
   */
  field?: { tickInterval: number };
}

export interface AttackDef {
  id: string;
  /** Damage % added to the victim. */
  damage: number;
  /** Base knockback (launch speed component), u/s. */
  baseKb: number;
  /** Knockback growth per victim damage %. */
  kbGrowth: number;
  /** Launch angle in degrees (mirrored by facing). 361 = sakurai (auto). */
  angleDeg: number;
  /** Timing in seconds. */
  windup: number;
  active: number;
  recover: number;
  /** Melee hitbox; ignored when `projectile` is set. */
  hitbox: HitboxRect;
  /** SFX key understood by audio/sfx.ts. */
  sfx: string;
  /** Pose key understood by rigs/poses.ts. */
  poseId: string;
  /** If set, spawns this projectile at the active frame instead of a melee hitbox. */
  projectile?: ProjectileDef;
  /** Freeze/slow effect on hit, seconds (freeze weapons). */
  freezeTime?: number;
}

// ---------------------------------------------------------------------------
// Characters (playable)
// ---------------------------------------------------------------------------

export type Archetype = 'robot' | 'ninja' | 'monster' | 'gunhero';

export type UnlockRule =
  | { type: 'starter' }
  | { type: 'level'; level: number }
  | { type: 'gold'; cost: number };

export interface Proportions {
  /** Total height in world units (player rigs ~1.6–2.2). */
  height: number;
  /** Width/mass multiplier, 1 = average. */
  bulk: number;
  /** Head size multiplier, 1 = average. */
  headSize: number;
}

// ---------------------------------------------------------------------------
// Signature abilities (directional specials — Smash-style)
// ---------------------------------------------------------------------------

/**
 * Which directional-special slot an ability lives in. Selected at press time
 * from the movement stick + the Special (PWR) button:
 *   neutral = stick centered · side = ←/→ · up = ↑ · down = ↓
 * Neutral is overridden by an equipped crafted weapon (weapon = B).
 */
export type AbilitySlot = 'neutral' | 'side' | 'up' | 'down';

/** Timed self-status an ability can grant (see Fighter.applyBuff). */
export type AbilityBuff =
  /** Super-armor: ignore knockback + take reduced damage for the duration. */
  | 'armor'
  /** Vanish: invulnerable + a burst of speed (smoke bomb). */
  | 'cloak'
  /** Reflective bubble: deflects incoming projectiles back at the shooter. */
  | 'reflect'
  /** Berserk: attacks deal extra damage (rage). */
  | 'rage';

/**
 * Extra deterministic behavior applied at an ability's ACTIVE frame, layered on
 * top of the AbilityDef.attack's own melee hitbox / projectile. Movement kinds
 * are one-shot impulses; `fly` is the sustained jetpack (drains fuel, held).
 * Every field here is plain data so the whole ability set stays serializable.
 */
export type AbilityEffect =
  /** Horizontal burst dash forward (+ optional lift / super-armor window). */
  | { kind: 'dash'; speed: number; vy?: number; armor?: number }
  /** One-shot launch — recovery leaps (Rocket/Gale/Beast/Firework/Nova/Jet). */
  | { kind: 'thrust'; vy: number; vx?: number; armor?: number }
  /** Held jetpack: adds `accel` u/s² upward toward `maxRise`, drains fuel. */
  | { kind: 'fly'; accel: number; maxRise: number }
  /** Yank the nearest opposing fighter within `range` toward the caster. */
  | { kind: 'tether'; range: number; strength: number; up?: number; damage?: number }
  /** Blink to just behind the nearest foe (`toTarget`) or a fixed `dist`. */
  | { kind: 'teleport'; dist: number; toTarget?: boolean; behind?: number; invuln?: number }
  /** Grant a timed self-status (armor / cloak / reflect / rage). */
  | { kind: 'buff'; buff: AbilityBuff; duration: number; speedMult?: number }
  /**
   * Ground slam that spits a shockwave both ways on impact. `vy < 0` dives
   * (Comet's meteor); `vy = 0` stomps in place (Grim's pound / Titan's quake).
   * Airborne casts dive, then shockwave the instant they land.
   */
  | { kind: 'slam'; vy: number; shockwave: ProjectileDef; shockAttack: AttackDef };

export interface AbilityDef {
  id: string;
  /** Display name for the character-select ability card. */
  name: string;
  slot: AbilitySlot;
  /**
   * Timing (windup/active/recover), pose, SFX, and — when set — a melee hitbox
   * and/or a spawned projectile. Drives the animation and the base hit.
   */
  attack: AttackDef;
  /** Special behavior applied at the active frame (movement/tether/teleport/buff). */
  effect?: AbilityEffect;
  /** Cooldown between uses, seconds. Holdable (fly) abilities ignore this. */
  cooldown: number;
  /** Fires continuously WHILE HELD, consuming jetpack fuel (Comet's up). */
  holdable?: boolean;
  /** One-line description for the ability card. */
  blurb: string;
  /** Emoji glyph for the ability card. */
  icon: string;
}

/** A character's four signature abilities, one per directional-special slot. */
export interface CharacterAbilities {
  neutral: AbilityDef;
  side: AbilityDef;
  up: AbilityDef;
  down: AbilityDef;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** One-line flavor shown on the select screen. */
  tagline: string;
  archetype: Archetype;
  /** Run speed, u/s (6–10). */
  speed: number;
  /** Attack power multiplier (0.9–1.15). */
  power: number;
  /** Knockback resistance (85 light – 115 heavy). */
  weight: number;
  /** Jump velocity, u/s (13–16). */
  jumpVel: number;
  /** Total jumps including ground jump (2 = one air jump). */
  jumps: number;
  palette: Palette;
  proportions: Proportions;
  /** 3-hit regular combo chain (the ATTACK button). */
  combo: [AttackDef, AttackDef, AttackDef];
  /**
   * Four signature abilities (the SPECIAL button + direction). Always present
   * on the playable roster; omitted for synthetic defs (bosses/mobs reuse
   * CharacterDef but never fire specials).
   */
  abilities?: CharacterAbilities;
  unlock: UnlockRule;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponCategory = 'gun' | 'melee' | 'bomb' | 'magic';

export interface WeaponDef {
  id: string;
  name: string;
  tagline: string;
  category: WeaponCategory;
  /** The ability triggered by the weapon button. */
  ability: AttackDef;
  /** Cooldown between uses, seconds. */
  cooldown: number;
  /** Crafting cost; empty object = owned from the start. */
  recipe: MaterialCost;
  /** Model key understood by rigs/weaponBuilders.ts. */
  model: string;
  color: number;
  /** true for the two starting weapons. */
  starter?: boolean;
  /**
   * Melee signature effect: fired at the ability's active frame IN ADDITION
   * to the melee hitbox. The blade hit uses the ability's full damage; this
   * wave carries its own (weaker) AttackDef — close range hits harder.
   */
  slashWave?: {
    projectile: ProjectileDef;
    attack: AttackDef;
    /** Fire one wave each way (ground-slam shockwaves). */
    bothDirections?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Enemies & bosses
// ---------------------------------------------------------------------------

export interface BrainParams {
  aggroRange: number;
  attackRange: number;
  moveSpeed: number;
  /** Seconds of telegraph flash before the attack. */
  telegraphTime: number;
  /** Chance (0–1) to back off after an attack. */
  retreatChance: number;
  /** Seconds between attacks. */
  attackCooldown: number;
  canFly?: boolean;
  /** Grounded hop movement (slimes). */
  hops?: boolean;
  /** Can hold a block that reduces damage to 30% and negates kb (captains). */
  canBlock?: boolean;
}

export interface EnemyDef {
  id: string;
  name: string;
  /** Rig builder key in rigs/enemyBuilders.ts. */
  builder: 'skeleton' | 'slime' | 'ghost' | 'miniEagle' | 'captain';
  weight: number;
  gravityScale: number;
  palette: Palette;
  proportions: Proportions;
  attack: AttackDef;
  brain: BrainParams;
  /** Gold dropped on KO (randomized ±30%). */
  gold: number;
  /** Materials dropped on KO. */
  drops: MaterialCost;
  /** Slimes split into this many smaller copies once. */
  splitsInto?: number;
}

export type BossId = 'skeletonKing' | 'giantGhost' | 'giantEagle';

export interface BossDef {
  id: BossId;
  name: string;
  /** Shown on the boss intro banner, e.g. "KING OF BONES". */
  title: string;
  /** Damage % at which the boss is defeated (HP bar = threshold - damage). */
  defeatThreshold: number;
  weight: number;
  /** Rig scale relative to the player (~2.5). */
  scale: number;
  palette: Palette;
  gold: number;
  drops: MaterialCost;
}

// ---------------------------------------------------------------------------
// Stages & levels
// ---------------------------------------------------------------------------

export type StageTheme =
  | 'rooftop'
  | 'cavern'
  | 'graveyard'
  | 'ghostship'
  | 'peak'
  | 'finale';

export interface PlatformDef {
  /** Center x, top y. */
  x: number;
  y: number;
  w: number;
  /** One-way: can jump up through, drop through with down+jump. */
  oneWay: boolean;
}

export interface WallDef {
  /** Center x; wall spans from `y` (bottom) up `h` units. */
  x: number;
  y: number;
  h: number;
}

export interface BlastZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface StageDef {
  id: string;
  name: string;
  theme: StageTheme;
  /** Enclosed arenas have side walls; launches above the walls still ring out. */
  enclosed: boolean;
  platforms: PlatformDef[];
  walls?: WallDef[];
  blast: BlastZone;
  playerSpawn: Vec2;
  enemySpawns: Vec2[];
  /**
   * Versus-mode spawn points for slots P1-P4 (all face stage center).
   * 2v2 pairs teammates on the same side: team A → indices 0,2; team B → 1,3.
   * Absent → mirrored defaults derived from playerSpawn.
   */
  versusSpawns?: Vec2[];
  /** Respawn platform position (stage top-center). */
  respawnPoint: Vec2;
  unlockedAtStart: boolean;
  /** Background/accent colors for the theme decorations. */
  skyColor: number;
  glowColor: number;
}

export interface WaveDef {
  enemies: { enemyId: string; count: number }[];
  /** Seconds after the previous wave clears before this one spawns. */
  delay: number;
}

export interface LevelUnlocks {
  characterId?: string;
  powerupId?: string;
  stageId?: string;
}

export interface LevelDef {
  /** 1-based level number. */
  id: number;
  name: string;
  stageId: string;
  waves: WaveDef[];
  /** Boss spawns after all waves clear. */
  bossId?: BossId;
  goldReward: number;
  /** Granted the first time this level is beaten. */
  unlocks?: LevelUnlocks;
}

// ---------------------------------------------------------------------------
// Powerups & sidekicks
// ---------------------------------------------------------------------------

export type PowerupId = 'healOrb' | 'shieldBubble' | 'rageMode' | 'giantHammer' | 'freezeRay';

export interface PowerupDef {
  id: PowerupId;
  name: string;
  /** Level that must be beaten before this powerup starts dropping. */
  unlockAfterLevel: number;
  /** Effect duration in seconds (0 = instant, e.g. heal). */
  duration: number;
  color: number;
  /** Description shown in the unlock toast/help. */
  blurb: string;
}

export interface SidekickDef {
  id: string;
  name: string;
  tagline: string;
  goldCost: number;
  /** Seconds between auto-attacks. */
  fireInterval: number;
  projectile: ProjectileDef;
  attack: Pick<AttackDef, 'damage' | 'baseKb' | 'kbGrowth' | 'angleDeg'>;
  palette: Palette;
  /** Rig builder key in rigs/weaponBuilders.ts (sidekicks are tiny rigs). */
  builder: 'drone' | 'dragon' | 'ghostBuddy';
}

// ---------------------------------------------------------------------------
// Save data
// ---------------------------------------------------------------------------

export interface SaveSettings {
  muted: boolean;
  quality: 'auto' | 'mobile' | 'high';
  shake: boolean;
}

export interface SaveData {
  version: 1;
  gold: number;
  materials: Record<MaterialId, number>;
  /** Characters bought with gold (level/starter unlocks are derived from levelsBeaten). */
  purchasedCharacters: string[];
  craftedWeapons: string[];
  ownedSidekicks: string[];
  equippedSidekick: string | null;
  /** Highest beaten level, 0–12. Level N is playable iff N <= levelsBeaten + 1. */
  levelsBeaten: number;
  /** Online fighter name ('' until first online visit; A-Za-z0-9, ≤12 chars). */
  nickname: string;
  settings: SaveSettings;
}
