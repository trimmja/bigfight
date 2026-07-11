import { events } from '../core/events';
import type { Game } from '../Game';
import { characterById } from '../data/characters';
import { LEVELS } from '../data/levels';
import { powerupById } from '../data/powerups';
import { stageById } from '../data/stages';
import type { LevelDef } from '../data/types';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Campaign hub: a winding path of level bubbles. Beaten = green check,
 * next playable = bouncing gold, locked = gray. Locked nodes deliberately
 * stay mysterious, but preview the kind of reward waiting ahead.
 */
export class LevelMapScreen implements Screen {
  private root: HTMLElement | null = null;

  constructor(
    private readonly callbacks: {
      onPickLevel: (levelId: number) => void;
      onBack: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    this.root = uiRoot('bf-map-screen');

    const header = el('div', 'bf-map-header', this.root);
    button('◀', () => {
      events.emit('ui', { kind: 'back' });
      this.callbacks.onBack();
    }, 'bf-button bf-button-round', header);
    el('h1', 'bf-map-title', header).textContent = 'CAMPAIGN';
    const gold = el('div', 'bf-gold-chip', header);
    gold.textContent = `G ${game.save.gold}`;

    const path = el('div', 'bf-map-path', this.root);
    const beaten = game.save.levelsBeaten;
    for (const level of LEVELS) {
      const isBeaten = level.id <= beaten;
      const isNext = level.id === beaten + 1;
      const locked = level.id > beaten + 1;
      const boss = level.bossId !== undefined;

      const node = el(
        'div',
        'bf-map-node'
          + (level.id % 2 === 0 ? ' bf-map-node-alt' : '')
          + (isNext ? ' bf-map-node-next' : '')
          + (locked ? ' bf-map-node-locked' : ''),
        path,
      );
      node.style.setProperty('--i', `${level.id - 1}`);
      const bubble = el(
        'button',
        'bf-level' +
          (isBeaten ? ' bf-level-beaten' : '') +
          (isNext ? ' bf-level-next' : '') +
          (locked ? ' bf-level-locked' : '') +
          (boss ? ' bf-level-boss' : ''),
        node,
      );
      bubble.type = 'button';
      bubble.textContent = boss ? 'B' : `${level.id}`;
      if (isBeaten) bubble.textContent = 'OK';
      bubble.disabled = locked;
      el('div', 'bf-level-name', node).textContent = locked ? '???' : level.name;
      if (!isBeaten) {
        const reward = el('div', 'bf-level-reward', node);
        reward.textContent = rewardPreview(level, isNext);
      }
      bubble.addEventListener('click', () => {
        if (locked) return;
        events.emit('ui', { kind: 'confirm' });
        this.callbacks.onPickLevel(level.id);
      });
    }

    events.emit('music', { mood: 'menu' });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  update(): void {}
}

/**
 * The next playable level can name its prize; farther-off levels show only
 * the reward type, preserving a little campaign mystery while giving players
 * a reason to keep moving along the path.
 */
function rewardPreview(level: LevelDef, revealName: boolean): string {
  const unlocks = level.unlocks;
  if (unlocks?.powerupId && unlocks.stageId) {
    const name = powerupById(unlocks.powerupId).name.toUpperCase();
    return revealName ? `WIN ${name}! + STAGE` : 'POWER + STAGE';
  }
  if (unlocks?.characterId) {
    const name = characterById(unlocks.characterId).name.toUpperCase();
    return revealName ? `WIN ${name}!` : 'NEW FIGHTER';
  }
  if (unlocks?.powerupId) {
    const name = powerupById(unlocks.powerupId).name.toUpperCase();
    return revealName ? `⭐ WIN ${name}!` : '⭐ NEW POWER';
  }
  if (unlocks?.stageId) {
    const name = stageById(unlocks.stageId).name.toUpperCase();
    return revealName ? `UNLOCK ${name}!` : 'NEW STAGE';
  }
  if (level.id === LEVELS.length) return 'FINAL BOSS';
  if (level.bossId) return 'BOSS FIGHT';
  if (level.id === 1) return revealName ? 'START HERE!' : 'SECRET FIGHT';
  return revealName ? 'BIG GOLD!' : 'SECRET FIGHT';
}
