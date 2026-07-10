import {
  VERSUS_STAGE_IDS,
  type RoomPlayer,
  type RoomSettings,
  type RoomState,
  type StockCount,
} from '../../../shared/protocol';
import { events } from '../../core/events';
import type { Game } from '../../Game';
import { stageById } from '../../data/stages';
import type { LobbyClient } from '../../net/LobbyClient';
import { displayNameFor, isProfane, sanitizeNickname } from '../../net/nicknames';
import { button, el, uiRoot } from '../../ui/dom';
import { toast } from '../../ui/toasts';
import type { Screen } from '../Screen';
import { MODES } from './modes';

/** Slot identity colors: P1 cyan / P2 pink / P3 yellow / P4 green. */
export const SLOT_COLORS = ['#1a9fe8', '#ff5a8a', '#ffc93e', '#4ec95c'] as const;

const MAX_LEVEL = 12;

/**
 * The battle lobby: 4 slot cards (crown, nickname, ready stamp, ping dot,
 * share card for the first empty seat), host match settings (guests watch
 * them live), the big READY! toggle, and the server 3-2-1 countdown.
 */
export class LobbyScreen implements Screen {
  private root: HTMLElement | null = null;
  private slotsRow: HTMLElement | null = null;
  private controlsWrap: HTMLElement | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private readyHint: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: (() => void)[] = [];
  private prevSettings: RoomSettings | null = null;
  private prevReady = new Map<number, boolean>();
  private sentAutoTeam = false;
  private navigated = false;
  // Re-render slots/controls ONLY when their visible state changes. The server
  // re-broadcasts the room ~1/s for ping updates; without this the slot cards
  // rebuild every second and replay their pop-in animation (the "pulsing").
  private prevSlotSig = '';
  private prevControlSig = '';

