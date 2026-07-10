import type { IAudio } from '../contracts';
import type { GameEvents } from '../core/events';
import { events } from '../core/events';
import { Music } from './music';
import { Sfx } from './sfx';
import { getVoiceBuffer, VOICE_DATA, type VoiceId } from './voicepack';

type Mood = GameEvents['music']['mood'];
type SfxPriority = 'normal' | 'ui';
type WebAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const MAX_SFX_VOICES = 8;
const UI_SOFT_CAP = 6;
const MASTER_RAMP_SECONDS = 0.05;

/**
 * Lazy Web Audio implementation for all procedural game audio.
 */
export class AudioEngine implements IAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: Sfx | null = null;
  private music: Music | null = null;
  /** ElevenLabs voice lines get their own bus — never crowded out by SFX. */
  private voiceBus: GainNode | null = null;
  private _muted = false;
  private unlockComplete = false;
  private activeSfxVoices = 0;
  private pendingMood: Mood = 'off';

  private readonly handleUnlockGesture = (): void => {
    void this.unlock();
  };

  private readonly handleVisibilityChange = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;

    if (document.visibilityState === 'hidden') {
      if (ctx.state === 'running') void ctx.suspend().catch(() => undefined);
      return;
    }

    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') this.finishUnlock();
      })
      .catch(() => undefined);
  };

  /**
   * Subscribes to game events and installs one-shot browser audio unlock hooks.
   */
  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.handleUnlockGesture, { capture: true, passive: true });
      window.addEventListener('keydown', this.handleUnlockGesture, { capture: true });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.subscribeToEvents();
  }

  /**
   * True when all output is ramped to silence.
   */
  get muted(): boolean {
    return this._muted;
  }

  /**
   * Ramps master output without clicks and remembers the user's setting.
   */
  setMuted(muted: boolean): void {
    this._muted = muted;
    const master = this.master;
    const ctx = this.ctx;
    if (!ctx || !master) return;

    const target = muted ? 0 : 1;
    if (ctx.state !== 'running') {
      master.gain.value = target;
      return;
    }

    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + MASTER_RAMP_SECONDS);
  }

  private subscribeToEvents(): void {
    events.on('hit', ({ damage }) => {
      this.playSfx('normal', (sfx) => sfx.hit(damage));
    });
    events.on('ko', ({ kind, characterId }) => {
      this.playSfx('normal', (sfx) => sfx.ko());
      // Star KO = the character's ElevenLabs falling scream (players only —
      // mob ids simply aren't in the pack, so the lookup no-ops).
      if (kind === 'star') this.playVoice(`scream_${characterId}` as VoiceId);
    });
    events.on('announce', ({ id }) => {
      this.playVoice(id as VoiceId);
    });
    events.on('jump', () => {
      this.playSfx('normal', (sfx) => sfx.jump());
    });
    events.on('shoot', ({ kind }) => {
      this.playSfx('normal', (sfx) => sfx.shoot(kind));
    });
    events.on('explosion', () => {
      this.playSfx('normal', (sfx) => sfx.explode());
    });
    events.on('loot', () => {
      this.playSfx('normal', (sfx) => sfx.pickup());
    });
    events.on('powerup', () => {
      this.playSfx('normal', (sfx) => sfx.powerup());
    });
    events.on('waveCleared', () => {
      this.playSfx('normal', (sfx) => sfx.waveClear());
    });
    events.on('ui', ({ kind }) => {
      this.playSfx('ui', (sfx) => sfx.ui(kind));
    });
    events.on('bossSpawned', () => {
      this.playSfx('normal', (sfx) => sfx.bossRoar());
      this.setMood('boss');
    });
    events.on('music', ({ mood }) => {
      this.setMood(mood);
    });
    events.on('levelCleared', () => {
      this.setMood('victory');
    });
    events.on('levelFailed', () => {
      this.setMood('defeat');
    });
  }

  /** Fire-and-forget voice line (decoded lazily + cached in the voicepack). */
  private playVoice(id: VoiceId): void {
    const ctx = this.ctx;
    const voiceBus = this.voiceBus;
    if (!ctx || !voiceBus || ctx.state !== 'running') return;
    if (!(id in VOICE_DATA)) return; // unknown id (e.g. a mob star KO) — silent
    void getVoiceBuffer(ctx, id)
      .then((buffer) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(voiceBus);
        source.onended = () => source.disconnect();
        source.start();
      })
      .catch(() => undefined);
  }

  private playSfx(priority: SfxPriority, play: (sfx: Sfx) => number): void {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx || ctx.state !== 'running') return;
    if (this.activeSfxVoices >= MAX_SFX_VOICES) return;
    if (priority === 'ui' && this.activeSfxVoices >= UI_SOFT_CAP) return;

    this.activeSfxVoices += 1;
    const duration = Math.max(0.03, play(sfx));
    window.setTimeout(() => {
      this.activeSfxVoices = Math.max(0, this.activeSfxVoices - 1);
    }, (duration + 0.12) * 1000);
  }

  private setMood(mood: Mood): void {
    this.pendingMood = mood;
    if (!this.music || !this.ctx || this.ctx.state !== 'running') return;
    this.music.setMood(mood);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;

    const win = window as WebAudioWindow;
    const AudioContextCtor = typeof AudioContext !== 'undefined' ? AudioContext : win.webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    const sfxBus = ctx.createGain();
    const musicBus = ctx.createGain();
    const voiceBus = ctx.createGain();

    master.gain.value = this._muted ? 0 : 1;
    sfxBus.gain.value = 0.9;
    musicBus.gain.value = 0.55;
    voiceBus.gain.value = 1.0; // announcer/screams sit on top of the mix

    sfxBus.connect(master);
    musicBus.connect(master);
    voiceBus.connect(master);
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.voiceBus = voiceBus;
    this.sfx = new Sfx(ctx, sfxBus);
    this.music = new Music(ctx, musicBus);

    return ctx;
  }

  private async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'closed') return;

    this.playUnlockPulse(ctx);
    try {
      await ctx.resume();
    } catch {
      return;
    }

    if (ctx.state === 'running') this.finishUnlock();
  }

  private playUnlockPulse(ctx: AudioContext): void {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.master ?? ctx.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(0);
  }

  private finishUnlock(): void {
    if (this.unlockComplete) return;
    this.unlockComplete = true;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.handleUnlockGesture, true);
      window.removeEventListener('keydown', this.handleUnlockGesture, true);
    }

    if (this.pendingMood !== 'off') this.music?.setMood(this.pendingMood);
  }
}
