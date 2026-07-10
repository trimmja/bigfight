/**
 * BIG FIGHT — all tuning constants live here (frozen contract: names/shape
 * stable after M1; values are freely tunable).
 */

// ---- simulation ----
export const TIMESTEP = 1 / 60;
export const MAX_FRAME_DELTA = 0.1;
export const MAX_STEPS_PER_FRAME = 5;

// ---- movement / physics (world units: fighter ≈ 1.8u tall) ----
export const GRAVITY = -38;
export const MAX_FALL = -22;
export const FASTFALL_MULT = 1.6;
// Ground accel/decel: fighters hit full run speed in ~0.14s — snappy, arcadey.
export const FRICTION_GROUND = 55;
export const AIR_CONTROL = 14;
export const DROP_THROUGH_TIME = 0.25;

// ---- combat feel ----
export const HITSTUN_PER_KB = 0.035;
export const HITSTUN_MIN = 0.1;
export const HITSTUN_MAX = 1.1;
/** Knockback above this speed enters `launched` tumble instead of flinch. */
export const LAUNCH_THRESHOLD = 14;
export const LANDING_LAG = 0.15;
export const HITSTOP_BASE = 0.02;
export const HITSTOP_PER_DAMAGE = 0.006;
export const HITSTOP_MAX = 0.12;
/** DI: max launch-angle rotation from perpendicular stick input, degrees. */
export const DI_MAX_DEG = 10;
/** Air control multiplier while tumbling. */
export const TUMBLE_AIR_CONTROL = 0.25;
/** Sakurai angle (361): strong hits use 40°, weak hits 12°. */
export const SAKURAI_STRONG_DEG = 40;
export const SAKURAI_WEAK_DEG = 12;
export const SAKURAI_KB_CUTOFF = 12;

// ---- stocks / respawn ----
export const PLAYER_STOCKS = 3;
export const RESPAWN_DELAY = 1.2;
export const RESPAWN_INVULN = 2.5;
/** Upward blast-line KO faster than this = Star KO (background fly + scream). */
export const STAR_KO_MIN_VY = 18;

// ---- AI ----
/** Max mobs in windup/attack simultaneously (crowd fairness). */
export const ATTACK_TOKENS = 2;
export const SPAWN_TELEGRAPH = 0.8;
export const SPAWN_STAGGER = 0.3;

// ---- powerups ----
/** Seconds between powerup drop attempts once any are unlocked. */
export const POWERUP_DROP_INTERVAL = 14;
export const POWERUP_DROP_CHANCE = 0.65;
export const HEAL_ORB_AMOUNT = 40;
export const RAGE_MULT = 2.0;
export const SHIELD_HITS = 3;

// ---- camera ----
export const CAM_FOV = 42;
export const CAM_MIN_DIST = 16;
export const CAM_MAX_DIST = 30;
export const CAM_SMOOTHING = 4.5;
export const SHAKE_DECAY = 6;

// ---- rendering ----
export const DPR_CAP_MOBILE = 1.5;
export const DPR_CAP_DESKTOP = 2;
export const BLOOM_STRENGTH = 0.3;
export const BLOOM_RADIUS = 0.5;
export const BLOOM_THRESHOLD = 0.85;
/** Auto quality tier drops to mobile if avg frame time exceeds this (ms). */
export const AUTO_QUALITY_FRAME_MS = 20;

// ---- pools ----
export const POOL_PROJECTILES = 64;
export const POOL_PARTICLES = 1024;
export const POOL_DAMAGE_NUMBERS = 24;
export const POOL_PICKUPS = 32;

// ---- economy ----
export const GOLD_DROP_VARIANCE = 0.3;
/** Magnet radius for material/gold pickups flying to the player. */
export const PICKUP_MAGNET_RADIUS = 3.5;

// ---- colors (global identity; per-content colors live in data/) ----
// Bright-cartoon era: BG is a sunny sky blue; the NEON_* names survive as the
// candy accent set used by UI/effects.
export const COLOR_BG = 0x8fd3ff;
export const COLOR_NEON_CYAN = 0x1a9fe8;
export const COLOR_NEON_PINK = 0xff5a8a;
export const COLOR_NEON_YELLOW = 0xffc93e;
export const COLOR_NEON_GREEN = 0x4ec95c;
export const COLOR_NEON_VIOLET = 0x9a6bff;

// ---- save ----
export const SAVE_KEY = 'bigfight_save_v1';

// ---- debug ----
/** `?debug` URL flag: hitbox view + live tuning panel. */
export const DEBUG = typeof location !== 'undefined' && location.search.includes('debug');
