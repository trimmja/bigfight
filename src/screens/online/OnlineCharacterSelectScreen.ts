import * as THREE from 'three';
import type { RoomState } from '../../../shared/protocol';
import type { S2CMatchStart } from '../../../shared/protocol';
import { events } from '../../core/events';
import type { Game } from '../../Game';
import { CHARACTERS, characterById } from '../../data/characters';
import type { CharacterDef } from '../../data/types';
import type { LobbyClient } from '../../net/LobbyClient';
import { displayNameFor } from '../../net/nicknames';
import { buildCharacterRig } from '../../rigs/characterBuilders';
import type { Rig } from '../../rigs/FighterRig';
import { poseAttack, poseFightStance } from '../../rigs/poses';
import { buildCharacterGrid, type CharacterGrid } from '../../ui/characterGrid';
import { button, el, uiRoot } from '../../ui/dom';
import { FighterTurntable } from '../../ui/fighterPreview';
import { toast } from '../../ui/toasts';
import type { Screen } from '../Screen';
import { SLOT_COLORS } from './LobbyScreen';

/** Lineup spots above the banner strip, as fractions of camera half-width. */
const LINEUP_X = [-0.6, -0.2, 0.2, 0.6] as const;
const LINEUP_SCALE = 0.9;
/** Lineup feet height as a fraction of camera half-height (negative = low). */
const LINEUP_Y_FRAC = -0.74;

/** One picked fighter standing in the bottom lineup (greets on pick change). */
class LineupFighter {
  readonly group = new THREE.Group();
  readonly characterId: string;
  private readonly rig: Rig;
  private punchT = 0; // spawn with a greeting punch
  private t: number;

  constructor(def: CharacterDef, slot: number) {
    this.characterId = def.id;
    this.t = slot * 1.3; // desync the idle bounce per slot
    this.rig = buildCharacterRig(def);
    this.rig.setShadow(null, 0);
    this.group.add(this.rig.root);
    this.group.rotation.y = -Math.PI / 2; // face the camera
    this.group.scale.setScalar(LINEUP_SCALE);
  }

  update(dt: number): void {
    this.t += dt;
    const blend = 1 - Math.exp(-14 * dt);
    if (this.punchT >= 0) {
      this.punchT += dt * 2.4;
      if (this.punchT >= 1) this.punchT = -1;
      else this.rig.setPose(poseAttack('finisher', this.punchT), blend);
    }
    if (this.punchT < 0) this.rig.setPose(poseFightStance(this.t), blend);
    this.rig.update(dt);
  }

  dispose(): void {
    this.group.remove(this.rig.root);
    this.rig.dispose();
  }
}

/**
 * Online character select: your grid + big turntable (shared with campaign),
 * everyone's tentative picks broadcast live — slot banners along the bottom
 * with a 3D lineup of the picked fighters standing above them. READY locks
 * your pick; when the server starts the match, the READY-TO-FIGHT slam plays
 * and the netcode takes over.
 */
