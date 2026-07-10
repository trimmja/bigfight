import type { GameMode } from '../../../shared/protocol';
import { events } from '../../core/events';
import type { Game } from '../../Game';
import type { LobbyClient } from '../../net/LobbyClient';
import { randomNickname, sanitizeNickname, isProfane } from '../../net/nicknames';
import { button, el, uiRoot } from '../../ui/dom';
import { toast } from '../../ui/toasts';
import type { Screen } from '../Screen';
import { MODES } from './modes';

/**
 * Online hub — mode-first, the way a AAA menu leads you: pick a big beautiful
 * game-mode card, then CREATE to host it (or JOIN a friend's code). The chosen
 * mode is the hero of the screen; nothing is buried. Mobile-first: cards flow
 * to fit any phone, touch targets are fat, safe-areas respected.
 */
export class OnlineMenuScreen implements Screen {
  private root: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private nameChip: HTMLElement | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private cardEls = new Map<GameMode, HTMLElement>();
  private selectedMode: GameMode = 'ffa';
  private busy = false;

  constructor(
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onLobby: () => void;
      onJoinCode: () => void;
      onSolo: () => void;
      onBack: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    if (game.save.nickname.length === 0) {
      game.save.nickname = randomNickname();
      game.persist();
    }

    this.root = uiRoot('bf-online-screen bf-hub');

    // --- header: back · title · your fighter name ---
    const header = el('div', 'bf-select-header bf-hub-header', this.root);
    button(
      '◀',
      () => {
        events.emit('ui', { kind: 'back' });
        this.callbacks.onBack();
      },
      'bf-button bf-button-round',
      header,
    );
    el('h1', 'bf-select-title', header).textContent = 'PLAY ONLINE';
    this.nameChip = el('div', 'bf-name-chip', header);
    this.renderNameChip(game);

    // --- prompt + mode cards (the hero) ---
    const body = el('div', 'bf-hub-body', this.root);
    el('div', 'bf-hub-prompt', body).textContent = 'Choose your battle';

    const cards = el('div', 'bf-mode-cards', body);
    for (const mode of MODES) {
      const card = el('button', 'bf-mode-card', cards) as HTMLButtonElement;
      card.type = 'button';
      card.style.setProperty('--mode', mode.color);
      el('div', 'bf-mode-icon', card).textContent = mode.icon;
      el('div', 'bf-mode-name', card).textContent = mode.name;
      el('div', 'bf-mode-tag', card).textContent = mode.tag;
      el('div', 'bf-mode-sub', card).textContent = mode.sub;
      el('div', 'bf-mode-check', card).textContent = '✓';
      card.addEventListener('click', () => this.selectMode(mode.id));
      this.cardEls.set(mode.id, card);
    }
    this.selectMode(this.selectedMode, true);

    // --- actions: CREATE (in the chosen mode) + JOIN a friend ---
    const actions = el('div', 'bf-hub-actions', body);
    this.createBtn = button(
      '▶  CREATE ROOM',
      () => this.createRoom(game),
      'bf-button bf-button-big bf-hub-create',
      actions,
    );
    button(
      '🎟️  JOIN A FRIEND',
      () => {
        events.emit('ui', { kind: 'confirm' });
        this.callbacks.onJoinCode();
      },
      'bf-button bf-button-big bf-hub-join',
      actions,
    );

    // Solo campaign lives one tap away (no floating buttons on the title now).
    button(
      '⚔️ Solo Adventure',
      () => {
        events.emit('ui', { kind: 'back' });
        this.callbacks.onSolo();
      },
      'bf-button bf-hub-solo',
      body,
    );
  }

  private renderNameChip(game: Game): void {
    const chip = this.nameChip;
    if (!chip) return;
    chip.replaceChildren();
    el('span', 'bf-name-chip-icon', chip).textContent = '🎮';
    const name = el('span', 'bf-name-chip-text', chip);
    name.textContent = game.save.nickname;
    name.title = 'Tap to change your name';
    name.addEventListener('click', () => this.editName(game));
    const dice = el('button', 'bf-name-chip-dice', chip) as HTMLButtonElement;
    dice.type = 'button';
    dice.textContent = '🎲';
    dice.title = 'Random name';
    dice.addEventListener('click', () => {
      events.emit('ui', { kind: 'move' });
      game.save.nickname = randomNickname();
      game.persist();
      this.renderNameChip(game);
      chip.classList.remove('bf-nick-pop');
      void chip.offsetWidth;
      chip.classList.add('bf-nick-pop');
    });
  }

  private editName(game: Game): void {
    const chip = this.nameChip;
    if (!chip) return;
    chip.replaceChildren();
    const input = el('input', 'bf-nick-input bf-name-chip-input', chip) as HTMLInputElement;
    input.type = 'text';
    input.maxLength = 12;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = game.save.nickname;
    const commit = (): void => {
      let clean = sanitizeNickname(input.value);
      if (clean.length === 0 || isProfane(clean)) {
        if (clean.length > 0) toast("Let's pick a nicer name!");
        clean = randomNickname();
      }
      if (clean !== game.save.nickname) {
        game.save.nickname = clean;
        game.persist();
      }
      this.renderNameChip(game);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    input.focus();
    input.select();
  }

  private selectMode(mode: GameMode, silent = false): void {
    this.selectedMode = mode;
    for (const [id, card] of this.cardEls) card.classList.toggle('bf-mode-card-on', id === mode);
    if (!silent) events.emit('ui', { kind: 'confirm' });
  }

  private createRoom(game: Game): void {
    if (this.busy) return;
    events.emit('ui', { kind: 'confirm' });
    this.busy = true;
    if (this.createBtn) {
      this.createBtn.disabled = true;
      this.createBtn.textContent = '…  OPENING  …';
    }
    const restore = (): void => {
      this.busy = false;
      if (this.createBtn) {
        this.createBtn.disabled = false;
        this.createBtn.textContent = '▶  CREATE ROOM';
      }
    };
    const wanted = this.selectedMode;
    // Wait until the room reflects our chosen mode before entering the lobby —
    // no flash of the default FFA banner.
    this.unsubs.push(
      this.client.on('room', (room) => {
        if (this.client.isHost && room.settings.mode !== wanted) {
          this.client.setSettings({
            mode: wanted,
            ...(wanted === 'coop' && room.settings.levelId === null ? { levelId: 1 } : {}),
          });
          return;
        }
        this.callbacks.onLobby();
      }),
    );
    this.client
      .connect()
      .then(() => this.client.createRoom(game.save.nickname, game.save.levelsBeaten))
      .catch(() => {
        if (!this.root) return;
        events.emit('ui', { kind: 'error' });
        toast("Can't reach the arena — try again!");
        restore();
      });
  }

  exit(): void {
    for (const un of this.unsubs) un();
    this.unsubs = [];
    this.nameChip = null;
    this.createBtn = null;
    this.cardEls.clear();
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
