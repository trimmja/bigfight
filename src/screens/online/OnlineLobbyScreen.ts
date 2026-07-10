import {
  VERSUS_STAGE_IDS,
  type RoomPlayer,
  type RoomState,
  type S2CMatchStart,
  type StockCount,
} from '../../../shared/protocol';
import { events } from '../../core/events';
import type { Game } from '../../Game';
import { CHARACTERS, characterById } from '../../data/characters';
import { stageById } from '../../data/stages';
import type { LobbyClient } from '../../net/LobbyClient';
import { displayNameFor, isProfane, sanitizeNickname } from '../../net/nicknames';
import { buildCharacterGrid, type CharacterGrid } from '../../ui/characterGrid';
import { button, el, uiRoot } from '../../ui/dom';
import { toast } from '../../ui/toasts';
import type { Screen } from '../Screen';
import { MODES } from './modes';
import { PedestalStage } from './PedestalStage';

/** P1 cyan / P2 pink / P3 yellow / P4 green (CSS strings). */
export const SLOT_COLORS = ['#1a9fe8', '#ff5a8a', '#ffc93e', '#4ec95c'] as const;
/** Same, as numeric hex for the 3D pedestals/spotlights. */
const SLOT_COLORS_HEX = SLOT_COLORS.map((c) => parseInt(c.slice(1), 16));
const MAX_LEVEL = 12;

/**
 * THE cinematic battle lobby — one 3D room where you pick your fighter on a
 * lit pedestal, watch everyone else's picks appear live, and ready up. No
 * separate char-select screen: pick + ready happen here, the server starts the
 * match when all are picked + ready. Camera flies in; pedestals spotlight the
 * fighters; nameplates float beneath them; readying pops a color surge.
 */
export class OnlineLobbyScreen implements Screen {
  private root: HTMLElement | null = null;
  private stage: PedestalStage | null = null;
  private plateLayer: HTMLElement | null = null;
  private plates: HTMLElement[] = [];
  private grid: CharacterGrid | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private settingsBtn: HTMLButtonElement | null = null;
  private settingsPanel: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: (() => void)[] = [];
  private selectedId = 'volt';
  private navigated = false;
  private slamPlayed = false;
  private sentAutoTeam = false;
  private prevSig = '';

