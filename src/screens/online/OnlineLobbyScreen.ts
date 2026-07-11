import type { RoomPlayer, RoomState, RoomVisibility } from '../../../shared/protocol';
import { CHARACTERS, characterById } from '../../data/characters';
import { LEVELS } from '../../data/levels';
import { STAGES } from '../../data/stages';
import { WEAPONS, weaponById } from '../../data/weapons';
import type { Game } from '../../Game';
import {
  type OnlineMatchReady,
  type OnlineState,
  OnlineSession,
} from '../../online/OnlineSession';
import { isCharacterUnlocked, ownedWeapons, unlockedCharacters } from '../../progression';
import { characterCssColor, WEAPON_CATEGORY_COLORS } from '../../ui/cardColors';
import { button, el, uiRoot } from '../../ui/dom';
import { characterPortrait, weaponPortrait } from '../../ui/portraits';
import { buildRosterGrid } from '../../ui/rosterGrid';
import { ROSTER_CAPACITY } from '../CharacterSelectScreen';
import type { Screen } from '../Screen';
import { PedestalStage } from './PedestalStage';

type LobbyView = 'browser' | 'fighter' | 'weapon' | 'waiting';

interface OnlineLobbyCallbacks {
  onBack: () => void;
  onMatch: (match: OnlineMatchReady) => void;
}

const PEDESTAL_COLORS = [0x28c7fa, 0xff5a8a, 0xffc93e, 0x9a6bff] as const;
const NICKNAME_KEY = 'bigfight_online_nickname';

/**
 * The complete online room flow. Room/player readiness comes only from the
 * server; local view state merely controls which loadout step is visible.
 */
export class OnlineLobbyScreen implements Screen {
  private root: HTMLElement | null = null;
  private stage: PedestalStage | null = null;
  private game: Game | null = null;
  private state: OnlineState | null = null;
  private view: LobbyView = 'browser';
  private nickname = readNickname();
  private selectedCharacter = 'volt';
  private selectedWeapon = 'rustyPistol';
  private roomId: string | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeMatch: (() => void) | null = null;
  private renderedSignature = '';
  private plateEls = new Map<number, HTMLElement>();
  private danceSeqByPlayer = new Map<string, number>();

  constructor(
    private readonly session: OnlineSession,
    private readonly callbacks: OnlineLobbyCallbacks,
  ) {}

  enter(game: Game): void {
    this.game = game;
    game.input.setTouchControlsVisible(false);
    this.stage = new PedestalStage(game.renderer.scene, PEDESTAL_COLORS);
    this.stage.setVisible(false);
    this.root = uiRoot('bf-online-screen');

    this.unsubscribeState = this.session.subscribe((state) => this.receiveState(state));
    this.unsubscribeMatch = this.session.onMatch((event) => {
      if (event.type === 'ready') this.callbacks.onMatch(event.match);
    });
    this.session.connect();
    this.session.refreshRooms();
  }

  exit(_game: Game): void {
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.unsubscribeMatch?.();
    this.unsubscribeMatch = null;
    this.stage?.dispose();
    this.stage = null;
    this.root?.remove();
    this.root = null;
    this.game = null;
    this.plateEls.clear();
  }

  update(game: Game, dt: number): void {
    this.stage?.update(game.renderer.camera, dt);
    if (this.view !== 'waiting' || !this.stage) return;
    for (let slot = 0; slot < 4; slot += 1) {
      const plate = this.plateEls.get(slot);
      if (!plate) continue;
      const pos = this.stage.nameplateScreenPos(slot, game.renderer.camera);
      plate.style.left = `${pos.x * 100}%`;
      plate.style.top = `${pos.y * 100}%`;
    }
  }

