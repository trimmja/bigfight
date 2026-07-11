/**
 * Character Lab — design-review page (mockup.html). Shows candidate character
 * directions side by side and plays the game's REAL attack animations on
 * them. Not linked from the game; exists for design sign-off.
 */
import * as THREE from 'three';
import { WEAPONS } from './data/weapons';
import { toonRamp } from './render/toon';
import { poseAttack, poseFightStance, poseRun, type Pose } from './rigs/poses';
import { ALL_CHARS, buildMockRig, OPTION_LABELS, type CharId, type MockRig, type OptionId } from './mockup/rigs';

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
let dancingUntil = 0;
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
  label.textContent = chr === 'comet'
    ? 'COMET · SPACE CADET · SIGNATURE PREVIEW: METEOR DIVE'
    : OPTION_LABELS[option];
}
show();

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function pickOption(id: OptionId): void {
  option = id;
  if (id !== 'C' && chr !== 'volt' && chr !== 'grim') chr = 'volt';
  for (const o of ['A', 'B', 'C'] as const) {
    document.getElementById(`opt${o}`)!.classList.toggle('on', o === id);
  }
  syncChrButton();
  show();
}
document.getElementById('optA')!.addEventListener('click', () => pickOption('A'));
document.getElementById('optB')!.addEventListener('click', () => pickOption('B'));
document.getElementById('optC')!.addEventListener('click', () => pickOption('C'));
const chrBtn = document.getElementById('chr')!;
function syncChrButton(): void {
  chrBtn.textContent = `${chr.toUpperCase()} ▸`;
}
chrBtn.addEventListener('click', () => {
  // Options A/B only have volt+grim; C has the full roster.
  const pool: readonly CharId[] = option === 'C' ? ALL_CHARS : ['volt', 'grim'];
  chr = pool[(pool.indexOf(chr) + 1) % pool.length] ?? 'volt';
  syncChrButton();
  show();
});
syncChrButton();

// ---------------------------------------------------------------------------
// Online lobby review — interaction-only design mockup, not live networking.
// ---------------------------------------------------------------------------
const lobbyReview = document.getElementById('lobbyReview')!;
const roomBrowser = document.getElementById('roomBrowser')!;
const loadoutSelect = document.getElementById('loadoutSelect')!;
const waitingRoom = document.getElementById('waitingRoom')!;
const resultOverlay = document.getElementById('resultOverlay')!;
const lobbyTitle = document.getElementById('lobbyTitle')!;
const connectionChip = document.getElementById('connectionChip')!;
const lobbyFighter = document.getElementById('lobbyFighter')!;
const waitingFighter = document.getElementById('waitingFighter')!;
const fighterValue = document.getElementById('fighterValue')!;
const weaponValue = document.getElementById('weaponValue')!;
const youPick = document.getElementById('youPick')!;
const youStatus = document.getElementById('youStatus')!;
const youCard = document.getElementById('youCard')!;
const waitingReadyBtn = document.getElementById('waitingReadyBtn')!;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const lobbyCharacters: readonly CharId[] = ALL_CHARS;
let lobbyWeaponIndex = 0;
let lobbyReady = false;
let lobbyHost = true;

function openLobbyBrowser(): void {
  document.body.classList.add('lobby-mode');
  lobbyReview.hidden = false;
  roomBrowser.hidden = false;
  loadoutSelect.hidden = true;
  waitingRoom.hidden = true;
  resultOverlay.hidden = true;
  lobbyTitle.textContent = 'ONLINE FIGHTS';
  connectionChip.innerHTML = '<span class="dot"></span> DALLAS · 28 MS';
}

function closeLobbyReview(): void {
  document.body.classList.remove('lobby-mode');
  lobbyReview.hidden = true;
  resultOverlay.hidden = true;
}

function enterRoom(name: string, isHost: boolean, isPrivate = false): void {
  lobbyHost = isHost;
  lobbyReady = false;
  option = 'C';
  show();
  syncChrButton();
  roomBrowser.hidden = true;
  loadoutSelect.hidden = false;
  waitingRoom.hidden = true;
  resultOverlay.hidden = true;
  lobbyTitle.textContent = name.toUpperCase();
  connectionChip.innerHTML = `<span class="dot"></span> ${isPrivate ? 'PRIVATE · CODE BCDX' : 'DIRECT · 24 MS'}`;
  youCard.querySelector('.player-card-name')!.textContent = isHost ? 'YOU · HOST' : 'YOU';
  startBtn.hidden = !isHost;
  syncLobbyLoadout();
}