export class OnlineCharacterSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private turntable: FighterTurntable | null = null;
  private grid: CharacterGrid | null = null;
  private nameEl: HTMLElement | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private bannerEls: HTMLElement[] = [];
  private lineupGroup = new THREE.Group();
  private lineup = new Map<number, LineupFighter>();
  private selectedId = 'volt';
  private navigated = false;
  private slamPlayed = false;

  constructor(
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onMatch: (matchStart: S2CMatchStart) => void;
      onLobby: () => void;
      onLeft: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    this.turntable = new FighterTurntable();
    game.renderer.scene.add(this.turntable.group);
    game.renderer.scene.add(this.lineupGroup);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    this.root = uiRoot('bf-select-screen bf-online-select');
    const header = el('div', 'bf-select-header', this.root);
    button(
      '◀',
      () => {
        events.emit('ui', { kind: 'back' });
        this.client.leaveRoom();
        this.leave();
      },
      'bf-button bf-button-round',
      header,
    );
    el('h1', 'bf-select-title', header).textContent = 'PICK YOUR FIGHTER';
    el('div', 'bf-room-chip', header).textContent = `ROOM ${this.client.room?.code ?? ''}`;

    const body = el('div', 'bf-select-body', this.root);
    this.grid = buildCharacterGrid(body, game.save, (id) => this.select(id, true));
    this.turntable.attachDrag(this.root);

    const side = el('div', 'bf-select-side', body);
    this.nameEl = el('h2', 'bf-select-name', side);
    this.readyBtn = button(
      'READY!',
      () => this.toggleReady(),
      'bf-button bf-button-green bf-button-big',
      side,
    );

    // Slot banners along the bottom (skewed, slot-colored).
    const strip = el('div', 'bf-banner-strip', this.root);
    for (let slot = 0; slot < 4; slot += 1) {
      const banner = el('div', 'bf-banner-slot', strip);
      banner.style.setProperty('--slot', SLOT_COLORS[slot]!);
      this.bannerEls.push(banner);
    }

    this.unsubs.push(
      this.client.on('room', (room) => this.onRoom(room)),
      this.client.on('matchStart', (ms) => this.onMatchStart(ms)),
      this.client.on('roomClosed', ({ reason }) => {
        toast(reason === 'hostLeft' ? 'The host left — room closed!' : 'The room fell asleep!');
        this.leave();
      }),
      this.client.on('reconnecting', ({ attempt }) => {
        if (attempt === 1) toast('Whoops, reconnecting…');
      }),
      this.client.on('resumed', () => toast("You're back in!")),
      this.client.on('lost', () => {
        toast('Lost the arena connection!');
        this.leave();
      }),
    );

    // Start from my current pick (rematch keeps picks) or the default.
    const self = this.client.self;
    if (self?.characterId && CHARACTERS.some((c) => c.id === self.characterId)) {
      this.selectedId = self.characterId;
      this.select(this.selectedId, false);
    } else {
      this.select(this.selectedId, false);
      this.client.setPlayer({ pick: this.selectedId }); // broadcast tentative pick
    }
    if (this.client.room) this.onRoom(this.client.room);
  }

  private leave(): void {
    if (this.navigated) return;
    this.navigated = true;
    this.callbacks.onLeft();
  }

  private select(id: string, sfx: boolean): void {
    this.selectedId = id;
    if (sfx) {
      events.emit('ui', { kind: 'move' });
      this.client.setPlayer({ pick: id });
    }
    this.grid?.setSelected(id);
    const def = characterById(id);
    this.turntable?.setCharacter(def);
    if (this.nameEl) this.nameEl.textContent = def.name.toUpperCase();
  }

  private toggleReady(): void {
    const self = this.client.self;
    if (!self) return;
    const ready = !self.ready;
    events.emit('ui', { kind: ready ? 'confirm' : 'back' });
    this.client.setPlayer({ ready, ...(ready ? { pick: this.selectedId } : {}) });
    // Mirror instantly (server echo confirms via the next room snapshot).
    this.grid?.setEnabled(!ready);
    if (this.readyBtn) {
      this.readyBtn.classList.toggle('bf-ready-on', ready);
      this.readyBtn.textContent = ready ? '✔ READY — TAP TO CHANGE' : 'READY!';
    }
  }

  // ---------------------------------------------------------- room updates

  private onRoom(room: RoomState): void {
    if (this.navigated) return;
    if (room.phase === 'lobby' || room.phase === 'countdown') {
      // Host sent everyone back to the lobby settings.
      this.navigated = true;
      this.callbacks.onLobby();
      return;
    }

    const self = this.client.self;
    if (self && this.grid && this.readyBtn) {
      this.grid.setEnabled(!self.ready);
      this.readyBtn.classList.toggle('bf-ready-on', self.ready);
      this.readyBtn.textContent = self.ready ? '✔ READY — TAP TO CHANGE' : 'READY!';
    }

    // Banners + 3D lineup mirror everyone's live picks. Remote fighters
    // render fully even when this device hasn't unlocked them.
    for (let slot = 0; slot < 4; slot += 1) {
      const banner = this.bannerEls[slot];
      const p = room.players.find((q) => q.slot === slot);
      if (!banner) continue;
      banner.replaceChildren();
      banner.classList.toggle('bf-banner-empty', !p);
      if (!p) {
        el('span', 'bf-banner-name', banner).textContent = '—';
        this.dropLineup(slot);
        continue;
      }
      el('span', 'bf-banner-name', banner).textContent = displayNameFor(p.nickname, slot);
      const pickName = p.characterId ? safeCharacterName(p.characterId) : 'picking…';
      el('span', 'bf-banner-pick', banner).textContent = pickName;
      if (p.ready) {
        const stamp = el('span', 'bf-stamp bf-stamp-mini', banner);
        stamp.textContent = 'READY!';
      }

      // Lineup rig: swap (with a greeting punch) when the pick changes.
      const current = this.lineup.get(slot);
      if (p.characterId && CHARACTERS.some((c) => c.id === p.characterId)) {
        if (!current || current.characterId !== p.characterId) {
          current?.dispose();
          if (current) this.lineupGroup.remove(current.group);
          const fighter = new LineupFighter(characterById(p.characterId), slot);
          this.lineupGroup.add(fighter.group);
          this.lineup.set(slot, fighter);
        }
      } else {
        this.dropLineup(slot);
      }
    }
  }

  private dropLineup(slot: number): void {
    const fighter = this.lineup.get(slot);
    if (!fighter) return;
    fighter.dispose();
    this.lineupGroup.remove(fighter.group);
    this.lineup.delete(slot);
  }

  // ------------------------------------------------------------ match start

  private onMatchStart(ms: S2CMatchStart): void {
    if (this.slamPlayed) return;
    this.slamPlayed = true;
    events.emit('ui', { kind: 'confirm' });
    this.playSlam(() => {
      if (this.navigated) return;
      this.navigated = true;
      this.callbacks.onMatch(ms);
    });
  }

  /** READY-TO-FIGHT: two navy panels slam shut with a text sweep. */
  private playSlam(onCovered: () => void): void {
    if (!this.root) {
      onCovered();
      return;
    }
    const slam = el('div', 'bf-fight-slam', this.root);
    el('div', 'bf-slam-panel bf-slam-left', slam);
    el('div', 'bf-slam-panel bf-slam-right', slam);
    el('div', 'bf-slam-text', slam).textContent = 'READY TO FIGHT!';
    setTimeout(() => {
      onCovered();
      // Netcode replaces the screen during cover; if the stub left us here
      // (no navigation yet), open back up so the room isn't stuck hidden.
      setTimeout(() => {
        if (slam.isConnected) slam.remove();
        this.slamPlayed = false;
        this.navigated = false;
      }, 700);
    }, 950);
  }

  exit(game: Game): void {
    for (const un of this.unsubs) un();
    this.unsubs = [];
    if (this.turntable) {
      game.renderer.scene.remove(this.turntable.group);
      this.turntable.dispose();
      this.turntable = null;
    }
    for (const [, fighter] of this.lineup) {
      fighter.dispose();
      this.lineupGroup.remove(fighter.group);
    }
    this.lineup.clear();
    game.renderer.scene.remove(this.lineupGroup);
    this.grid = null;
    this.bannerEls = [];
    this.root?.remove();
    this.root = null;
  }

  update(game: Game, dt: number): void {
    const cam = game.renderer.camera;
    this.turntable?.update(cam, dt);

    // Lineup placement, aspect-aware every frame (same z=10 plane as preview).
    const dist = cam.position.z - 10;
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * dist;
    const halfW = halfH * cam.aspect;
    for (const [slot, fighter] of this.lineup) {
      fighter.group.position.set(LINEUP_X[slot]! * halfW, halfH * LINEUP_Y_FRAC, 10);
      fighter.update(dt);
    }
  }
}

/** Character name for a remote pick; tolerate ids from newer builds. */
function safeCharacterName(id: string): string {
  const def = CHARACTERS.find((c) => c.id === id);
  return def ? def.name : '???';
}
