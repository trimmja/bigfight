import { events } from '../core/events';
import type { Game } from '../Game';
import { button, el, uiRoot } from '../ui/dom';
import { RosterShowcase } from './RosterShowcase';
import type { Screen } from './Screen';

/**
 * Game-mode select — the stop right after the title, styled like a versus
 * poster: two big leaning slabs, CAMPAIGN vs ONLINE, with the whole roster
 * mustering in behind them (RosterShowcase owns that cinematic). This screen
 * also carries the game's only settings button (the procedural gear).
 */
export class ModeSelectScreen implements Screen {
  private root: HTMLElement | null = null;
  private showcase: RosterShowcase | null = null;
  private picked = false;

  constructor(
    private readonly callbacks: {
      onCampaign: () => void;
      onOnline: () => void;
      onBack: () => void;
      onSettings: () => void;
    },
  ) {}

  enter(game: Game): void {
    game.input.setTouchControlsVisible(false);

    this.showcase = new RosterShowcase(game.renderer.scene, game.save);
    this.showcase.start(game.renderer.camera);

    this.root = uiRoot('bf-mode-screen');

    const header = el('div', 'bf-map-header', this.root);
    button('◀', () => {
      events.emit('ui', { kind: 'back' });
      this.callbacks.onBack();
    }, 'bf-button bf-button-round', header);
    el('h1', 'bf-map-title', header).textContent = 'PICK YOUR FIGHT';
    const settings = el('button', 'bf-button bf-button-round', header);
    settings.type = 'button';
    settings.setAttribute('aria-label', 'Settings');
    settings.appendChild(gearIcon(24));
    settings.addEventListener('click', () => {
      events.emit('ui', { kind: 'confirm' });
      this.callbacks.onSettings();
    });

    const cards = el('div', 'bf-mode-cards', this.root);
    this.card(cards, {
      className: 'bf-mode-card-campaign',
      players: '1 PLAYER',
      name: 'CAMPAIGN',
      tag: 'Fight the story. Win new gear!',
      onPick: this.callbacks.onCampaign,
    });
    this.card(cards, {
      className: 'bf-mode-card-online',
      players: '2–4 PLAYERS',
      name: 'ONLINE',
      tag: 'Battle your friends!',
      onPick: this.callbacks.onOnline,
    });

    events.emit('music', { mood: 'menu' });
  }

  private card(
    parent: HTMLElement,
    opts: { className: string; players: string; name: string; tag: string; onPick: () => void },
  ): void {
    const card = el('button', `bf-mode-card ${opts.className}`, parent) as HTMLButtonElement;
    card.type = 'button';
    el('span', 'bf-mode-chip', card).textContent = opts.players;
    el('div', 'bf-mode-name', card).textContent = opts.name;
    el('div', 'bf-mode-tag', card).textContent = opts.tag;
    card.addEventListener('click', () => {
      if (this.picked) return;
      this.picked = true;
      events.emit('ui', { kind: 'confirm' });
      opts.onPick();
    });
  }

  exit(game: Game): void {
    this.showcase?.dispose(game.renderer.camera);
    this.showcase = null;
    this.root?.remove();
    this.root = null;
  }

  update(game: Game, dt: number): void {
    this.showcase?.update(game.renderer.camera, dt);
  }
}

/** Procedurally drawn gear (8 teeth + hub hole), filled with the button's
 * text color so it restyles with the theme for free. */
function gearIcon(px: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('width', `${px}`);
  svg.setAttribute('height', `${px}`);

  const teeth = 8;
  const rTooth = 11;
  const rBody = 8.2;
  const rHole = 3.8;
  const step = (Math.PI * 2) / teeth;
  const pt = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;

  let d = '';
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    // Valley → flank up → tooth top → flank down, then line to the next valley.
    d += `${i === 0 ? 'M' : 'L'} ${pt(rBody, a + 0.10 * step)} `;
    d += `L ${pt(rTooth, a + 0.22 * step)} L ${pt(rTooth, a + 0.48 * step)} `;
    d += `L ${pt(rBody, a + 0.60 * step)} `;
  }
  d += 'Z ';
  // Hub hole punched out via evenodd (drawn as two arcs).
  d += `M ${rHole} 0 A ${rHole} ${rHole} 0 1 0 ${-rHole} 0 A ${rHole} ${rHole} 0 1 0 ${rHole} 0 Z`;

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
  return svg;
}