  constructor(
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onCharSelect: () => void;
      onLeft: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    this.root = uiRoot('bf-online-screen bf-lobby-screen');
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
    el('h1', 'bf-select-title', header).textContent = 'BATTLE LOBBY';
    const codeChip = el('div', 'bf-room-chip', header);
    codeChip.textContent = `ROOM ${this.client.room?.code ?? '····'}`;

    this.slotsRow = el('div', 'bf-slot-row', this.root);
    this.controlsWrap = el('div', 'bf-lobby-controls', this.root);

    const readyRow = el('div', 'bf-ready-row', this.root);
    this.readyBtn = button(
      'READY!',
      () => this.toggleReady(),
      'bf-button bf-button-green bf-button-big bf-ready-btn',
      readyRow,
    );
    this.readyHint = el('div', 'bf-online-hint', readyRow);

    this.unsubs.push(
      this.client.on('room', (room) => this.renderRoom(room)),
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

    const room = this.client.room;
    if (room) this.renderRoom(room);
    else this.leave();
  }

  private leave(): void {
    if (this.navigated) return;
    this.navigated = true;
    this.callbacks.onLeft();
  }

  private toggleReady(): void {
    const self = this.client.self;
    if (!self) return;
    events.emit('ui', { kind: self.ready ? 'back' : 'confirm' });
    this.client.setPlayer({ ready: !self.ready });
  }

  // ------------------------------------------------------------- rendering

  private renderRoom(room: RoomState): void {
    if (this.navigated) return;
    if (room.phase === 'charSelect' || room.phase === 'starting' || room.phase === 'match') {
      this.navigated = true;
      this.callbacks.onCharSelect();
      return;
    }

    // 2v2 needs everyone on a team — pick mine by slot parity once.
    const self = this.client.self;
    if (room.settings.mode === 'teams') {
      if (self && self.team === null && !this.sentAutoTeam) {
        this.sentAutoTeam = true;
        this.client.setPlayer({ team: self.slot % 2 === 0 ? 'A' : 'B' });
      }
    } else {
      this.sentAutoTeam = false;
    }

    // Only rebuild the slot cards when the roster/ready/team actually changes
    // (NOT on ping-only snapshots) — otherwise the pop-in animation re-fires
    // every second. Pings update in place so the dots stay live.
    const slotSig = this.slotSignature(room);
    if (slotSig !== this.prevSlotSig) {
      this.prevSlotSig = slotSig;
      this.renderSlots(room);
    } else {
      this.updatePingDots(room);
    }
    const controlSig = this.controlSignature(room);
    if (controlSig !== this.prevControlSig) {
      this.prevControlSig = controlSig;
      this.renderControls(room);
    }

    // Ready button mirrors my state.
    if (this.readyBtn && self) {
      this.readyBtn.classList.toggle('bf-ready-on', self.ready);
      this.readyBtn.textContent = self.ready ? '✔ READY — TAP TO WAIT' : 'READY!';
    }
    if (this.readyHint) {
      const others = room.players.filter((p) => p.connected).length;
      this.readyHint.textContent =
        others < 2 ? 'Waiting for friends to join…' : "Game starts when everyone's ready!";
    }

    // Remember for change-wiggles + stamp slams.
    this.prevSettings = { ...room.settings };
    this.prevReady.clear();
    for (const p of room.players) this.prevReady.set(p.slot, p.ready);
  }

  /** Everything that changes the slot CARDS — excludes rapidly-moving pings. */
  private slotSignature(room: RoomState): string {
    const parts = [room.code, room.hostId, room.settings.mode];
    for (let slot = 0; slot < 4; slot += 1) {
      const p = room.players.find((q) => q.slot === slot);
      parts.push(
        p ? `${p.playerId}|${p.nickname}|${p.ready ? 1 : 0}|${p.team ?? '-'}|${p.connected ? 1 : 0}` : 'empty',
      );
    }
    return parts.join('~');
  }

  /** Everything the host-controls row renders (mode/stocks/stage/level). */
  private controlSignature(room: RoomState): string {
    const s = room.settings;
    return `${this.client.isHost ? 'h' : 'g'}~${s.mode}~${s.stocks}~${s.stageId}~${s.levelId ?? '-'}~${room.maxLevelAllowed}`;
  }

  /** Ping-only snapshot: refresh the dots in place — no card rebuild, no pulse. */
  private updatePingDots(room: RoomState): void {
    if (!this.slotsRow) return;
    for (const p of room.players) {
      const card = this.slotsRow.querySelector(`.bf-slot[data-slot="${p.slot}"]`);
      const dot = card?.querySelector('.bf-ping-dot');
      if (!(dot instanceof HTMLElement)) continue;
      const ping = this.pingFor(p);
      dot.className = `bf-ping-dot ${ping.cls}${ping.p2p ? '' : ' bf-ping-hollow'}`;
      dot.title = ping.ms === null ? 'measuring…' : `${ping.ms}ms`;
    }
  }

  private renderSlots(room: RoomState): void {
    if (!this.slotsRow) return;
    this.slotsRow.replaceChildren();
    let sharePlaced = false;
    for (let slot = 0; slot < 4; slot += 1) {
      const p = room.players.find((q) => q.slot === slot);
      if (p) this.renderPlayerSlot(room, p);
      else if (!sharePlaced) {
        sharePlaced = true;
        this.renderShareSlot(room);
      } else {
        const empty = el('div', 'bf-slot bf-slot-empty', this.slotsRow);
        el('div', 'bf-slot-waiting', empty).textContent = 'waiting…';
      }
    }
  }

  private renderPlayerSlot(room: RoomState, p: RoomPlayer): void {
    if (!this.slotsRow) return;
    const isSelf = p.playerId === this.client.selfId;
    const card = el('div', 'bf-slot bf-slot-filled', this.slotsRow);
    card.dataset.slot = String(p.slot);
    card.style.setProperty('--slot', SLOT_COLORS[p.slot]!);
    if (!p.connected) card.classList.add('bf-slot-away');

    const top = el('div', 'bf-slot-top', card);
    el('span', 'bf-slot-num', top).textContent = `P${p.slot + 1}`;
    if (p.playerId === room.hostId) el('span', 'bf-slot-crown', top).textContent = '👑';
    const ping = this.pingFor(p);
    const dot = el('span', `bf-ping-dot ${ping.cls}${ping.p2p ? '' : ' bf-ping-hollow'}`, top);
    dot.title = ping.ms === null ? 'measuring…' : `${ping.ms}ms`;

    const name = el('div', 'bf-slot-name', card);
    name.textContent = displayNameFor(p.nickname, p.slot);
    if (isSelf) el('div', 'bf-slot-you', card).textContent = 'YOU';
    if (!p.connected) el('div', 'bf-slot-away-tag', card).textContent = 'reconnecting…';

    if (room.settings.mode === 'teams') {
      const team = p.team ?? (p.slot % 2 === 0 ? 'A' : 'B');
      const badge = el(
        'button',
        `bf-team-badge ${team === 'A' ? 'bf-team-cyan' : 'bf-team-pink'}`,
        card,
      );
      badge.type = 'button';
      badge.textContent = team === 'A' ? 'TEAM CYAN' : 'TEAM PINK';
      // Protocol note: setPlayer only edits the SENDER's slot, so only your
      // own badge is tappable (the host can't move other players).
      badge.disabled = !isSelf;
      if (isSelf) {
        badge.addEventListener('click', () => {
          events.emit('ui', { kind: 'move' });
          this.client.setPlayer({ team: team === 'A' ? 'B' : 'A' });
        });
      }
    }

    if (p.ready) {
      const stamp = el('div', 'bf-stamp', card);
      stamp.textContent = 'READY!';
      if (!this.prevReady.get(p.slot)) stamp.classList.add('bf-stamp-slam');
    }
  }

  private renderShareSlot(room: RoomState): void {
    if (!this.slotsRow) return;
    const card = el('div', 'bf-slot bf-slot-share', this.slotsRow);
    el('div', 'bf-share-label', card).textContent = 'INVITE A FRIEND!';
    el('div', 'bf-share-code', card).textContent = room.code;
    button('📣 SHARE', () => this.share(room.code), 'bf-button bf-button-violet bf-share-btn', card);
    el('div', 'bf-share-link', card).textContent = `${shareUrl(room.code)}`;
  }

  private share(code: string): void {
    events.emit('ui', { kind: 'confirm' });
    const url = shareUrl(code);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      nav.share({ title: 'BIG FIGHT', text: `Join my BIG FIGHT room! Code: ${code}`, url }).catch(() => {
        /* user cancelled the share sheet */
      });
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(url)
        .then(() => toast('Link copied — send it to a friend!'))
        .catch(() => toast(`Room code: ${code}`));
    } else {
      toast(`Room code: ${code}`);
    }
  }

