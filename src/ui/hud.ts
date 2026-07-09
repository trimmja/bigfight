import { events } from '../core/events';
import { el, uiRoot } from './dom';

/**
 * In-fight HUD: damage %, stock pips, wave banner, boss health bar.
 * GameplayScreen calls set() once per frame; everything else is event-driven.
 */
export class Hud {
  private root: HTMLElement;
  private damageEl: HTMLElement;
  private stocksEl: HTMLElement;
  private bannerEl: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;

  private lastDamage = -1;
  private lastStocks = -1;
  private bannerTimer: number | null = null;
  private unsubs: (() => void)[] = [];

  constructor() {
    this.root = uiRoot('bf-hud');

    const corner = el('div', 'bf-hud-corner', this.root);
    this.damageEl = el('div', 'bf-damage', corner);
    this.damageEl.textContent = '0%';
    this.stocksEl = el('div', 'bf-stocks', corner);

    this.bannerEl = el('div', 'bf-banner', this.root);

    this.bossBar = el('div', 'bf-bossbar', this.root);
    this.bossName = el('div', 'bf-bossbar-name', this.bossBar);
    const track = el('div', 'bf-bossbar-track', this.bossBar);
    this.bossFill = el('div', 'bf-bossbar-fill', track);
    this.bossBar.style.display = 'none';

    this.unsubs.push(
      events.on('waveCleared', ({ wave, totalWaves }) => {
        if (wave < totalWaves) this.banner(`WAVE ${wave + 1} / ${totalWaves}`);
      }),
      events.on('bossSpawned', ({ name, title }) => {
        this.banner(`${name.toUpperCase()} — ${title}`, 2600);
        this.bossName.textContent = name.toUpperCase();
        this.bossFill.style.width = '100%';
        this.bossBar.style.display = 'block';
      }),
      events.on('bossHp', ({ frac }) => {
        this.bossFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      }),
      events.on('bossDefeated', () => {
        this.bossBar.style.display = 'none';
      }),
    );
  }

  /** Per-frame cheap sync (DOM only touched on change). */
  set(damage: number, stocks: number): void {
    const d = Math.round(damage);
    if (d !== this.lastDamage) {
      this.lastDamage = d;
      this.damageEl.textContent = `${d}%`;
      // Green → yellow → orange → red as damage climbs (danger readout).
      const hue = Math.max(0, 120 - d * 1.1);
      this.damageEl.style.color = `hsl(${hue}, 90%, 46%)`;
      this.damageEl.classList.remove('bf-damage-pop');
      void this.damageEl.offsetWidth; // restart the pop animation
      this.damageEl.classList.add('bf-damage-pop');
    }
    if (stocks !== this.lastStocks) {
      this.lastStocks = stocks;
      this.stocksEl.replaceChildren();
      for (let i = 0; i < Math.max(0, stocks); i += 1) el('span', 'bf-stock', this.stocksEl);
    }
  }

  banner(text: string, ms = 1600): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('bf-banner-show');
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerEl.classList.remove('bf-banner-show');
    }, ms);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.root.remove();
  }
}