  constructor(
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onMatch: (matchStart: S2CMatchStart) => void;
      onLeft: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    this.stage = new PedestalStage(game.renderer.scene, SLOT_COLORS_HEX);
    this.stage.startFlyIn(game.renderer.camera);

    this.root = uiRoot('bf-online-screen bf-arena');

    // --- header ---
    const header = el('div', 'bf-select-header bf-arena-header', this.root);
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
    el('h1', 'bf-select-title', header).textContent = 'BATTLE LOBBY';
    const codeChip = el('button', 'bf-room-chip bf-room-chip-btn', header) as HTMLButtonElement;
    codeChip.type = 'button';
    codeChip.textContent = `ROOM ${this.client.room?.code ?? '····'}  📣`;
    codeChip.addEventListener('click', () => this.share());
    this.settingsBtn = button('⚙', () => this.toggleSettings(), 'bf-button bf-button-round bf-arena-gear', header);

    // --- floating nameplates (positioned under each pedestal every frame) ---
    this.plateLayer = el('div', 'bf-plate-layer', this.root);
    for (let slot = 0; slot < 4; slot += 1) {
      const plate = el('div', 'bf-plate', this.plateLayer);
      plate.style.setProperty('--slot', SLOT_COLORS[slot]!);
      this.plates.push(plate);
    }

    // --- bottom bar: your fighter carousel + big READY ---
    const bar = el('div', 'bf-arena-bar', this.root);
    const pickWrap = el('div', 'bf-arena-pick', bar);
    el('div', 'bf-arena-pick-label', pickWrap).textContent = 'YOUR FIGHTER';
    this.grid = buildCharacterGrid(pickWrap, game.save, (id) => this.select(id, true));
    this.readyBtn = button('READY!', () => this.toggleReady(), 'bf-button bf-button-green bf-button-big bf-arena-ready', bar);

    this.unsubs.push(
      this.client.on('room', (room) => this.onRoom(room)),
      this.client.on('matchStart', (ms) => this.onMatchStart(ms)),
      this.client.on('countdown', ({ seconds }) => this.startCountdown(seconds)),
      this.client.on('countdownCancelled', ({ by }) => this.cancelCountdown(by)),
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

    // Pick up where we left off (rematch keeps picks) or default, and broadcast
    // so my fighter appears on my pedestal for everyone immediately.
    const self = this.client.self;
    const startId = self?.characterId && CHARACTERS.some((c) => c.id === self.characterId) ? self.characterId : 'volt';
    this.select(startId, false);
    if (self?.characterId !== startId) this.client.setPlayer({ pick: startId });

    if (this.client.room) this.onRoom(this.client.room);
  }

  private leave(): void {
    if (this.navigated) return;
    this.navigated = true;
    this.callbacks.onLeft();
  }

  private select(id: string, broadcast: boolean): void {
    this.selectedId = id;
    this.grid?.setSelected(id);
    const mySlot = this.client.self?.slot;
    if (mySlot !== undefined) this.stage?.setFighter(mySlot, id);
    if (broadcast) {
      events.emit('ui', { kind: 'move' });
      this.client.setPlayer({ pick: id });
    }
  }

  private toggleReady(): void {
    const self = this.client.self;
    if (!self) return;
    const ready = !self.ready;
    events.emit('ui', { kind: ready ? 'confirm' : 'back' });
    this.client.setPlayer({ ready, ...(ready ? { pick: this.selectedId } : {}) });
    this.grid?.setEnabled(!ready);
    if (this.readyBtn) {
      this.readyBtn.classList.toggle('bf-ready-on', ready);
      this.readyBtn.textContent = ready ? '✔ READY!' : 'READY!';
    }
  }

  // --------------------------------------------------------- room updates

  private onRoom(room: RoomState): void {
    if (this.navigated) return;
    if (room.phase === 'starting' || room.phase === 'match') return; // matchStart drives the transition

    // 2v2: claim a team by slot parity once.
    const self = this.client.self;
    if (room.settings.mode === 'teams') {
      if (self && self.team === null && !this.sentAutoTeam) {
        this.sentAutoTeam = true;
        this.client.setPlayer({ team: self.slot % 2 === 0 ? 'A' : 'B' });
      }
    } else {
      this.sentAutoTeam = false;
    }

    if (self) this.stage?.setLocal(self.slot);

    // Signature-gate: only touch the DOM/3D when the visible state changes
    // (the server re-broadcasts ~1/s for pings — never rebuild on those).
    const sig = this.roomSignature(room);
    if (sig !== this.prevSig) {
      this.prevSig = sig;
      this.applyRoom(room);
    } else {
      this.updatePlatePings(room);
    }

    // Ready button mirrors my state.
    if (this.readyBtn && self) {
      this.readyBtn.classList.toggle('bf-ready-on', self.ready);
      this.readyBtn.textContent = self.ready ? '✔ READY!' : 'READY!';
      this.grid?.setEnabled(!self.ready);
    }
  }

  private applyRoom(room: RoomState): void {
    // Fighters + ready surges on the pedestals.
    for (let slot = 0; slot < 4; slot += 1) {
      const p = room.players.find((q) => q.slot === slot);
      this.stage?.setFighter(slot, p?.characterId ?? null);
      this.stage?.setReady(slot, p?.ready ?? false);
      this.renderPlate(room, slot, p);
    }
    if (this.settingsPanel) this.renderSettings(room);
    // Host gear only if I'm host.
    if (this.settingsBtn) this.settingsBtn.style.display = this.client.isHost ? '' : 'none';
  }

  private renderPlate(room: RoomState, slot: number, p: RoomPlayer | undefined): void {
    const plate = this.plates[slot];
    if (!plate) return;
    plate.replaceChildren();
    plate.classList.toggle('bf-plate-empty', !p);
    plate.classList.toggle('bf-plate-ready', !!p?.ready);
    plate.classList.toggle('bf-plate-me', p?.playerId === this.client.selfId);
    if (!p) {
      plate.textContent = 'OPEN';
      return;
    }
    const top = el('div', 'bf-plate-top', plate);
    el('span', 'bf-plate-num', top).textContent = `P${slot + 1}`;
    if (p.playerId === room.hostId) el('span', '', top).textContent = '👑';
    const ping = this.pingFor(p);
    const dot = el('span', `bf-ping-dot ${ping.cls}${ping.p2p ? '' : ' bf-ping-hollow'}`, top);
    dot.title = ping.ms === null ? 'measuring…' : `${ping.ms}ms`;
    const name = el('div', 'bf-plate-name', plate);
    name.textContent = displayNameFor(p.nickname, slot);
    if (p.characterId) el('div', 'bf-plate-char', plate).textContent = safeCharName(p.characterId);
    if (room.settings.mode === 'teams' && p.team) {
      plate.classList.add(p.team === 'A' ? 'bf-plate-team-a' : 'bf-plate-team-b');
    }
    if (p.ready) el('div', 'bf-plate-check', plate).textContent = 'READY!';
    if (!p.connected) el('div', 'bf-plate-away', plate).textContent = '📶…';
  }

  private updatePlatePings(room: RoomState): void {
    for (const p of room.players) {
      const dot = this.plates[p.slot]?.querySelector('.bf-ping-dot');
      if (!(dot instanceof HTMLElement)) continue;
      const ping = this.pingFor(p);
      dot.className = `bf-ping-dot ${ping.cls}${ping.p2p ? '' : ' bf-ping-hollow'}`;
      dot.title = ping.ms === null ? 'measuring…' : `${ping.ms}ms`;
    }
  }

  private roomSignature(room: RoomState): string {
    const parts = [room.code, room.hostId, room.settings.mode, `${room.settings.stocks}`, room.settings.stageId, `${room.settings.levelId ?? '-'}`, `${room.maxLevelAllowed}`, this.client.isHost ? 'h' : 'g'];
    for (let slot = 0; slot < 4; slot += 1) {
      const p = room.players.find((q) => q.slot === slot);
      parts.push(p ? `${p.playerId}|${p.nickname}|${p.characterId ?? '-'}|${p.ready ? 1 : 0}|${p.team ?? '-'}|${p.connected ? 1 : 0}` : 'x');
    }
    return parts.join('~');
  }

  // ------------------------------------------------------- host settings

  private toggleSettings(): void {
    if (!this.client.isHost || !this.root) return;
    events.emit('ui', { kind: 'confirm' });
    if (this.settingsPanel) {
      this.settingsPanel.remove();
      this.settingsPanel = null;
      return;
    }
    this.settingsPanel = el('div', 'bf-arena-settings', this.root);
    const room = this.client.room;
    if (room) this.renderSettings(room);
  }

  private renderSettings(room: RoomState): void {
    const panel = this.settingsPanel;
    if (!panel) return;
    panel.replaceChildren();
    const s = room.settings;

    el('div', 'bf-ctrl-label', panel).textContent = 'GAME MODE';
    const modeRow = el('div', 'bf-mode-pick', panel);
    for (const m of MODES) {
      const b = el('button', 'bf-mode-pill' + (s.mode === m.id ? ' bf-mode-pill-on' : ''), modeRow);
      b.type = 'button';
      b.style.setProperty('--mode', m.color);
      el('span', 'bf-mode-pill-icon', b).textContent = m.icon;
      el('span', 'bf-mode-pill-name', b).textContent = m.short;
      b.addEventListener('click', () => {
        if (s.mode === m.id) return;
        events.emit('ui', { kind: 'move' });
        this.client.setSettings({ mode: m.id, ...(m.id === 'coop' && s.levelId === null ? { levelId: 1 } : {}) });
      });
    }

    const row = el('div', 'bf-ctrl-row', panel);
    const stocksGroup = el('div', 'bf-ctrl-group', row);
    el('div', 'bf-ctrl-label', stocksGroup).textContent = s.mode === 'coop' ? '❤️ LIVES' : '❤️ STOCKS';
    const stepper = el('div', 'bf-stepper', stocksGroup);
    const minus = el('button', 'bf-button bf-stepper-btn', stepper);
    minus.type = 'button';
    minus.textContent = '−';
    el('span', 'bf-stepper-value', stepper).textContent = String(s.stocks);
    const plus = el('button', 'bf-button bf-stepper-btn', stepper);
    plus.type = 'button';
    plus.textContent = '+';
    minus.disabled = s.stocks <= 1;
    plus.disabled = s.stocks >= 5;
    minus.addEventListener('click', () => this.client.setSettings({ stocks: Math.max(1, s.stocks - 1) as StockCount }));
    plus.addEventListener('click', () => this.client.setSettings({ stocks: Math.min(5, s.stocks + 1) as StockCount }));

    const stageGroup = el('div', 'bf-ctrl-group bf-ctrl-stage', row);
    el('div', 'bf-ctrl-label', stageGroup).textContent = s.mode === 'coop' ? '🗺️ LEVEL' : '🏟️ STAGE';
    const chipRow = el('div', 'bf-chip-row', stageGroup);
    if (s.mode === 'coop') {
      for (let lvl = 1; lvl <= MAX_LEVEL; lvl += 1) {
        const locked = lvl > room.maxLevelAllowed;
        const chip = el('button', 'bf-chip bf-chip-level' + (s.levelId === lvl ? ' bf-chip-on' : '') + (locked ? ' bf-chip-locked' : ''), chipRow);
        chip.type = 'button';
        chip.textContent = locked ? `🔒${lvl}` : String(lvl);
        chip.disabled = locked;
        if (!locked) chip.addEventListener('click', () => this.client.setSettings({ levelId: lvl }));
      }
    } else {
      for (const stageId of VERSUS_STAGE_IDS) {
        const stage = stageById(stageId);
        const chip = el('button', 'bf-chip' + (s.stageId === stageId ? ' bf-chip-on' : ''), chipRow);
        chip.type = 'button';
        const sw = el('span', 'bf-chip-swatch', chip);
        sw.style.background = `#${stage.skyColor.toString(16).padStart(6, '0')}`;
        el('span', '', chip).textContent = stage.name;
        chip.addEventListener('click', () => this.client.setSettings({ stageId }));
      }
      const rnd = el('button', 'bf-chip' + (s.stageId === 'random' ? ' bf-chip-on' : ''), chipRow);
      rnd.type = 'button';
      rnd.textContent = '🎲 RANDOM';
      rnd.addEventListener('click', () => this.client.setSettings({ stageId: 'random' }));
    }
  }

  // -------------------------------------------------------- match / countdown

  private onMatchStart(ms: S2CMatchStart): void {
    if (this.slamPlayed) return;
    this.slamPlayed = true;
    this.stopCountdown();
    const slam = el('div', 'bf-fight-slam', this.root ?? document.body);
    el('div', 'bf-slam-panel bf-slam-left', slam);
    el('div', 'bf-slam-panel bf-slam-right', slam);
    el('div', 'bf-slam-text', slam).textContent = 'READY TO FIGHT!';
    events.emit('announce', { id: 'ann_readytofight' });
    setTimeout(() => {
      if (this.navigated) return;
      this.navigated = true;
      this.callbacks.onMatch(ms);
    }, 900);
  }

  private startCountdown(seconds: number): void {
    this.stopCountdown();
    if (!this.root) return;
    this.countdownEl = el('div', 'bf-countdown', this.root);
    const num = el('div', 'bf-count-num', this.countdownEl);
    let remaining = seconds;
    const show = (): void => {
      num.textContent = String(remaining);
      num.classList.remove('bf-count-pop');
      void num.offsetWidth;
      num.classList.add('bf-count-pop');
      events.emit('ui', { kind: 'move' });
    };
    show();
    this.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) this.stopCountdown();
      else show();
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownEl?.remove();
    this.countdownEl = null;
  }

