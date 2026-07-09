/**
 * Character Lab — design-review page (mockup.html). Shows candidate character
 * directions side by side and plays the game's REAL attack animations on
 * them. Not linked from the game; exists for design sign-off.
 */
import * as THREE from 'three';
import { toonRamp } from './render/toon';
import { poseAttack, poseFightStance, poseRun, type Pose } from './rigs/poses';
import { buildMockRig, OPTION_LABELS, type CharId, type MockRig, type OptionId } from './mockup/rigs';

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x8fd3ff);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xd8efff, 0xffe3b8, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(8, 18, 12);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 1.2, 7);
camera.lookAt(0, 0.9, 0);

// Ground disc so scale reads.
const ground = new THREE.Mesh(
  new THREE.CylinderGeometry(2.4, 2.4, 0.18, 36),
  new THREE.MeshToonMaterial({ color: 0x9fe098, gradientMap: toonRamp() }),
);
ground.position.y = -0.09;
scene.add(ground);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let option: OptionId = 'A';
let chr: CharId = 'volt';
let rig: MockRig | null = null;
const wrap = new THREE.Group();
scene.add(wrap);

let t = 0;
let running = false;
let spinning = false;
let attackQueue: { poseId: string; duration: number }[] = [];
let attackPhase = 0;

const label = document.getElementById('label')!;

function show(): void {
  rig?.dispose();
  rig = buildMockRig(option, chr);
  wrap.clear();
  wrap.add(rig.root);
  wrap.rotation.y = -Math.PI / 2 + 0.2;
  attackQueue = [];
  label.textContent = OPTION_LABELS[option];
}
show();

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function pickOption(id: OptionId): void {
  option = id;
  for (const o of ['A', 'B', 'C'] as const) {
    document.getElementById(`opt${o}`)!.classList.toggle('on', o === id);
  }
  show();
}
document.getElementById('optA')!.addEventListener('click', () => pickOption('A'));
document.getElementById('optB')!.addEventListener('click', () => pickOption('B'));
document.getElementById('optC')!.addEventListener('click', () => pickOption('C'));
document.getElementById('chr')!.addEventListener('click', () => {
  chr = chr === 'volt' ? 'grim' : 'volt';
  show();
});
document.getElementById('jab')!.addEventListener('click', () => {
  attackQueue = [
    { poseId: 'jab1', duration: 0.3 },
    { poseId: 'jab2', duration: 0.3 },
    { poseId: chr === 'grim' ? 'slam' : 'finisher', duration: 0.45 },
  ];
  attackPhase = 0;
});
document.getElementById('weapon')!.addEventListener('click', () => {
  attackQueue = [{ poseId: chr === 'grim' ? 'slam' : 'slash', duration: 0.6 }];
  attackPhase = 0;
});
document.getElementById('run')!.addEventListener('click', function (this: HTMLElement) {
  running = !running;
  this.classList.toggle('on', running);
});
document.getElementById('spinBtn')!.addEventListener('click', function (this: HTMLElement) {
  spinning = !spinning;
  this.classList.toggle('on', spinning);
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
let last = performance.now();
// Manual stepping for design review from an occluded window (rAF pauses).
(window as unknown as { lab: { step: (n?: number) => void; pick: (o: OptionId, c: CharId) => void; attack: () => void } }).lab = {
  step: (n = 1) => { for (let i = 0; i < n; i += 1) tick(1 / 60); renderer.render(scene, camera); },
  pick: (o, c) => { option = o; chr = c; show(); },
  attack: () => document.getElementById('jab')!.click(),
};

function tick(dt: number): void {
  t += dt;
  if (!rig) return;

  let pose: Pose;
  if (attackQueue.length > 0) {
    const current = attackQueue[0]!;
    attackPhase += dt / current.duration;
    if (attackPhase >= 1) {
      attackQueue.shift();
      attackPhase = 0;
      pose = poseFightStance(t);
    } else {
      pose = poseAttack(current.poseId, attackPhase);
    }
  } else if (running) {
    pose = poseRun(t, 0.9);
  } else {
    pose = poseFightStance(t);
  }
  const blend = 1 - Math.exp(-(attackQueue.length > 0 ? 55 : 16) * dt);
  rig.setPose(pose, blend);
  rig.update(dt);

  if (spinning) wrap.rotation.y += dt * 1.2;
  else wrap.rotation.y = -Math.PI / 2 + 0.2 + Math.sin(t * 0.4) * 0.12;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  tick(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