  private receiveState(state: OnlineState): void {
    const previousRoomId = this.roomId;
    this.state = state;
    this.roomId = state.room?.id ?? null;

    if (!state.room) {
      this.view = 'browser';
    } else {
      const local = localPlayer(state);
      if (local?.characterId) this.selectedCharacter = local.characterId;
      if (local?.weaponId) this.selectedWeapon = local.weaponId;
      if (state.room.id !== previousRoomId) {
        this.view = local?.characterId || state.room.phase !== 'lobby' ? 'waiting' : 'fighter';
      }
      this.syncDances(state.room);
    }

    const signature = JSON.stringify({
      connection: state.connection,
      rooms: state.rooms,
      room: state.room,
      error: state.error,
      view: this.view,
      character: this.selectedCharacter,
      weapon: this.selectedWeapon,
    });
    if (signature !== this.renderedSignature) {
      this.renderedSignature = signature;
      this.renderUi();
    }
  }

  private renderUi(): void {
    const root = this.root;
    const state = this.state;
    if (!root || !state) return;
    root.replaceChildren();
    this.plateEls.clear();

    const header = el('header', 'bf-online-header', root);
    button('BACK', () => this.back(), 'bf-online-back', header);
    const room = state.room;
    el('h1', 'bf-online-title', header).textContent = room
      ? (this.view === 'waiting' ? 'BATTLE LOBBY' : room.name.toUpperCase())
      : 'ONLINE FIGHTS';
    const chip = el('div', `bf-online-chip bf-online-${state.connection}`, header);
    el('span', 'bf-online-dot', chip);
    chip.append(connectionCopy(state.connection));

    if (state.error) el('div', 'bf-online-error', root).textContent = state.error;

    if (!room) this.renderBrowser(root, state);
    else if (this.view === 'fighter') this.renderFighter(root, room, state);
    else if (this.view === 'weapon') this.renderWeapon(root, room, state);
    else this.renderWaiting(root, room, state);

    this.syncStage();
  }