  private cancelCountdown(by: string): void {
    this.stopCountdown();
    events.emit('ui', { kind: 'error' });
    const clean = sanitizeNickname(by);
    toast(`${clean.length > 0 && !isProfane(clean) ? clean : 'Someone'} isn't ready!`);
  }

  // ------------------------------------------------------------- helpers

  private share(): void {
    const code = this.client.room?.code;
    if (!code) return;
    events.emit('ui', { kind: 'confirm' });
    const url = `${location.origin}${location.pathname}?join=${code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      nav.share({ title: 'BIG FIGHT', text: `Join my BIG FIGHT room! Code: ${code}`, url }).catch(() => undefined);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast('Link copied — send it to a friend!')).catch(() => toast(`Room code: ${code}`));
    } else {
      toast(`Room code: ${code}`);
    }
  }

  private pingFor(p: RoomPlayer): { ms: number | null; cls: string; p2p: boolean } {
    const myId = this.client.selfId;
    let ms: number | null = null;
    let p2p = false;
    if (p.playerId === myId) ms = this.client.rttMs;
    else if (myId !== null && typeof p.pings[myId] === 'number') { ms = p.pings[myId]!; p2p = true; }
    else if (typeof p.pings[p.playerId] === 'number') ms = p.pings[p.playerId]!;
    const cls = ms === null ? 'bf-ping-unknown' : ms <= 80 ? 'bf-ping-good' : ms <= 160 ? 'bf-ping-ok' : 'bf-ping-bad';
    return { ms, cls, p2p };
  }

  update(game: Game, dt: number): void {
    const stage = this.stage;
    if (!stage) return;
    const cam = game.renderer.camera;
    stage.update(cam, dt);

    // Float the DOM nameplates just above each fighter's head (follows the
    // camera drift). CSS seats the card above this anchor point.
    for (let slot = 0; slot < 4; slot += 1) {
      const plate = this.plates[slot];
      if (!plate) continue;
      const pos = stage.nameplateScreenPos(slot, cam);
      plate.style.left = `${pos.x * 100}%`;
      plate.style.top = `${pos.y * 100}%`;
    }
  }

  exit(game: Game): void {
    this.stopCountdown();
    for (const un of this.unsubs) un();
    this.unsubs = [];
    this.stage?.dispose();
    this.stage = null;
    this.plates = [];
    this.grid = null;
    this.readyBtn = null;
    this.settingsBtn = null;
    this.settingsPanel = null;
    this.plateLayer = null;
    this.root?.remove();
    this.root = null;
    void game;
  }
}

function safeCharName(id: string): string {
  return CHARACTERS.some((c) => c.id === id) ? characterById(id).name.toUpperCase() : '???';
}
