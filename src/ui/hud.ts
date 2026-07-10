import { events } from '../core/events';
import type { PowerupId } from '../data/types';
import { el, uiRoot } from './dom';

const POWERUP_BANNERS: Record<PowerupId, string> = {
  healOrb: '💚 HEALED!',
  shieldBubble: '🛡️ SHIELD UP!',
  rageMode: '🔥 RAGE MODE!',
  giantHammer: '🔨 GIANT HAMMER!',
  freezeRay: '❄️ FREEZE RAY!',
};

/** One multiplayer HUD cluster's worth of data (Smash-style bottom row). */
export interface PlayerHudView {
  slot: number;
  color: number;
  name: string;
  characterName: string;
  damage: number;
  stocks: number;
  eliminated: boolean;
  isLocal: boolean;
}

type Cluster = {
  root: HTMLElement;
  damageEl: HTMLElement;
  stocksEl: HTMLElement;
  lastDamage: number;
  lastStocks: number;
  lastEliminated: boolean;
};

/**
 * In-fight HUD: damage %, stock pips, wave banner, boss health bar.
 * GameplayScreen calls set() (solo corner) or setPlayers() (multiplayer
 * bottom-center row) once per frame; everything else is event-driven.
 */
export class Hud {
  private root: HTMLElement;
  private damageEl: HTMLElement;
  private stocksEl: HTMLElement;
  private bannerEl: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private cornerEl: HTMLElement;
  private rowEl: HTMLElement | null = null;
  private clusters: Cluster[] = [];

  private lastDamage = -1;
  private lastStocks = -1;
  private bannerTimer: number | null = null;
  private unsubs: (() => void)[] = [];

  constructor() {
    this.root = uiRoot('bf-hud');

    const corner = el('div', 'bf-hud-corner', this.root);
    this.cornerEl = corner;
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
      // Powerup pickups announce themselves — a silent weapon override reads
      // as a glitch ("why am I holding a hammer?!") instead of a reward.
      events.on('powerup', ({ id }) => {
        this.banner(POWERUP_BANNERS[id] ?? 'POWER UP!', 2000);
      }),
      // Netplay peer health — small top banner, kid-voice, never blocks play.
      events.on('netPeer', ({ kind }) => {
        if (kind === 'lagging') this.banner('⚠️ Reconnecting…', 1500);
        else if (kind === 'disconnected') this.banner('💨 Player left the fight!', 2400);
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

  /** Multiplayer: 2-4 slot-colored clusters, Smash-style bottom-center row. */
  setPlayers(views: readonly PlayerHudView[]): void {
    if (!this.rowEl) {
      this.cornerEl.style.display = 'none';
      this.rowEl = el('div', 'bf-hud-row', this.root);
      this.clusters = [];
      for (const view of views) {
        const cluster = el('div', 'bf-hud-cluster', this.rowEl);
        cluster.style.setProperty('--slot', `#${view.color.toString(16).padStart(6, '0')}`);
        if (view.isLocal) cluster.classList.add('bf-hud-cluster-local');
        const label = el('div', 'bf-hud-name', cluster);
        label.textContent = `P${view.slot + 1} ${view.name}`;
        const damageEl = el('div', 'bf-damage bf-hud-cluster-damage', cluster);
        damageEl.textContent = '0%';
        const stocksEl = el('div', 'bf-stocks', cluster);
        this.clusters.push({
          root: cluster,
          damageEl,
          stocksEl,
          lastDamage: -1,
          lastStocks: -1,
          lastEliminated: false,
        });
      }
    }
    for (let i = 0; i < views.length && i < this.clusters.length; i += 1) {
      const view = views[i]!;
      const cluster = this.clusters[i]!;
      const d = Math.round(view.damage);
      if (d !== cluster.lastDamage) {
        cluster.lastDamage = d;
        cluster.damageEl.textContent = `${d}%`;
        const hue = Math.max(0, 120 - d * 1.1);
        cluster.damageEl.style.color = `hsl(${hue}, 90%, 46%)`;
        cluster.damageEl.classList.remove('bf-damage-pop');
        void cluster.damageEl.offsetWidth;
        cluster.damageEl.classList.add('bf-damage-pop');
      }
      if (view.stocks !== cluster.lastStocks) {
        cluster.lastStocks = view.stocks;
        cluster.stocksEl.replaceChildren();
        for (let s = 0; s < Math.max(0, view.stocks); s += 1) el('span', 'bf-stock', cluster.stocksEl);
      }
      if (view.eliminated !== cluster.lastEliminated) {
        cluster.lastEliminated = view.eliminated;
        cluster.root.classList.toggle('bf-hud-cluster-out', view.eliminated);
      }
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
