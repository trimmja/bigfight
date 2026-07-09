import * as THREE from 'three';
import { events } from '../core/events';
import type { Game } from '../Game';
import { pick, rand } from '../core/math';
import { CHARACTERS, characterById } from '../data/characters';
import type { CharacterDef } from '../data/types';
import { isCharacterUnlocked, unlockedCharacters } from '../progression';
import { buildCharacterRig } from '../rigs/characterBuilders';
import type { FighterRig } from '../rigs/FighterRig';
import { poseFightStance, poseAttack } from '../rigs/poses';
import { button, el, uiRoot } from '../ui/dom';
import type { Screen } from './Screen';

/**
 * Character select: card grid on the left, live 3D preview (idling, punches
 * when you tap them) on the right, stat bars, RANDOM option.
 */
export class CharacterSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private preview: FighterRig | null = null;
  private previewGroup = new THREE.Group();
  private selectedId: string;
  private t = 0;
  private punchT = -1;
  private nameEl: HTMLElement | null = null;
  private tagEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private cards = new Map<string, HTMLButtonElement>();
  /** Drag-to-spin state: user yaw persists, idle sway rides on top. */
  private userYaw = -Math.PI / 2;
  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private spinVelocity = 0;

  constructor(
    private readonly callbacks: {
      onPick: (characterId: string) => void;
      onBack: () => void;
    },
  ) {
    this.selectedId = 'volt';
  }

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);
    game.renderer.scene.add(this.previewGroup);
    game.renderer.camera.position.set(0, 0, 22);
    game.renderer.camera.lookAt(0, 0, 0);

    this.root = uiRoot('bf-select-screen');
    const header = el('div', 'bf-select-header', this.root);
    button('◀', () => this.callbacks.onBack(), 'bf-button bf-button-round', header);
    el('h1', 'bf-select-title', header).textContent = 'CHOOSE YOUR FIGHTER';

    const body = el('div', 'bf-select-body', this.root);
    const grid = el('div', 'bf-select-grid', body);
    for (const def of CHARACTERS) {
      const unlocked = isCharacterUnlocked(def, game.save);
      const card = el('button', 'bf-card' + (unlocked ? '' : ' bf-card-locked'), grid);
      card.type = 'button';
      const dot = el('span', 'bf-card-dot', card);
      dot.style.background = `#${def.palette.core.toString(16).padStart(6, '0')}`;
      el('span', 'bf-card-name', card).textContent = unlocked ? def.name : '???';
      if (!unlocked) {
        el('span', 'bf-card-lock', card).textContent =
          def.unlock.type === 'level' ? `Beat level ${def.unlock.level}` : `💰 in Market`;
      }
      card.disabled = !unlocked;
      card.addEventListener('click', () => this.select(game, def.id, true));
      this.cards.set(def.id, card);
    }
    // Random card.
    const randomCard = el('button', 'bf-card bf-card-random', grid);
    randomCard.type = 'button';
    el('span', 'bf-card-dot', randomCard).textContent = '🎲';
    el('span', 'bf-card-name', randomCard).textContent = 'RANDOM';
    randomCard.addEventListener('click', () => {
      const options = unlockedCharacters(game.save);
      this.select(game, pick(rand, options).id, true);
    });

    // Drag anywhere that isn't a button to spin the fighter around.
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.dragPointerId = e.pointerId;
      this.lastDragX = e.clientX;
      this.spinVelocity = 0;
    });
    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragPointerId) return;
      const dx = e.clientX - this.lastDragX;
      this.lastDragX = e.clientX;
      this.userYaw += dx * 0.013;
      this.spinVelocity = dx * 0.013 * 60;
    });
    const endDrag = (e: PointerEvent): void => {
      if (e.pointerId === this.dragPointerId) this.dragPointerId = null;
    };
    this.root.addEventListener('pointerup', endDrag);
    this.root.addEventListener('pointercancel', endDrag);

    const side = el('div', 'bf-select-side', body);
    this.nameEl = el('h2', 'bf-select-name', side);
    this.tagEl = el('p', 'bf-select-tag', side);
    // On short screens (phones, landscape) stats hide behind this toggle so
    // they don't overlay the character preview.
    button(
      '📊 STATS',
      () => side.classList.toggle('bf-stats-open'),
      'bf-button bf-stats-toggle',
      side,
    );
    this.statsEl = el('div', 'bf-select-stats', side);
    button('FIGHT! ▶', () => this.callbacks.onPick(this.selectedId), 'bf-button bf-button-green bf-button-big', side);

    this.select(game, this.selectedId, false);
  }

  private select(_game: Game, id: string, sfx: boolean): void {
    this.selectedId = id;
    if (sfx) events.emit('ui', { kind: 'move' });
    for (const [cardId, card] of this.cards) {
      card.classList.toggle('bf-card-selected', cardId === id);
    }
    const def = characterById(id);
    this.buildPreview(def);
    if (this.nameEl) this.nameEl.textContent = def.name.toUpperCase();
    if (this.tagEl) this.tagEl.textContent = def.tagline;
    if (this.statsEl) {
      this.statsEl.replaceChildren();
      this.statBar('SPEED', def.speed / 10);
      this.statBar('POWER', (def.power - 0.85) / 0.3);
      this.statBar('WEIGHT', (def.weight - 80) / 40);
      this.statBar('JUMP', (def.jumpVel - 12) / 4.5);
    }
    this.punchT = 0; // greet with a punch
    this.userYaw = -Math.PI / 2; // new fighter faces the camera
    this.spinVelocity = 0;
  }

  private statBar(label: string, frac: number): void {
    if (!this.statsEl) return;
    const row = el('div', 'bf-stat-row', this.statsEl);
    el('span', 'bf-stat-label', row).textContent = label;
    const track = el('div', 'bf-stat-track', row);
    const fill = el('div', 'bf-stat-fill', track);
    fill.style.width = `${Math.round(Math.max(0.08, Math.min(1, frac)) * 100)}%`;
  }

  private buildPreview(def: CharacterDef): void {
    if (this.preview) {
      this.previewGroup.remove(this.preview.root);
      this.preview.dispose();
    }
    this.preview = buildCharacterRig(def);
    // Rig at the group origin; the group carries position/scale/spin —
    // placement is aspect-aware and happens every frame in update().
    this.preview.setShadow(null, 0);
    this.previewGroup.add(this.preview.root);
  }

  exit(game: Game): void {
    game.renderer.scene.remove(this.previewGroup);
    this.preview?.dispose();
    this.preview = null;
    this.root?.remove();
    this.root = null;
  }

  update(game: Game, dt: number): void {
    this.t += dt;
    if (!this.preview) return;

    // Anchor the fighter to the middle of the right-hand zone regardless of
    // aspect ratio (phones squished him small and high), at ~2x scale.
    const cam = game.renderer.camera;
    const dist = cam.position.z - 10;
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * dist;
    const halfW = halfH * cam.aspect;
    const scale = 2.0;
    this.previewGroup.scale.setScalar(scale);
    this.previewGroup.position.set(halfW * 0.47, halfH * 0.18 - 1.05 * scale, 10);

    const blend = 1 - Math.exp(-14 * dt);
    if (this.punchT >= 0) {
      this.punchT += dt * 2.4;
      if (this.punchT >= 1) this.punchT = -1;
      else this.preview.setPose(poseAttack('finisher', this.punchT), blend);
    }
    if (this.punchT < 0) this.preview.setPose(poseFightStance(this.t), blend);
    // Drag-to-spin with momentum; gentle idle sway rides on top. (Yaw lives
    // on the wrapper group — the rig's own root yaw belongs to facing turns.)
    if (this.dragPointerId === null && Math.abs(this.spinVelocity) > 0.01) {
      this.userYaw += this.spinVelocity * dt;
      this.spinVelocity *= Math.exp(-3.2 * dt);
    }
    this.previewGroup.rotation.y = this.userYaw + Math.sin(this.t * 0.5) * 0.1;
    this.preview.update(dt);
  }
}