  private pingFor(p: RoomPlayer): { ms: number | null; cls: string; p2p: boolean } {
    const myId = this.client.selfId;
    let ms: number | null = null;
    let p2p = false;
    if (p.playerId === myId) {
      ms = this.client.rttMs;
    } else if (myId !== null && typeof p.pings[myId] === 'number') {
      ms = p.pings[myId]!; // true peer RTT (netcode layer reports these)
      p2p = true;
    } else if (typeof p.pings[p.playerId] === 'number') {
      ms = p.pings[p.playerId]!; // their self-reported server RTT
    }
    const cls =
      ms === null
        ? 'bf-ping-unknown'
        : ms <= 80
          ? 'bf-ping-good'
          : ms <= 160
            ? 'bf-ping-ok'
            : 'bf-ping-bad';
    return { ms, cls, p2p };
  }

  // ---------------------------------------------------- host match settings

  private renderControls(room: RoomState): void {
    if (!this.controlsWrap) return;
    this.controlsWrap.replaceChildren();
    const isHost = this.client.isHost;
    const s = room.settings;
    const prev = this.prevSettings;

    // --- GAME MODE group: big icon buttons, not tiny pills ---
    const modeGroup = el('div', 'bf-ctrl-group bf-ctrl-mode', this.controlsWrap);
    el('div', 'bf-ctrl-label', modeGroup).textContent = 'GAME MODE';
    const modeRow = el('div', 'bf-mode-pick', modeGroup);
    for (const m of MODES) {
      const b = el('button', 'bf-mode-pill' + (s.mode === m.id ? ' bf-mode-pill-on' : ''), modeRow);
      b.type = 'button';
      b.style.setProperty('--mode', m.color);
      el('span', 'bf-mode-pill-icon', b).textContent = m.icon;
      el('span', 'bf-mode-pill-name', b).textContent = m.short;
      b.disabled = !isHost;
      if (isHost) {
        b.addEventListener('click', () => {
          if (s.mode === m.id) return;
          events.emit('ui', { kind: 'move' });
          this.client.setSettings({
            mode: m.id,
            ...(m.id === 'coop' && s.levelId === null ? { levelId: 1 } : {}),
          });
        });
      }
    }
    if (!isHost && prev && prev.mode !== s.mode) wobble(modeRow);

    // --- LIVES + STAGE/LEVEL, grouped side by side ---
    const settingsRow = el('div', 'bf-ctrl-row', this.controlsWrap);

    const stocksGroup = el('div', 'bf-ctrl-group', settingsRow);
    el('div', 'bf-ctrl-label', stocksGroup).textContent = s.mode === 'coop' ? '❤️ LIVES' : '❤️ STOCKS';
    const stocksRow = el('div', 'bf-stepper', stocksGroup);
    const minus = el('button', 'bf-button bf-stepper-btn', stocksRow);
    minus.type = 'button';
    minus.textContent = '−';
    el('span', 'bf-stepper-value', stocksRow).textContent = String(s.stocks);
    const plus = el('button', 'bf-button bf-stepper-btn', stocksRow);
    plus.type = 'button';
    plus.textContent = '+';
    minus.disabled = !isHost || s.stocks <= 1;
    plus.disabled = !isHost || s.stocks >= 5;
    if (isHost) {
      minus.addEventListener('click', () => {
        events.emit('ui', { kind: 'move' });
        this.client.setSettings({ stocks: Math.max(1, s.stocks - 1) as StockCount });
      });
      plus.addEventListener('click', () => {
        events.emit('ui', { kind: 'move' });
        this.client.setSettings({ stocks: Math.min(5, s.stocks + 1) as StockCount });
      });
    }
    if (!isHost && prev && prev.stocks !== s.stocks) wobble(stocksRow);

    // Stage chips (versus) or level strip (co-op).
    const stageGroup = el('div', 'bf-ctrl-group bf-ctrl-stage', settingsRow);
    el('div', 'bf-ctrl-label', stageGroup).textContent = s.mode === 'coop' ? '🗺️ LEVEL' : '🏟️ STAGE';
    const stageRow = el('div', 'bf-chip-row', stageGroup);
    if (s.mode === 'coop') {
      for (let lvl = 1; lvl <= MAX_LEVEL; lvl += 1) {
        const locked = lvl > room.maxLevelAllowed;
        const chip = el(
          'button',
          'bf-chip bf-chip-level' + (s.levelId === lvl ? ' bf-chip-on' : '') + (locked ? ' bf-chip-locked' : ''),
          stageRow,
        );
        chip.type = 'button';
        chip.textContent = locked ? `🔒${lvl}` : String(lvl);
        chip.disabled = !isHost || locked;
        if (isHost && !locked) {
          chip.addEventListener('click', () => {
            events.emit('ui', { kind: 'move' });
            this.client.setSettings({ levelId: lvl });
          });
        }
      }
      if (!isHost && prev && prev.levelId !== s.levelId) wobble(stageRow);
    } else {
      for (const stageId of VERSUS_STAGE_IDS) {
        const stage = stageById(stageId);
        const chip = el('button', 'bf-chip' + (s.stageId === stageId ? ' bf-chip-on' : ''), stageRow);
        chip.type = 'button';
        const swatch = el('span', 'bf-chip-swatch', chip);
        swatch.style.background = `#${stage.skyColor.toString(16).padStart(6, '0')}`;
        el('span', '', chip).textContent = stage.name;
        chip.disabled = !isHost;
        if (isHost) {
          chip.addEventListener('click', () => {
            events.emit('ui', { kind: 'move' });
            this.client.setSettings({ stageId });
          });
        }
      }
      const randomChip = el(
        'button',
        'bf-chip' + (s.stageId === 'random' ? ' bf-chip-on' : ''),
        stageRow,
      );
      randomChip.type = 'button';
      randomChip.textContent = '🎲 RANDOM';
      randomChip.disabled = !isHost;
      if (isHost) {
        randomChip.addEventListener('click', () => {
          events.emit('ui', { kind: 'move' });
          this.client.setSettings({ stageId: 'random' });
        });
      }
      if (!isHost && prev && prev.stageId !== s.stageId) wobble(stageRow);
    }
  }

  // -------------------------------------------------------------- countdown

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
    events.emit('ui', { kind: 'error' }); // boing
    const clean = sanitizeNickname(by);
    toast(`${clean.length > 0 && !isProfane(clean) ? clean : 'Someone'} isn't ready!`);
  }

  exit(): void {
    this.stopCountdown();
    for (const un of this.unsubs) un();
    this.unsubs = [];
    this.slotsRow = null;
    this.controlsWrap = null;
    this.readyBtn = null;
    this.readyHint = null;
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}

function shareUrl(code: string): string {
  return `${location.origin}${location.pathname}?join=${code}`;
}

/** Guest attention nudge: re-trigger the wobble animation on a control. */
function wobble(node: HTMLElement): void {
  node.classList.remove('bf-wobble');
  void node.offsetWidth;
  node.classList.add('bf-wobble');
}
