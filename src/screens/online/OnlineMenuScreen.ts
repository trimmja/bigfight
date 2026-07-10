import { events } from '../../core/events';
import type { Game } from '../../Game';
import type { LobbyClient } from '../../net/LobbyClient';
import { randomNickname, sanitizeNickname, isProfane } from '../../net/nicknames';
import { button, el, uiRoot } from '../../ui/dom';
import { toast } from '../../ui/toasts';
import type { Screen } from '../Screen';

/**
 * Online front door: your fighter name (persisted, editable, 🎲 rerollable)
 * and the two ways in — CREATE ROOM or JOIN ROOM by code.
 */
export class OnlineMenuScreen implements Screen {
  private root: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private nickInput: HTMLInputElement | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private busy = false;

  constructor(
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onLobby: () => void;
      onJoinCode: () => void;
      onBack: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    // First online visit: hand the kid a fun name instead of an empty box.
    if (game.save.nickname.length === 0) {
      game.save.nickname = randomNickname();
      game.persist();
    }

    this.root = uiRoot('bf-online-screen');
    const header = el('div', 'bf-select-header', this.root);
    button(
      '◀',
      () => {
        events.emit('ui', { kind: 'back' });
        this.callbacks.onBack();
      },
      'bf-button bf-button-round',
      header,
    );
    el('h1', 'bf-select-title', header).textContent = '🌐 FIGHT ONLINE';

    const body = el('div', 'bf-online-menu', this.root);

    // --- nickname row ---
    const nickWrap = el('div', 'bf-nick-wrap', body);
    el('div', 'bf-nick-label', nickWrap).textContent = 'YOUR FIGHTER NAME';
    const nickRow = el('div', 'bf-nick-row', nickWrap);
    const input = el('input', 'bf-nick-input', nickRow);
    input.type = 'text';
    input.maxLength = 12;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = game.save.nickname;
    input.addEventListener('change', () => this.commitNickname(game));
    input.addEventListener('blur', () => this.commitNickname(game));
    this.nickInput = input;
    button(
      '🎲',
      () => {
        events.emit('ui', { kind: 'move' });
        game.save.nickname = randomNickname();
        game.persist();
        if (this.nickInput) {
          this.nickInput.value = game.save.nickname;
          this.nickInput.classList.remove('bf-nick-pop');
          void this.nickInput.offsetWidth; // restart the pop animation
          this.nickInput.classList.add('bf-nick-pop');
        }
      },
      'bf-button bf-button-yellow bf-nick-dice',
      nickRow,
    );

    // --- the two doors ---
    const col = el('div', 'bf-online-doors', body);
    this.createBtn = button(
      '✨ CREATE ROOM',
      () => this.createRoom(game),
      'bf-button bf-button-violet bf-button-big bf-door',
      col,
    );
    button(
      '🔑 JOIN ROOM',
      () => {
        this.commitNickname(game);
        events.emit('ui', { kind: 'confirm' });
        this.callbacks.onJoinCode();
      },
      'bf-button bf-button-big bf-door',
      col,
    );

    el('div', 'bf-online-hint', body).textContent =
      'Make a room and share the code with your friends!';
  }

  private commitNickname(game: Game): void {
    if (!this.nickInput) return;
    let clean = sanitizeNickname(this.nickInput.value);
    if (clean.length === 0 || isProfane(clean)) {
      if (clean.length > 0) toast("Let's pick a nicer name!");
      clean = randomNickname();
    }
    this.nickInput.value = clean;
    if (clean !== game.save.nickname) {
      game.save.nickname = clean;
      game.persist();
    }
  }

  private createRoom(game: Game): void {
    if (this.busy) return;
    this.commitNickname(game);
    events.emit('ui', { kind: 'confirm' });
    this.busy = true;
    if (this.createBtn) {
      this.createBtn.disabled = true;
      this.createBtn.textContent = '… OPENING …';
    }
    const restore = (): void => {
      this.busy = false;
      if (this.createBtn) {
        this.createBtn.disabled = false;
        this.createBtn.textContent = '✨ CREATE ROOM';
      }
    };
    // First room snapshot = we're in. (Screen exit unsubscribes.)
    this.unsubs.push(
      this.client.on('room', () => {
        this.callbacks.onLobby();
      }),
    );
    this.client
      .connect()
      .then(() => {
        this.client.createRoom(game.save.nickname, game.save.levelsBeaten);
      })
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
    this.nickInput = null;
    this.createBtn = null;
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
