import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../../shared/protocol';
import { events } from '../../core/events';
import type { Game } from '../../Game';
import type { LobbyClient } from '../../net/LobbyClient';
import { randomNickname } from '../../net/nicknames';
import { button, el, uiRoot } from '../../ui/dom';
import { toast } from '../../ui/toasts';
import { applyUpdate, updateAvailable } from '../../updates';
import type { Screen } from '../Screen';

/**
 * Join-by-code: 4 huge letter boxes + an on-screen keypad of exactly the 20
 * ROOM_CODE_ALPHABET letters (physical keyboards work too). Deep links
 * (?join=CODE) land here pre-filled and auto-submit.
 */
export class JoinCodeScreen implements Screen {
  private root: HTMLElement | null = null;
  private unsubs: (() => void)[] = [];
  private boxes: HTMLElement[] = [];
  private boxRow: HTMLElement | null = null;
  private goBtn: HTMLButtonElement | null = null;
  private entered = '';
  private busy = false;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly client: LobbyClient,
    private readonly callbacks: {
      onLobby: () => void;
      onBack: () => void;
    },
    /** Deep-link prefill: auto-joins this code on enter. */
    private readonly prefillCode?: string,
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    if (game.save.nickname.length === 0) {
      game.save.nickname = randomNickname();
      game.persist();
    }

    this.root = uiRoot('bf-online-screen bf-join-screen');
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
    el('h1', 'bf-select-title', header).textContent = 'ENTER ROOM CODE';

    const body = el('div', 'bf-join-body', this.root);

