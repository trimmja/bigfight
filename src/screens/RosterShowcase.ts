import * as THREE from 'three';
import { CAM_FOV, COLOR_BG } from '../config';
import { CHARACTERS } from '../data/characters';
import type { CharacterDef, SaveData } from '../data/types';
import { isCharacterUnlocked } from '../progression';
import { toonRamp } from '../render/toon';
import { buildCharacterRig } from '../rigs/characterBuilders';
import type { Rig } from '../rigs/FighterRig';
import { poseFightStance, poseIdle, poseRun } from '../rigs/poses';

/**
 * The "Pick your fight" cinematic backdrop — the WHOLE roster lined up in a
 * gentle arc behind the mode-select UI. On open the camera eases in from a
 * pulled-back vantage (position + look-target + fov tweened together, plus a
 * forever sine drift so it's never dead-still) while the fighters MARCH in
 * from off-frame, staggered centre-out, and settle to a lively fight-stance
 * idle — each with its own phase so they never lockstep. Fighters you haven't
 * unlocked yet still show up, rendered as bright frosted "mystery" statues
 * (a pale pastel of their real color) so you can see who's coming.
 *
 * View-only. The owning screen news it up with the scene + save, calls
 * start(camera) once, update(camera, dt) every frame, and dispose(camera) on
 * exit (which also restores the shared camera fov).
 */

/** Pack the roster shoulder-to-shoulder (the depth bow keeps them readable) —
 * a tight group-photo arch, not a thin picket line across the screen. */
const ROSTER_N = CHARACTERS.length;
/** Half-width of the lineup arc (world units). */
const ARC_X = 0.75 * (ROSTER_N - 1);
/** Feet height — the fighters loom behind the UI, heads up in the top band. */
const BASE_Y = 0.2;
/** Nearest depth (arc ends); the middle bows away from the camera. */
const BASE_Z = 6.4;
const DEPTH_BOW = 1.4;
/** The middle stands on "risers": lifted to counter its recession so every
 * head reads at the same screen height (and it looks like a group photo). */
const MID_LIFT = 1.15;
const FIGHTER_SCALE = 1.05;

/** Entrance timing. */
const ENTRANCE_S = 1.9;
const MARCH_S = 0.95;
const STAGGER_S = 0.1;
const TURN_S = 0.42;

/** A wider roster needs a longer camera pull-back to keep the flanks framed. */
const CAM_STRETCH = Math.max(0, ARC_X - 7.2) * 1.1;
/** Camera waypoints: pulled-back 3/4 vantage → settled two-shot of the arc.
 * The settle frames the arch big in the upper-middle band — heads just under
 * the title, feet clear of the mode slabs parked along the bottom. */
const CAM_ENTRY = {
  pos: new THREE.Vector3(-6.8, 2.7, 22 + CAM_STRETCH),
  tgt: new THREE.Vector3(3, 0, 2),
  fov: 48,
};
const CAM_SETTLE = {
  pos: new THREE.Vector3(0, 0.8, 17 + CAM_STRETCH),
  tgt: new THREE.Vector3(0, 0.1, 1.5),
  fov: 45,
};

class ShowcaseFighter {
  readonly wrapper = new THREE.Group();
  private readonly rig: Rig;
  private readonly frostMat: THREE.Material | null = null;
  private readonly startX: number;
  private readonly targetX: number;
  private readonly marchYaw: number;
  private t: number;
  private march = 0; // 0 → 1 across the whole [delay, delay+MARCH_S] window
  private settleTurn = 0; // 0 → 1 turn-to-camera after arrival

  constructor(
    scene: THREE.Scene,
    def: CharacterDef,
    readonly slot: number,
    readonly locked: boolean,
    readonly delay: number,
    x: number,
    y: number,
    z: number,
  ) {
    this.t = slot * 1.37; // desync the idle breath per fighter
    this.targetX = x;
    // March in from off-frame on the near side; face the way we travel.
    const side = x >= 0 ? 1 : -1;
    this.startX = x + side * 8.5;
    this.marchYaw = side > 0 ? Math.PI : 0; // running -X faces -X (π); +X faces 0

    this.rig = buildCharacterRig(def);
    this.rig.setShadow(null, 0);
    if (locked) this.frostMat = frost(this.rig, def);

    this.wrapper.add(this.rig.root);
    this.wrapper.position.set(this.startX, y, z);
    this.wrapper.rotation.y = this.marchYaw;
    this.wrapper.scale.setScalar(FIGHTER_SCALE);
    this.wrapper.visible = false;
    scene.add(this.wrapper);
  }

  update(dt: number, elapsed: number): void {
    this.t += dt;
    const blend = 1 - Math.exp(-14 * dt);
    const local = elapsed - this.delay;
    if (local <= 0) return; // still waiting off-stage
    this.wrapper.visible = true;

    if (this.march < 1) {
      // Marching in: ease X from off-frame to the slot, run pose, face travel.
      this.march = Math.min(1, local / MARCH_S);
      const e = easeOutCubic(this.march);
      this.wrapper.position.x = this.startX + (this.targetX - this.startX) * e;
      this.wrapper.rotation.y = this.marchYaw;
      this.rig.setPose(poseRun(this.t, this.locked ? 0.7 : 0.85), blend);
    } else {
      // Arrived: turn to face the camera and settle into a lively idle.
      this.settleTurn = Math.min(1, this.settleTurn + dt / TURN_S);
      this.wrapper.rotation.y = lerpAngle(this.marchYaw, -Math.PI / 2, easeOutCubic(this.settleTurn));
      // Locked "mystery" statues idle calmly; unlocked fighters stay ready.
      this.rig.setPose(this.locked ? poseIdle(this.t) : poseFightStance(this.t), blend);
    }
    this.rig.update(dt);
  }

