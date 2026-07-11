import { events } from '../../core/events';
import type { Game } from '../../Game';
import type { VersusEndResult } from '../GameplayScreen';
import type { MatchLaunch } from '../../../shared/protocol';
import { button, el, uiRoot } from '../../ui/dom';
import type { Screen } from '../Screen';

export interface OnlineResultsScreenCallbacks {
  onBackToRoom: () => void;
  onExitOnline: () => void;
}

/** Network results keep the room alive so the same group can rematch. */
export class OnlineResultsScreen implements Screen {
  private root: HTMLElement | null = null;
  private roomButton: HTMLButtonElement | null = null;

  constructor(
    private readonly launch: MatchLaunch,
    private readonly result: VersusEndResult,
    private readonly localSlot: number,
    private readonly callbacks: OnlineResultsScreenCallbacks,
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-modal-backdrop bf-results');
    const panel = el('div', 'bf-panel', this.root);
    const localPlace = this.result.placements.indexOf(this.localSlot);
    const won = localPlace === 0;

    const title = el('h1', `bf-title ${won ? 'bf-title-win' : ''}`, panel);
    title.textContent = won ? 'YOU WIN!' : 'FIGHT RESULTS';

    const standings = el('div', 'bf-loot', panel);
    for (let place = 0; place < this.result.placements.length; place += 1) {
      const slot = this.result.placements[place]!;
      const player = this.launch.players.find((candidate) => candidate.slot === slot);
      if (!player) continue;
      const row = el('div', 'bf-loot-row', standings);
      if (slot === this.localSlot) {
        row.style.outline = '3px solid var(--neon-yellow)';
        row.style.background = 'rgba(255, 201, 62, 0.22)';
      }
      const placeLabel = el('span', 'bf-loot-icon', row);
      placeLabel.textContent = `${place + 1}`;
      const name = el('span', 'bf-loot-label', row);
      name.textContent = player.nickname;
      const score = el('span', 'bf-loot-value', row);
      score.textContent = `${this.result.kosBySlot[slot] ?? 0} KOs  +${this.result.goldBySlot[slot] ?? 0} GOLD`;
    }

    const localGold = this.result.goldBySlot[this.localSlot] ?? 0;
    const reward = el('p', 'bf-hint', panel);
    reward.textContent = `YOU EARNED ${localGold} GOLD`;

    const actions = el('div', 'bf-button-col', panel);
    this.roomButton = button(
      'BACK TO SAME ROOM',
      () => this.callbacks.onBackToRoom(),
      'bf-button bf-button-green',
      actions,
    );
    button('EXIT ONLINE', () => this.callbacks.onExitOnline(), 'bf-button', actions);
    events.emit('music', { mood: won ? 'victory' : 'defeat' });
  }

  /** Guests cannot move the room; make the host handoff explicit. */
  waitForHost(): void {
    if (!this.roomButton) return;
    this.roomButton.disabled = true;
    this.roomButton.textContent = 'WAITING FOR HOST';
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    this.roomButton = null;
  }

  update(): void {}
}