function syncLobbyLoadout(): void {
  const weapon = WEAPONS[lobbyWeaponIndex] ?? WEAPONS[0]!;
  const name = chr.toUpperCase();
  lobbyFighter.textContent = name;
  waitingFighter.textContent = name;
  fighterValue.textContent = name;
  weaponValue.textContent = weapon.name.toUpperCase();
  youPick.textContent = `${name} · ${weapon.name.toUpperCase()}`;
  youStatus.textContent = lobbyReady ? 'READY' : 'NOT READY';
  waitingReadyBtn.textContent = lobbyReady ? 'NOT READY' : 'READY UP';
  waitingReadyBtn.classList.toggle('on', lobbyReady);
  startBtn.disabled = lobbyHost && !lobbyReady;
}

function showWaitingRoom(): void {
  lobbyReady = true;
  loadoutSelect.hidden = true;
  waitingRoom.hidden = false;
  syncLobbyLoadout();
}

function showLoadoutSelect(): void {
  lobbyReady = false;
  waitingRoom.hidden = true;
  loadoutSelect.hidden = false;
  resultOverlay.hidden = true;
  syncLobbyLoadout();
}

function cycleLobbyFighter(direction: -1 | 1): void {
  const current = Math.max(0, lobbyCharacters.indexOf(chr));
  chr = lobbyCharacters[(current + direction + lobbyCharacters.length) % lobbyCharacters.length] ?? 'volt';
  show();
  syncChrButton();
  lobbyReady = false;
  syncLobbyLoadout();
}

function cycleLobbyWeapon(direction: -1 | 1): void {
  lobbyWeaponIndex = (lobbyWeaponIndex + direction + WEAPONS.length) % WEAPONS.length;
  lobbyReady = false;
  syncLobbyLoadout();
}

document.getElementById('lobbyBtn')!.addEventListener('click', openLobbyBrowser);
document.getElementById('lobbyBack')!.addEventListener('click', () => {
  if (!waitingRoom.hidden) showLoadoutSelect();
  else if (!loadoutSelect.hidden) openLobbyBrowser();
  else closeLobbyReview();
});
document.querySelectorAll<HTMLElement>('[data-room]').forEach((row) => {
  row.addEventListener('click', () => enterRoom(row.dataset.room ?? 'Open Game', false));
});
document.getElementById('quickJoin')!.addEventListener('click', () => enterRoom("Ryder's Rooftop", false));
document.getElementById('joinCode')!.addEventListener('click', () => enterRoom('Private Fight', false, true));
document.getElementById('hostPublic')!.addEventListener('click', () => enterRoom('Your Open Game', true));
document.getElementById('hostPrivate')!.addEventListener('click', () => enterRoom('Your Private Game', true, true));
document.getElementById('fighterPrev')!.addEventListener('click', () => cycleLobbyFighter(-1));
document.getElementById('fighterNext')!.addEventListener('click', () => cycleLobbyFighter(1));
document.getElementById('weaponPrev')!.addEventListener('click', () => cycleLobbyWeapon(-1));
document.getElementById('weaponNext')!.addEventListener('click', () => cycleLobbyWeapon(1));
document.getElementById('lockInBtn')!.addEventListener('click', showWaitingRoom);
document.getElementById('danceBtn')!.addEventListener('click', () => { dancingUntil = t + 1.8; });
waitingReadyBtn.addEventListener('click', () => { lobbyReady = !lobbyReady; syncLobbyLoadout(); });
document.getElementById('changePickBtn')!.addEventListener('click', showLoadoutSelect);
startBtn.addEventListener('click', () => { if (!startBtn.disabled) resultOverlay.hidden = false; });
document.getElementById('testResults')!.addEventListener('click', () => { resultOverlay.hidden = false; });
document.getElementById('sameRoom')!.addEventListener('click', () => {
  resultOverlay.hidden = true;
  lobbyReady = false;
  waitingRoom.hidden = false;
  loadoutSelect.hidden = true;
  syncLobbyLoadout();
});