    // --- the 4 huge boxes ---
    this.boxRow = el('div', 'bf-code-row', body);
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      this.boxes.push(el('div', 'bf-code-box', this.boxRow));
    }

    // --- keypad: exactly the 20 room-code letters + ⌫ + GO! ---
    const pad = el('div', 'bf-keypad', body);
    for (const letter of ROOM_CODE_ALPHABET) {
      button(letter, () => this.typeLetter(letter), 'bf-button bf-key', pad);
    }
    button('⌫', () => this.backspace(), 'bf-button bf-key bf-key-back', pad);
    this.goBtn = button(
      'GO!',
      () => this.submit(game),
      'bf-button bf-button-green bf-key bf-key-go',
      pad,
    );

    // Physical keyboard works too.
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Backspace') {
        this.backspace();
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        this.submit(game);
        e.preventDefault();
        return;
      }
      const letter = e.key.toUpperCase();
      if (letter.length === 1 && ROOM_CODE_ALPHABET.includes(letter)) this.typeLetter(letter);
    };
    window.addEventListener('keydown', this.onKeyDown);

    // Success = first room snapshot.
    this.unsubs.push(
      this.client.on('room', () => {
        // Deep-link cleanup AFTER a successful join, so a mid-join reload
        // still lands back here.
        const url = new URL(location.href);
        if (url.searchParams.has('join')) {
          url.searchParams.delete('join');
          history.replaceState(null, '', url);
        }
        this.callbacks.onLobby();
      }),
      this.client.on('joinError', (err) => this.handleJoinError(game, err)),
    );

    // Deep link: pre-fill and go.
    if (this.prefillCode) {
      const code = this.prefillCode.toUpperCase().slice(0, ROOM_CODE_LENGTH);
      for (const letter of code) {
        if (ROOM_CODE_ALPHABET.includes(letter)) this.typeLetter(letter, false);
      }
      if (this.entered.length === ROOM_CODE_LENGTH) {
        setTimeout(() => this.submit(game), 350);
      }
    }
  }

  private typeLetter(letter: string, sfx = true): void {
    if (this.busy || this.entered.length >= ROOM_CODE_LENGTH) return;
    this.entered += letter;
    if (sfx) events.emit('ui', { kind: 'move' });
    this.renderBoxes(true);
  }

  private backspace(): void {
    if (this.busy || this.entered.length === 0) return;
    this.entered = this.entered.slice(0, -1);
    events.emit('ui', { kind: 'back' });
    this.renderBoxes(false);
  }

  private renderBoxes(popLast: boolean): void {
    for (let i = 0; i < this.boxes.length; i += 1) {
      const box = this.boxes[i]!;
      const letter = this.entered[i] ?? '';
      box.textContent = letter;
      box.classList.toggle('bf-code-box-filled', letter !== '');
      box.classList.remove('bf-code-pop');
    }
    if (popLast && this.entered.length > 0) {
      const box = this.boxes[this.entered.length - 1]!;
      void box.offsetWidth;
      box.classList.add('bf-code-pop');
    }
    if (this.goBtn) this.goBtn.disabled = this.entered.length !== ROOM_CODE_LENGTH;
  }

  private shake(): void {
    if (!this.boxRow) return;
    events.emit('ui', { kind: 'error' });
    this.boxRow.classList.remove('bf-shake');
    void this.boxRow.offsetWidth;
    this.boxRow.classList.add('bf-shake');
  }

  private submit(game: Game): void {
    if (this.busy) return;
    if (this.entered.length !== ROOM_CODE_LENGTH) {
      this.shake();
      return;
    }
    this.busy = true;
    events.emit('ui', { kind: 'confirm' });
    if (this.goBtn) this.goBtn.textContent = '…';
    this.client
      .connect()
      .then(() => {
        this.client.joinRoom(this.entered, game.save.nickname, game.save.levelsBeaten);
      })
      .catch(() => {
        if (!this.root) return;
        toast("Can't reach the arena — try again!");
        this.shake();
        this.unbusy();
      });
  }

  private unbusy(): void {
    this.busy = false;
    if (this.goBtn) {
      this.goBtn.textContent = 'GO!';
      this.goBtn.disabled = this.entered.length !== ROOM_CODE_LENGTH;
    }
  }

  private handleJoinError(
    _game: Game,
    err: { reason: string; hostNickname?: string },
  ): void {
    this.unbusy();
    switch (err.reason) {
      case 'badCode':
        this.shake();
        toast('Hmm, no room with that code!');
        return;
      case 'full':
        this.shake();
        toast('That room is full up!');
        return;
      case 'inMatch':
        this.shake();
        toast('They already started — ask for a new code!');
        return;
      case 'versionMismatch':
        this.shake();
        // ALWAYS show a loud, actionable panel — a silent freeze here reads as
        // "the game is broken." Refreshing pulls the current build (the HTML
        // shell is no-cache), so it fixes a stale joiner outright and tells a
        // stale host to do the same.
        void updateAvailable().then((imStale) => {
          if (!this.root) return;
          this.showVersionPanel(imStale, err.hostNickname);
        });
        return;
      default:
        this.shake();
        toast("That didn't work — try again!");
    }
  }

  /**
   * Version mismatch panel — loud + actionable. `imStale` = I'm the older one
   * (a refresh gets me in); otherwise the HOST is older (refresh won't join
   * their room, but tells them what to do). Either way REFRESH is the fix, so
   * it's always the primary button; ?join=CODE is preserved through the reload.
   */
  private showVersionPanel(imStale: boolean, hostNickname?: string): void {
    if (!this.root) return;
    const backdrop = el('div', 'bf-modal-backdrop', this.root);
    const panel = el('div', 'bf-panel', backdrop);
    el('h1', 'bf-title', panel).textContent = imStale ? '🔄 TIME TO UPDATE!' : '👋 DIFFERENT VERSIONS';
    el('p', 'bf-hint', panel).textContent = imStale
      ? "Your game is a little older than your friend's. Refresh to get the latest and jump right in!"
      : `You're on the newest version but ${hostNickname ?? 'the host'} isn't yet. Ask them to refresh their game, then try again!`;
    const code = this.entered;
    const col = el('div', 'bf-button-col', panel);
    button(
      '🔄 REFRESH NOW',
      () => {
        const url = new URL(location.href);
        url.searchParams.set('join', code);
        history.replaceState(null, '', url);
        applyUpdate();
      },
      'bf-button bf-button-yellow bf-button-big',
      col,
    );
    button('BACK', () => {
      backdrop.remove();
      this.callbacks.onBack();
    }, 'bf-button', col);
  }

  exit(): void {
    for (const un of this.unsubs) un();
    this.unsubs = [];
    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.onKeyDown = null;
    }
    this.boxes = [];
    this.boxRow = null;
    this.goBtn = null;
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}
