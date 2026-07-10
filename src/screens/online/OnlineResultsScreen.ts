import * as THREE from 'three';
import { events } from '../../core/events';
import type { Game } from '../../Game';
import { CHARACTERS } from '../../data/characters';
import type { LobbyClient } from '../../net/LobbyClient';
import { displayNameFor } from '../../net/nicknames';
import { makeToonMaterial } from '../../render/toon';
import { buildCharacterRig } from '../../rigs/characterBuilders';
import type { Rig } from '../../rigs/FighterRig';
import { poseAttack, poseFightStance, poseIdle } from '../../rigs/poses';
import { button, el, uiRoot } from '../../ui/dom';
import { toast } from '../../ui/toasts';
import type { Screen } from '../Screen';
import { SLOT_COLORS } from './LobbyScreen';

/**
 * VersusEndResult-shaped payload the netcode layer hands over when an online
 * match finishes (plus who was in it, snapshotted from matchStart so a
 * mid-results room change can't corrupt the podium).
 */
export interface OnlineResultsPayload {
  /** Player slots in placement order, winner FIRST. */
  placements: number[];
  /** KOs scored this match, keyed by slot. */
  kosBySlot: Record<number, number>;
  /** Gold earned this match, keyed by slot. */
  goldBySlot: Record<number, number>;
  /** Match roster: slot → identity. */
  players: { slot: number; nickname: string; characterId: string }[];
}

const MEDALS = ['🥇', '🥈', '🥉', '4th'] as const;
/** Podium x-positions in placement order (1st center, 2nd left, 3rd right, 4th far right on the floor). */
const PODIUM_X = [0, -2.9, 2.9, 5.4] as const;
const PODIUM_H = [2.4, 1.6, 1.0, 0] as const;
const PODIUM_COLORS = [0xffc93e, 0xc8d4e0, 0xd8894a] as const;
const CONFETTI_COLORS = ['#1a9fe8', '#ff5a8a', '#ffc93e', '#4ec95c', '#9a6bff', '#ffffff'];

/** A fighter posed on the podium: winner loops the finisher, others idle. */
class PodiumFighter {
  private punchT = 0;
  private t: number;

  constructor(
    readonly rig: Rig,
    private readonly winner: boolean,
    seed: number,
  ) {
    this.t = seed * 1.7;
  }

  update(dt: number): void {
    this.t += dt;
    const blend = 1 - Math.exp(-14 * dt);
    if (this.winner) {
      // Victory punch on a loop, with a little breather between reps.
      this.punchT += dt * 1.8;
      if (this.punchT >= 1.6) this.punchT = 0;
      if (this.punchT < 1) this.rig.setPose(poseAttack('finisher', this.punchT), blend);
      else this.rig.setPose(poseFightStance(this.t), blend);
    } else {
      this.rig.setPose(poseIdle(this.t), blend);
    }
    this.rig.update(dt);
  }
}

/**
 * Online results: chunky gold/silver/bronze podium with the posed fighters,
 * confetti, placement cards, and the rematch loop.
 */