// Each character's REAL game combo (kaze/blaze/shade kick on hit 2;
// kaze/shade spin finishers, grim/titan slams, nova uppercut).
const HIT2: Record<CharId, string> = {
  volt: 'jab2', kaze: 'kick', grim: 'jab2', ace: 'jab2',
  blaze: 'kick', nova: 'jab2', shade: 'kick', titan: 'jab2', comet: 'jab2',
};
const FINISHERS: Record<CharId, string> = {
  volt: 'finisher', kaze: 'spin', grim: 'slam', ace: 'finisher',
  blaze: 'finisher', nova: 'uppercut', shade: 'spin', titan: 'slam', comet: 'finisher',
};
const SIGNATURES: Record<CharId, string> = {
  volt: 'uppercut', kaze: 'shoot', grim: 'slam', ace: 'shoot',
  blaze: 'uppercut', nova: 'uppercut', shade: 'spin', titan: 'slam', comet: 'cometMeteor',
};
document.getElementById('jab')!.addEventListener('click', () => {
  attackQueue = [
    { poseId: 'jab1', duration: 0.3 },
    { poseId: HIT2[chr], duration: HIT2[chr] === 'kick' ? 0.4 : 0.3 },
    { poseId: FINISHERS[chr], duration: FINISHERS[chr] === 'spin' ? 0.55 : 0.45 },
  ];
  attackPhase = 0;
});
document.getElementById('weapon')!.addEventListener('click', () => {
  attackQueue = [{ poseId: chr === 'grim' || chr === 'titan' ? 'slam' : 'slash', duration: 0.6 }];
  attackPhase = 0;
});
document.getElementById('signature')!.addEventListener('click', () => {
  attackQueue = [{ poseId: SIGNATURES[chr], duration: chr === 'comet' ? 0.8 : 0.65 }];
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
(window as unknown as { lab: { step: (n?: number) => void; pick: (o: OptionId, c: CharId) => void; attack: () => void; signature: () => void } }).lab = {
  step: (n = 1) => { for (let i = 0; i < n; i += 1) tick(1 / 60); renderer.render(scene, camera); },
  pick: (o, c) => { option = o; chr = c; show(); },
  attack: () => document.getElementById('jab')!.click(),
  signature: () => document.getElementById('signature')!.click(),
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
      pose = current.poseId === 'cometMeteor'
        ? poseCometMeteor(attackPhase)
        : poseAttack(current.poseId, attackPhase);
    }
  } else if (t < dancingUntil) {
    pose = poseDancePreview(t);
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

/** Review-only Meteor Dive animation; this does not add an ability to the game. */
function poseCometMeteor(phase: number): Pose {
  if (phase < 0.32) {
    const gather = phase / 0.32;
    return {
      torso: { z: 0.25 * gather },
      head: { z: 0.18 * gather },
      armL: { z: 2.15 * gather, x: 0.24 * gather },
      armR: { z: 2.15 * gather, x: -0.24 * gather },
      foreArmL: { z: 0.35 * gather },
      foreArmR: { z: 0.35 * gather },
      legL: { z: 0.3 * gather },
      legR: { z: 0.3 * gather },
      shinL: { z: -0.45 * gather },
      shinR: { z: -0.45 * gather },
    };
  }
  const dive = Math.min(1, (phase - 0.32) / 0.22);
  return {
    root: { z: -0.12 * dive },
    torso: { z: 0.25 - 0.34 * dive },
    head: { z: 0.18 - 0.48 * dive },
    armL: { z: 2.15 + 0.55 * dive, x: 0.24 - 0.08 * dive },
    armR: { z: 2.15 + 0.55 * dive, x: -0.24 + 0.08 * dive },
    foreArmL: { z: 0.35 - 0.25 * dive },
    foreArmR: { z: 0.35 - 0.25 * dive },
    legL: { z: 0.3 - 0.44 * dive },
    legR: { z: 0.3 - 0.44 * dive },
    shinL: { z: -0.45 + 0.53 * dive },
    shinR: { z: -0.45 + 0.53 * dive },
  };
}

/** Review-only lobby dance. Approved dances will be ported character by character. */
function poseDancePreview(time: number): Pose {
  const beat = Math.sin(time * 9);
  const side = Math.sin(time * 4.5);
  return {
    root: { z: Math.abs(beat) * -0.09 },
    hips: { x: side * 0.32, z: -beat * 0.08 },
    torso: { x: -side * 0.26, z: beat * 0.12 },
    head: { x: side * 0.18, z: -beat * 0.08 },
    armL: { x: 0.35 + side * 0.4, z: 1.4 + beat * 0.45 },
    armR: { x: -0.35 + side * 0.4, z: 1.4 - beat * 0.45 },
    foreArmL: { z: 0.5 },
    foreArmR: { z: 0.5 },
    legL: { x: side * 0.15, z: beat * 0.28 },
    legR: { x: side * 0.15, z: -beat * 0.28 },
    shinL: { z: -Math.max(0, beat) * 0.35 },
    shinR: { z: -Math.max(0, -beat) * 0.35 },
  };
}