  dispose(scene: THREE.Scene): void {
    this.wrapper.removeFromParent();
    scene.remove(this.wrapper);
    this.rig.dispose();
    this.frostMat?.dispose();
  }
}

export class RosterShowcase {
  private readonly fighters: ShowcaseFighter[] = [];
  private readonly fill: THREE.PointLight;
  private readonly prevBg: THREE.Scene['background'];
  private elapsed = 0;
  private camT = 0;
  private drift = 0;

  constructor(
    private readonly scene: THREE.Scene,
    save: SaveData,
  ) {
    const n = CHARACTERS.length;
    // Your unlocked fighters take the CENTRE slots (they're the hero of the
    // screen, and the only ones a narrow portrait can show), locked ones fan
    // out to the flanks — still on stage, teasing what's next. Robust to any
    // unlock state.
    const byPriority = [
      ...CHARACTERS.filter((c) => isCharacterUnlocked(c, save)),
      ...CHARACTERS.filter((c) => !isCharacterUnlocked(c, save)),
    ];
    const slotOrder = centerOutOrder(n); // e.g. [3,4,2,5,1,6,0,7]
    byPriority.forEach((def, k) => {
      const slot = slotOrder[k]!; // left-to-right position 0..n-1
      const f = slot / (n - 1); // 0..1 across the row
      const x = -ARC_X + 2 * ARC_X * f;
      const centerDist = Math.abs(f - 0.5) * 2; // 0 centre, 1 ends
      const z = BASE_Z - DEPTH_BOW * (1 - centerDist); // middle bows back
      const y = BASE_Y + MID_LIFT * (1 - centerDist); // ...and stands on risers
      const locked = !isCharacterUnlocked(def, save);
      // Muster from the centre outward so the sweep reads as the camp filling in.
      const delay = centerDist * (n / 2) * STAGGER_S;
      this.fighters.push(new ShowcaseFighter(this.scene, def, slot, locked, delay, x, y, z));
    });

    // Paint the sky INTO the scene so the bloom pass (which ignores the base
    // renderer clear color) shows sky-blue instead of black behind the roster.
    this.prevBg = this.scene.background;
    this.scene.background = new THREE.Color(COLOR_BG);

    // Soft candy front-fill so the fighters pop off the bright sky (bright, not
    // a spotlight — the scene is already sunny).
    this.fill = new THREE.PointLight(0xfff4d8, 0.5, 60, 1.4);
    this.fill.position.set(0, 3, 20);
    this.scene.add(this.fill);
  }

  /** Snap the camera to the pulled-back entry vantage (call once on enter). */
  start(cam: THREE.PerspectiveCamera): void {
    this.elapsed = 0;
    this.camT = 0;
    this.drift = 0;
    cam.position.copy(CAM_ENTRY.pos);
    cam.fov = CAM_ENTRY.fov;
    cam.lookAt(CAM_ENTRY.tgt);
    cam.updateProjectionMatrix();
  }

  update(cam: THREE.PerspectiveCamera, dt: number): void {
    this.elapsed += dt;
    this.drift += dt;

    // Camera: ease entry → settle (pos + target + fov together), then a gentle
    // forever drift on the look-target so the frame is never static.
    this.camT = Math.min(1, this.camT + dt / ENTRANCE_S);
    const u = easeInOutCubic(this.camT);
    cam.position.lerpVectors(CAM_ENTRY.pos, CAM_SETTLE.pos, u);
    cam.fov = CAM_ENTRY.fov + (CAM_SETTLE.fov - CAM_ENTRY.fov) * u;
    cam.updateProjectionMatrix();
    const tgt = new THREE.Vector3().lerpVectors(CAM_ENTRY.tgt, CAM_SETTLE.tgt, u);
    const driftX = Math.sin(this.drift * 0.22) * 0.28 * u;
    const driftY = Math.sin(this.drift * 0.17 + 1.7) * 0.16 * u;
    cam.position.x += driftX * 0.5;
    cam.lookAt(tgt.x + driftX, tgt.y + driftY, tgt.z);

    for (const fighter of this.fighters) fighter.update(dt, this.elapsed);
  }

  dispose(cam: THREE.PerspectiveCamera): void {
    for (const f of this.fighters) f.dispose(this.scene);
    this.fighters.length = 0;
    this.scene.remove(this.fill);
    this.fill.dispose();
    this.scene.background = this.prevBg;
    // Restore the shared camera fov for whatever screen comes next.
    cam.fov = CAM_FOV;
    cam.updateProjectionMatrix();
  }
}

/** Recolor every mesh of a locked fighter to a bright frosted pastel of its own
 * hue — a cheerful "coming soon" statue, no eyes, no gloom. */
function frost(rig: Rig, def: CharacterDef): THREE.Material {
  const pale = new THREE.Color(def.palette.core).lerp(new THREE.Color(0xffffff), 0.6);
  const mat = new THREE.MeshToonMaterial({ color: pale.getHex(), gradientMap: toonRamp() });
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
  });
  return mat;
}

/** Slot indices ordered from the centre outward: [3,4,2,5,1,6,0,7] for n=8. */
function centerOutOrder(n: number): number[] {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/** Shortest-path angular lerp (radians). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