export class OnlineResultsScreen implements Screen {
  private root: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private group = new THREE.Group();
  private rigs: Rig[] = [];
  private fighters: PodiumFighter[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private rematchBtn: HTMLButtonElement | null = null;
  private navigated = false;

  constructor(
    private readonly payload: OnlineResultsPayload,
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onCharSelect: () => void;
      onLobby: () => void;
      onLeft: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    // ---- 3D podium ----
    this.group.position.set(-0.8, -3.4, 8);
    game.renderer.scene.add(this.group);
    const boxGeo = new THREE.BoxGeometry(2.3, 1, 1.9);
    this.geometries.push(boxGeo);
    this.payload.placements.forEach((slot, place) => {
      const x = PODIUM_X[place] ?? 5.4;
      const h = PODIUM_H[place] ?? 0;
      if (h > 0) {
        const mat = makeToonMaterial(PODIUM_COLORS[place] ?? 0xd8894a);
        this.materials.push(mat);
        const box = new THREE.Mesh(boxGeo, mat);
        box.scale.y = h;
        box.position.set(x, h / 2, 0);
        this.group.add(box);
      }
      const identity = this.payload.players.find((p) => p.slot === slot);
      const def = CHARACTERS.find((c) => c.id === identity?.characterId);
      if (!def) return;
      const rig = buildCharacterRig(def);
      rig.setShadow(null, 0);
      const wrapper = new THREE.Group();
      wrapper.rotation.y = -Math.PI / 2; // face the camera
      wrapper.position.set(x, h, 0.1);
      wrapper.add(rig.root);
      this.group.add(wrapper);
      this.rigs.push(rig);
      this.fighters.push(new PodiumFighter(rig, place === 0, place));
    });

    // ---- DOM ----
    this.root = uiRoot('bf-online-screen bf-results-screen');

    // Confetti (CSS only, transform+fall animation).
    const confetti = el('div', 'bf-confetti', this.root);
    for (let i = 0; i < 42; i += 1) {
      const piece = el('span', 'bf-confetti-piece', confetti);
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
      piece.style.animationDelay = `${Math.random() * 3.2}s`;
      piece.style.animationDuration = `${2.6 + Math.random() * 2}s`;
      piece.style.width = piece.style.height = `${8 + Math.random() * 8}px`;
    }

    const header = el('div', 'bf-select-header', this.root);
    el('h1', 'bf-select-title', header).textContent = '🏆 RESULTS!';

    // Placement cards.
    const cardsRow = el('div', 'bf-place-row', this.root);
    this.payload.placements.forEach((slot, place) => {
      const identity = this.payload.players.find((p) => p.slot === slot);
      if (!identity) return;
      const card = el('div', 'bf-place-card', cardsRow);
      card.style.setProperty('--slot', SLOT_COLORS[slot] ?? '#ffffff');
      if (place === 0) card.classList.add('bf-place-winner');
      el('div', 'bf-place-medal', card).textContent = MEDALS[place] ?? `${place + 1}th`;
      el('div', 'bf-place-name', card).textContent = displayNameFor(identity.nickname, slot);
      const def = CHARACTERS.find((c) => c.id === identity.characterId);
      el('div', 'bf-place-char', card).textContent = def?.name ?? '???';
      const stats = el('div', 'bf-place-stats', card);
      el('span', '', stats).textContent = `💥 ${this.payload.kosBySlot[slot] ?? 0} KOs`;
      el('span', 'bf-place-gold', stats).textContent = `💰 +${this.payload.goldBySlot[slot] ?? 0}`;
    });

    // Buttons.
    const buttonRow = el('div', 'bf-results-buttons', this.root);
    this.rematchBtn = button('⚡ REMATCH!', () => this.voteRematch(), 'bf-button bf-button-green bf-button-big', buttonRow);
    if (this.client.isHost) {
      button(
        '⚙ CHANGE SETTINGS',
        () => {
          events.emit('ui', { kind: 'confirm' });
          this.client.backToLobby();
        },
        'bf-button bf-button-yellow',
        buttonRow,
      );
    }
    button(
      'LEAVE',
      () => {
        events.emit('ui', { kind: 'back' });
        this.client.leaveRoom();
        this.leave();
      },
      'bf-button bf-button-red',
      buttonRow,
    );

    this.unsubs.push(
      this.client.on('room', (room) => {
        if (this.navigated) return;
        if (room.phase === 'charSelect') {
          // Everyone voted rematch (picks kept).
          this.navigated = true;
          this.callbacks.onCharSelect();
        } else if (room.phase === 'lobby' || room.phase === 'countdown') {
          this.navigated = true;
          this.callbacks.onLobby();
        }
      }),
      this.client.on('roomClosed', ({ reason }) => {
        toast(reason === 'hostLeft' ? 'The host left — room closed!' : 'The room fell asleep!');
        this.leave();
      }),
      this.client.on('lost', () => {
        toast('Lost the arena connection!');
        this.leave();
      }),
    );

    events.emit('music', { mood: 'victory' });
  }

  private voteRematch(): void {
    events.emit('ui', { kind: 'confirm' });
    this.client.rematchVote();
    if (this.rematchBtn) {
      this.rematchBtn.disabled = true;
      // The protocol doesn't expose others' votes (see report) — the server
      // flips the room to charSelect the moment everyone has voted.
      this.rematchBtn.textContent = '⚡ WAITING FOR THE OTHERS…';
    }
  }

  private leave(): void {
    if (this.navigated) return;
    this.navigated = true;
    this.callbacks.onLeft();
  }

  exit(game: Game): void {
    for (const un of this.unsubs) un();
    this.unsubs = [];
    game.renderer.scene.remove(this.group);
    for (const rig of this.rigs) rig.dispose();
    this.rigs = [];
    this.fighters = [];
    for (const m of this.materials) m.dispose();
    this.materials = [];
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    this.group.clear();
    this.rematchBtn = null;
    this.root?.remove();
    this.root = null;
  }

  update(_game: Game, dt: number): void {
    for (const fighter of this.fighters) fighter.update(dt);
  }
}