  private renderBrowser(root: HTMLElement, state: OnlineState): void {
    const main = el('main', 'bf-online-browser', root);
    const roomsPanel = el('section', 'bf-online-panel bf-online-games', main);
    const titleRow = el('div', 'bf-online-panel-title', roomsPanel);
    el('h2', '', titleRow).textContent = 'OPEN GAMES';
    button('REFRESH', () => this.session.refreshRooms(), 'bf-online-small-button', titleRow);
    const roomList = el('div', 'bf-online-room-list', roomsPanel);
    if (state.rooms.length === 0) {
      const empty = el('div', 'bf-online-empty', roomList);
      el('strong', '', empty).textContent = state.connection === 'connected' ? 'NO OPEN GAMES YET' : 'CONNECTING TO ONLINE';
      el('span', '', empty).textContent = 'Host one and your friends can tap it here.';
    }
    for (const room of state.rooms) {
      const row = el('button', 'bf-online-room-row', roomList);
      row.type = 'button';
      el('strong', 'bf-online-room-name', row).textContent = room.name.toUpperCase();
      el('span', 'bf-online-room-count', row).textContent = `${room.playerCount} / ${room.maxPlayers}`;
      el('span', 'bf-online-room-meta', row).textContent = `${modeCopy(room.mode)} · ${stageName(room.stageId)}`;
      el('span', 'bf-online-room-join', row).textContent = 'JOIN';
      row.addEventListener('click', () => this.session.joinPublic(this.validNickname(), room.id));
    }

    const join = el('aside', 'bf-online-panel bf-online-join', main);
    el('h2', '', join).textContent = 'JUMP IN';
    el('p', '', join).textContent = 'Pick a name, tap an open game, or start your own.';
    const nickname = el('input', 'bf-online-input', join);
    nickname.placeholder = 'YOUR NAME';
    nickname.maxLength = 12;
    nickname.autocomplete = 'name';
    nickname.value = this.nickname;
    nickname.setAttribute('aria-label', 'Your nickname');
    nickname.addEventListener('input', () => this.saveNickname(nickname.value));

    const codeRow = el('div', 'bf-online-code-row', join);
    const code = el('input', 'bf-online-input bf-online-code', codeRow);
    code.placeholder = 'ROOM CODE';
    code.maxLength = 4;
    code.autocapitalize = 'characters';
    code.setAttribute('aria-label', 'Private room code');
    const joinCode = (): void => {
      if (code.value.trim()) this.session.joinPrivate(this.validNickname(), code.value);
    };
    code.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') joinCode();
    });
    button('JOIN PRIVATE', joinCode, 'bf-online-action bf-online-secondary', codeRow);

    const roomName = el('input', 'bf-online-input', join);
    roomName.placeholder = 'GAME NAME (OPTIONAL)';
    roomName.maxLength = 24;
    roomName.setAttribute('aria-label', 'Game name');
    const hostRow = el('div', 'bf-online-host-row', join);
    const host = (visibility: RoomVisibility): void => {
      this.session.createRoom(this.validNickname(), visibility, roomName.value.trim() || undefined);
    };
    button('HOST GAME', () => host('public'), 'bf-online-action bf-online-primary', hostRow);
    button('HOST PRIVATE', () => host('private'), 'bf-online-action bf-online-secondary', hostRow);
  }

  private renderFighter(root: HTMLElement, _room: RoomState, _state: OnlineState): void {
    this.clampLoadoutToSave();
    const save = this.game!.save;
    const def = characterById(this.selectedCharacter);
    const main = el('main', 'bf-online-select', root);

    // Full-screen Smash-style roster; locked fighters show as ?-silhouettes.
    buildRosterGrid(main, {
      slots: CHARACTERS.map((character) => ({
        id: character.id,
        name: character.name,
        portrait: characterPortrait(character.id),
        color: characterCssColor(character),
        locked: !isCharacterUnlocked(character, save),
        lockHint: character.unlock.type === 'level'
          ? `Beat level ${character.unlock.level} in the campaign`
          : 'Unlock in Market',
      })),
      capacity: ROSTER_CAPACITY,
      selectedId: this.selectedCharacter,
      onSelect: (id) => this.pickCharacter(id),
    });

    const bar = el('div', 'bf-roster-bar', main);
    const who = el('div', 'bf-roster-who', bar);
    el('h2', 'bf-roster-name', who).textContent = def.name.toUpperCase();
    el('p', 'bf-roster-tagline', who).textContent = def.tagline;
    const stats = el('div', 'bf-roster-stats', bar);
    this.statBar(stats, 'SPEED', def.speed / 10);
    this.statBar(stats, 'POWER', (def.power - 0.85) / 0.3);
    this.statBar(stats, 'WEIGHT', (def.weight - 80) / 40);
    this.statBar(stats, 'JUMP', (def.jumpVel - 12) / 4.5);
    el('span', 'bf-online-step', bar).textContent = 'STEP 2 OF 4';
    button('PICK WEAPON ▶', () => {
      this.view = 'weapon';
      this.forceRender();
    }, 'bf-button bf-button-green bf-button-big', bar);
  }

  private renderWeapon(root: HTMLElement, _room: RoomState, _state: OnlineState): void {
    this.clampLoadoutToSave();
    const save = this.game!.save;
    const weapon = weaponById(this.selectedWeapon);
    const main = el('main', 'bf-online-select', root);

    const owned = new Set(ownedWeapons(save).map((entry) => entry.id));
    buildRosterGrid(main, {
      slots: WEAPONS.map((option) => ({
        id: option.id,
        name: option.name,
        portrait: weaponPortrait(option.id),
        color: WEAPON_CATEGORY_COLORS[option.category] ?? 'var(--neon-cyan)',
        locked: !owned.has(option.id),
        lockHint: 'Craft it in the Market',
      })),
      capacity: ROSTER_CAPACITY,
      selectedId: this.selectedWeapon,
      onSelect: (id) => this.pickWeapon(id),
    });

    const bar = el('div', 'bf-roster-bar', main);
    const who = el('div', 'bf-roster-who', bar);
    el('h2', 'bf-roster-name', who).textContent = weapon.name.toUpperCase();
    el('p', 'bf-roster-tagline', who).textContent = weapon.tagline;
    el('span', 'bf-online-step', bar).textContent = 'STEP 3 OF 4';
    button('◀ FIGHTER', () => {
      this.view = 'fighter';
      this.forceRender();
    }, 'bf-button', bar);
    button('LOCK IN ▶', () => {
      this.session.setPlayer({
        characterId: this.selectedCharacter,
        weaponId: this.selectedWeapon,
        ready: true,
      });
      this.view = 'waiting';
      this.stage?.startFlyIn(this.game!.renderer.camera);
      this.forceRender();
    }, 'bf-button bf-button-green bf-button-big', bar);
  }

  private statBar(parent: HTMLElement, label: string, frac: number): void {
    el('span', 'bf-stat-label', parent).textContent = label;
    const track = el('div', 'bf-stat-track', parent);
    const fill = el('div', 'bf-stat-fill', track);
    fill.style.width = `${Math.round(Math.max(0.08, Math.min(1, frac)) * 100)}%`;
  }

  /** Keep online picks inside what this device's save has actually earned. */
  private clampLoadoutToSave(): void {
    const save = this.game!.save;
    const roster = unlockedCharacters(save);
    if (!roster.some((character) => character.id === this.selectedCharacter)) {
      this.selectedCharacter = roster[0]!.id;
    }
    const arsenal = ownedWeapons(save);
    if (!arsenal.some((weapon) => weapon.id === this.selectedWeapon)) {
      this.selectedWeapon = arsenal[0]!.id;
    }
  }

  private renderWaiting(root: HTMLElement, room: RoomState, state: OnlineState): void {
    const local = localPlayer(state);
    const isHost = room.hostId === state.playerId;
    const main = el('main', 'bf-online-waiting', root);
    const plates = el('section', 'bf-online-plates', main);
    for (let slot = 0; slot < 4; slot += 1) {
      const player = room.players.find((candidate) => candidate.slot === slot);
      const plate = el('div', player ? 'bf-online-player-plate' : 'bf-online-player-plate bf-online-open-plate', plates);
      plate.dataset.slot = String(slot);
      plate.style.setProperty('--slot', `#${PEDESTAL_COLORS[slot]!.toString(16).padStart(6, '0')}`);
      this.plateEls.set(slot, plate);
      if (!player) {
        plate.textContent = `P${slot + 1} · OPEN`;
        continue;
      }
      el('div', 'bf-online-plate-top', plate).textContent = `P${slot + 1}${player.playerId === room.hostId ? ' · HOST' : ''}`;
      el('div', 'bf-online-plate-name', plate).textContent = player.playerId === state.playerId ? 'YOU' : player.nickname.toUpperCase();
      el('div', 'bf-online-plate-pick', plate).textContent = player.characterId
        ? `${characterName(player.characterId)} · ${weaponName(player.weaponId)}`
        : 'CHOOSING LOADOUT';
      const status = el('span', `bf-online-ready-tag${player.ready ? ' is-ready' : ''}`, plate);
      status.textContent = player.connected ? (player.ready ? 'READY' : 'NOT READY') : 'RECONNECTING';
    }

    const bottom = el('section', 'bf-online-waiting-controls', main);
    const loadout = el('div', 'bf-online-loadout', bottom);
    el('span', '', loadout).textContent = 'YOUR LOADOUT';
    el('strong', '', loadout).textContent = `${characterName(this.selectedCharacter)} · ${weaponName(this.selectedWeapon)}`;
    button('DANCE', () => this.session.setPlayer({ dance: true }), 'bf-online-action bf-online-dance', bottom);
    button(local?.ready ? 'NOT READY' : 'READY UP', () => {
      this.session.setPlayer({ ready: !local?.ready });
    }, `bf-online-action ${local?.ready ? 'bf-online-ready-on' : 'bf-online-primary'}`, bottom);
    button('CHANGE', () => {
      this.session.setPlayer({ ready: false });
      this.view = 'fighter';
      this.forceRender();
    }, 'bf-online-action bf-online-secondary', bottom);

    if (isHost) this.renderHostControls(bottom, room);
    else {
      const waiting = el('div', 'bf-online-host-message', bottom);
      waiting.textContent = room.phase === 'countdown' ? 'MATCH STARTING' : 'HOST STARTS THE MATCH';
    }
    this.renderRoomTag(main, room, state);
  }

  private renderHostControls(parent: HTMLElement, room: RoomState): void {
    const settings = el('div', 'bf-online-settings', parent);
    const mode = this.select(settings, 'MODE', [
      ['ffa', 'FREE FOR ALL'],
      ['teams', 'TEAMS'],
      ['coop', 'CO-OP'],
    ], room.settings.mode, (value) => this.session.setSettings({ mode: value as RoomState['settings']['mode'] }));
    mode.classList.add('bf-online-mode-select');
    this.select(settings, 'STOCKS', ['1', '2', '3', '4', '5'].map((value) => [value, value]), String(room.settings.stocks), (value) => {
      this.session.setSettings({ stocks: Number(value) as RoomState['settings']['stocks'] });
    });
    if (room.settings.mode === 'coop') {
      this.select(settings, 'LEVEL', LEVELS.map((level) => [String(level.id), `${level.id} · ${level.name.toUpperCase()}`]), String(room.settings.levelId), (value) => {
        this.session.setSettings({ levelId: Number(value) });
      });
    } else {
      this.select(settings, 'STAGE', STAGES.map((stage) => [stage.id, stage.name.toUpperCase()]), room.settings.stageId, (value) => {
        this.session.setSettings({ stageId: value });
      });
    }

    const connected = room.players.filter((player) => player.connected);
    const canStart = connected.length >= 2 && connected.every((player) => player.ready && player.characterId);
    if (room.phase === 'countdown') {
      button('CANCEL START', () => this.session.cancelCountdown(), 'bf-online-action bf-online-secondary bf-online-start', parent);
    } else {
      const start = button('START MATCH', () => this.session.startMatch(), 'bf-online-action bf-online-start', parent);
      start.disabled = !canStart;
      start.title = canStart ? '' : 'Two or more connected players must be ready.';
    }
  }

  private select(
    parent: HTMLElement,
    label: string,
    options: readonly (readonly [string, string])[],
    value: string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const wrap = el('label', 'bf-online-setting', parent);
    el('span', '', wrap).textContent = label;
    const select = el('select', '', wrap);
    for (const [optionValue, copy] of options) {
      const option = el('option', '', select);
      option.value = optionValue;
      option.textContent = copy;
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  private renderRoomTag(parent: HTMLElement, room: RoomState, state: OnlineState): void {
    const tag = el('div', 'bf-online-room-tag', parent);
    const visibility = room.visibility === 'private' ? `PRIVATE · CODE ${room.code}` : 'OPEN GAME';
    tag.textContent = `${visibility} · ${room.players.length} / 4 · ${connectionCopy(state.connection)}`;
  }

  private pickCharacter(id: string): void {
    if (this.selectedCharacter === id) return;
    this.selectedCharacter = id;
    this.session.setPlayer({ characterId: id, ready: false });
    this.forceRender();
  }

  private pickWeapon(id: string): void {
    if (this.selectedWeapon === id) return;
    this.selectedWeapon = id;
    this.session.setPlayer({ weaponId: id, ready: false });
    this.forceRender();
  }

  private syncStage(): void {
    const stage = this.stage;
    const state = this.state;
    if (!stage || !state) return;
    // The loadout steps are a full-screen roster board — the 3D room only
    // shows in the waiting phase, where everyone's pick stands on a pedestal.
    const visible = Boolean(state.room) && this.view === 'waiting';
    stage.setVisible(visible);
    if (!visible) return;
    const local = localPlayer(state);
    const localSlot = local?.slot ?? 0;
    const inLoadout = this.view === 'fighter' || this.view === 'weapon';
    stage.setSelectionSlot(inLoadout ? localSlot : null);
    stage.setLocal(localSlot);
    for (let slot = 0; slot < 4; slot += 1) {
      const roomPlayer = state.room?.players.find((player) => player.slot === slot);
      const isLocalSlot = slot === localSlot;
      const fighter = inLoadout
        ? (isLocalSlot ? this.selectedCharacter : null)
        : roomPlayer?.characterId ?? null;
      const weapon = inLoadout
        ? (isLocalSlot && this.view === 'weapon' ? this.selectedWeapon : null)
        : roomPlayer?.weaponId ?? null;
      stage.setFighter(slot, fighter);
      stage.setWeapon(slot, weapon);
      stage.setReady(slot, !inLoadout && Boolean(roomPlayer?.ready));
    }
  }

  private syncDances(room: RoomState): void {
    for (const player of room.players) {
      const previous = this.danceSeqByPlayer.get(player.playerId);
      if (previous !== undefined && player.danceSeq > previous) this.stage?.playDance(player.slot);
      this.danceSeqByPlayer.set(player.playerId, player.danceSeq);
    }
    const activeIds = new Set(room.players.map((player) => player.playerId));
    for (const id of this.danceSeqByPlayer.keys()) {
      if (!activeIds.has(id)) this.danceSeqByPlayer.delete(id);
    }
  }

  private back(): void {
    if (!this.state?.room) {
      this.callbacks.onBack();
      return;
    }
    if (this.view === 'waiting') {
      this.session.setPlayer({ ready: false });
      this.view = 'weapon';
      this.forceRender();
      return;
    }
    if (this.view === 'weapon') {
      this.view = 'fighter';
      this.forceRender();
      return;
    }
    this.session.leaveRoom();
  }

  private saveNickname(value: string): void {
    this.nickname = value;
    try {
      localStorage.setItem(NICKNAME_KEY, value);
    } catch {
      // Storage can be unavailable in private browsing; the in-memory value is enough.
    }
  }

  private validNickname(): string {
    const nickname = this.nickname.trim().replace(/\s+/g, ' ').slice(0, 12) || 'PLAYER';
    this.saveNickname(nickname);
    return nickname;
  }

  private forceRender(): void {
    this.renderedSignature = '';
    this.renderUi();
  }
}

function localPlayer(state: OnlineState): RoomPlayer | undefined {
  return state.room?.players.find((player) => player.playerId === state.playerId);
}

function readNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function connectionCopy(connection: OnlineState['connection']): string {
  switch (connection) {
    case 'connected': return 'CONNECTED';
    case 'connecting': return 'CONNECTING';
    case 'reconnecting': return 'RECONNECTING';
    case 'closed': return 'OFFLINE';
    case 'incompatible': return 'UPDATE NEEDED';
  }
}

function modeCopy(mode: RoomState['settings']['mode']): string {
  if (mode === 'ffa') return 'FREE FOR ALL';
  if (mode === 'teams') return 'TEAMS';
  return 'CO-OP';
}

function stageName(id: string): string {
  return STAGES.find((stage) => stage.id === id)?.name.toUpperCase() ?? id.toUpperCase();
}

function characterName(id: string): string {
  return CHARACTERS.find((character) => character.id === id)?.name.toUpperCase() ?? id.toUpperCase();
}

function weaponName(id: string): string {
  return WEAPONS.find((weapon) => weapon.id === id)?.name.toUpperCase() ?? id.toUpperCase();
}
