import type { GameEvents } from '../core/events';
import { mulberry32 } from '../core/math';

type Mood = GameEvents['music']['mood'];
type PlayableMood = Exclude<Mood, 'off'>;
type SourceNode = AudioBufferSourceNode | OscillatorNode;

interface Chord {
  readonly root: number;
  readonly tones: readonly [number, number, number];
}

interface MoodConfig {
  readonly bpm: number;
  readonly seed: number;
  readonly chords: readonly Chord[];
}

const MIN_GAIN = 0.0001;
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_MS = 25;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;
const NOTE_TAIL_SECONDS = 0.04;

const AM: Chord = { root: 0, tones: [0, 3, 7] };
const F: Chord = { root: -4, tones: [-4, 0, 3] };
const C: Chord = { root: 3, tones: [3, 7, 10] };
const G: Chord = { root: -2, tones: [-2, 2, 5] };
const E: Chord = { root: -5, tones: [-5, -1, 2] };
const EM: Chord = { root: -5, tones: [-5, -2, 2] };

const MOODS: Record<PlayableMood, MoodConfig> = {
  menu: {
    bpm: 100,
    seed: 0x100,
    chords: [AM, F, C, G],
  },
  battle: {
    bpm: 128,
    seed: 0x128,
    chords: [AM, AM, F, G],
  },
  boss: {
    bpm: 140,
    seed: 0x140,
    chords: [AM, F, E, E],
  },
  victory: {
    bpm: 120,
    seed: 0x777,
    chords: [C, G, AM, F],
  },
  defeat: {
    bpm: 72,
    seed: 0x444,
    chords: [AM, EM],
  },
};

/**
 * Procedural looping music with a small Web Audio lookahead scheduler.
 */
export class Music {
  private readonly noiseBuffer: AudioBuffer;
  private currentMood: Mood = 'off';
  private pendingMood: Mood | null = null;
  private activeGain: GainNode | null = null;
  private nextStepTime = 0;
  private moodStep = 0;
  private paused = true;
  private arpPattern: readonly number[] = [0, 1, 2, 1, 0, 2, 1, 2];

  /**
   * Creates the procedural music transport routed into the music bus.
   */
  constructor(
    private readonly ctx: AudioContext,
    private readonly bus: GainNode,
  ) {
    this.noiseBuffer = this.createNoiseBuffer();
    window.setInterval(() => this.scheduler(), SCHEDULER_MS);
  }

  /**
   * Queues a mood change and crossfades it on a bar boundary.
   */
  setMood(mood: Mood): void {
    if (mood === this.pendingMood) return;
    if (mood === this.currentMood && this.pendingMood === null) return;

    if (this.ctx.state !== 'running') {
      this.pendingMood = mood;
      return;
    }

    if (this.currentMood === 'off') {
      this.applyMood(mood, this.ctx.currentTime + 0.02);
      return;
    }

    this.pendingMood = mood;
  }

  private scheduler(): void {
    if (this.ctx.state !== 'running') {
      this.paused = true;
      return;
    }

    if (this.paused) {
      this.paused = false;
      this.nextStepTime = this.ctx.currentTime + 0.02;
    }

    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD_SECONDS) {
      if (this.pendingMood && this.moodStep % STEPS_PER_BAR === 0) {
        this.applyMood(this.pendingMood, this.nextStepTime);
      }

      if (this.currentMood !== 'off') {
        this.scheduleStep(this.currentMood, this.moodStep, this.nextStepTime);
      }

      this.nextStepTime += this.stepSeconds(this.currentMood);
      this.moodStep += 1;
    }
  }

  private applyMood(mood: Mood, when: number): void {
    this.pendingMood = null;
    const oldMood = this.currentMood;
    const fadeSeconds = this.barSeconds(oldMood === 'off' ? mood : oldMood);
    const oldGain = this.activeGain;

    if (oldGain) {
      const oldLevel = oldMood === 'off' ? 1 : this.moodLevel(oldMood);
      oldGain.gain.cancelScheduledValues(when);
      oldGain.gain.setValueAtTime(Math.max(MIN_GAIN, oldLevel), when);
      oldGain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + fadeSeconds);
      window.setTimeout(() => oldGain.disconnect(), (fadeSeconds + 0.2) * 1000);
    }

    this.currentMood = mood;
    this.moodStep = 0;

    if (mood === 'off') {
      this.activeGain = null;
      return;
    }

    this.arpPattern = this.createArpPattern(mood);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, when);
    gain.gain.exponentialRampToValueAtTime(this.moodLevel(mood), when + fadeSeconds);
    gain.connect(this.bus);
    this.activeGain = gain;
  }

  private scheduleStep(mood: PlayableMood, step: number, when: number): void {
    const config = MOODS[mood];
    const stepInBar = step % STEPS_PER_BAR;
    const beatStep = stepInBar % STEPS_PER_BEAT;
    const stepDuration = this.stepSeconds(mood);
    const chord = this.chordFor(mood, step);

    if (mood === 'victory' && step >= STEPS_PER_BAR * 2) {
      this.scheduleVictoryHold(stepInBar, chord, when);
      return;
    }

    if (stepInBar === 0) {
      this.schedulePad(chord, when, stepDuration * STEPS_PER_BAR, mood);
    }

    switch (mood) {
      case 'menu':
        if (stepInBar % 8 === 0) this.scheduleBass(chord, when, stepDuration * 3, 0.05);
        if (stepInBar % 2 === 0) this.scheduleArp(chord, step, when, stepDuration * 1.8, 0.028);
        break;
      case 'battle':
        if (stepInBar % 2 === 0) this.scheduleBass(chord, when, stepDuration * 1.7, 0.08);
        this.scheduleArp(chord, step, when, stepDuration * 0.85, 0.04);
        if (beatStep === 0) this.scheduleKick(when, 0.18);
        if (stepInBar % 2 === 1) this.scheduleHat(when, 0.035);
        break;
      case 'boss':
        if (stepInBar % 2 === 0) this.scheduleBass(chord, when, stepDuration * 1.8, 0.1);
        if (stepInBar % 2 === 0) this.scheduleArp(chord, step, when, stepDuration, 0.034);
        if (beatStep === 0 || beatStep === 2) this.scheduleKick(when, beatStep === 0 ? 0.22 : 0.12);
        if (stepInBar % 2 === 1) this.scheduleHat(when, 0.025);
        break;
      case 'victory':
        this.scheduleVictorySting(step, chord, when, config.bpm);
        break;
      case 'defeat':
        if (stepInBar === 0) this.scheduleBass(chord, when, stepDuration * 6, 0.055);
        if (stepInBar === 8) this.scheduleChime(this.noteFrequency(chord.tones[1] + 12), when, 0.45, 0.025);
        break;
    }
  }

  private scheduleVictorySting(step: number, chord: Chord, when: number, bpm: number): void {
    const stepInTwoBars = step % (STEPS_PER_BAR * 2);
    const stepDuration = 60 / bpm / STEPS_PER_BEAT;
    if (stepInTwoBars % 4 === 0) this.scheduleBass(chord, when, stepDuration * 2.5, 0.07);
    if (stepInTwoBars % 4 === 2) this.scheduleChime(this.noteFrequency(chord.tones[2] + 12), when, 0.18, 0.05);
    if (stepInTwoBars === 0 || stepInTwoBars === 8 || stepInTwoBars === 16 || stepInTwoBars === 24) {
      this.scheduleKick(when, 0.12);
    }
  }

  private scheduleVictoryHold(stepInBar: number, chord: Chord, when: number): void {
    if (stepInBar === 0) this.scheduleChime(this.noteFrequency(chord.tones[0] + 12), when, 0.55, 0.035);
    if (stepInBar === 8) this.scheduleChime(this.noteFrequency(chord.tones[2] + 12), when, 0.45, 0.025);
  }

  private scheduleBass(chord: Chord, when: number, duration: number, peak: number): void {
    this.scheduleTone({
      type: 'square',
      startFreq: this.noteFrequency(chord.root - 12),
      when,
      duration,
      peak,
      attack: 0.01,
      filterHz: 400,
    });
  }

  private schedulePad(chord: Chord, when: number, duration: number, mood: PlayableMood): void {
    const peak = mood === 'defeat' ? 0.018 : mood === 'boss' ? 0.024 : 0.022;
    for (const tone of chord.tones) {
      this.scheduleTone({
        type: 'sawtooth',
        startFreq: this.noteFrequency(tone),
        when,
        duration,
        peak,
        attack: 0.18,
        detune: -5,
        filterHz: 800,
      });
      this.scheduleTone({
        type: 'sawtooth',
        startFreq: this.noteFrequency(tone),
        when,
        duration,
        peak,
        attack: 0.18,
        detune: 5,
        filterHz: 800,
      });
    }
  }

  private scheduleArp(chord: Chord, step: number, when: number, duration: number, peak: number): void {
    const index = this.arpPattern[step % this.arpPattern.length] ?? 0;
    const tone = chord.tones[index] ?? chord.tones[0];
    this.scheduleTone({
      type: 'triangle',
      startFreq: this.noteFrequency(tone + 12),
      when,
      duration,
      peak,
      attack: 0.006,
    });
  }

  private scheduleHat(when: number, peak: number): void {
    const output = this.activeGain;
    if (!output) return;

    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const duration = 0.03;

    source.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6000, when);
    this.envelope(gain.gain, when, peak, 0.003, duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    this.cleanup([source], [filter, gain]);
    source.start(when, 0.17);
    source.stop(when + duration + NOTE_TAIL_SECONDS);
  }

  private scheduleKick(when: number, peak: number): void {
    this.scheduleTone({
      type: 'sine',
      startFreq: 150,
      endFreq: 50,
      when,
      duration: 0.18,
      peak,
      attack: 0.004,
    });
  }

  private scheduleChime(freq: number, when: number, duration: number, peak: number): void {
    this.scheduleTone({
      type: 'triangle',
      startFreq: freq,
      when,
      duration,
      peak,
      attack: 0.01,
    });
  }

  private scheduleTone(options: {
    type: OscillatorType;
    startFreq: number;
    endFreq?: number;
    when: number;
    duration: number;
    peak: number;
    attack: number;
    detune?: number;
    filterHz?: number;
  }): void {
    const output = this.activeGain;
    if (!output) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const nodes: AudioNode[] = [gain];

    osc.type = options.type;
    osc.frequency.setValueAtTime(options.startFreq, options.when);
    if (options.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(options.endFreq, options.when + options.duration);
    }
    if (options.detune !== undefined) osc.detune.setValueAtTime(options.detune, options.when);
    this.envelope(gain.gain, options.when, options.peak, options.attack, options.duration);

    if (options.filterHz !== undefined) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(options.filterHz, options.when);
      osc.connect(filter);
      filter.connect(gain);
      nodes.push(filter);
    } else {
      osc.connect(gain);
    }

    gain.connect(output);
    this.cleanup([osc], nodes);
    osc.start(options.when);
    osc.stop(options.when + options.duration + NOTE_TAIL_SECONDS);
  }

  private chordFor(mood: PlayableMood, step: number): Chord {
    const config = MOODS[mood];
    if (mood === 'victory') {
      const index = Math.floor((step % (STEPS_PER_BAR * 2)) / 8) % config.chords.length;
      return config.chords[index] ?? AM;
    }

    const loopBars = mood === 'defeat' ? 4 : 8;
    const bar = Math.floor(step / STEPS_PER_BAR) % loopBars;
    const index = Math.floor(bar / 2) % config.chords.length;
    return config.chords[index] ?? AM;
  }

  private createArpPattern(mood: PlayableMood): readonly number[] {
    const rng = mulberry32(MOODS[mood].seed);
    const pattern: number[] = [];
    for (let i = 0; i < STEPS_PER_BAR; i += 1) {
      pattern.push(Math.floor(rng() * 3));
    }
    return pattern;
  }

  private stepSeconds(mood: Mood): number {
    const bpm = mood === 'off' ? 120 : MOODS[mood].bpm;
    return 60 / bpm / STEPS_PER_BEAT;
  }

  private barSeconds(mood: Mood): number {
    return this.stepSeconds(mood) * STEPS_PER_BAR;
  }

  private moodLevel(mood: Mood): number {
    switch (mood) {
      case 'menu':
        return 0.5;
      case 'battle':
        return 0.6;
      case 'boss':
        return 0.65;
      case 'victory':
        return 0.62;
      case 'defeat':
        return 0.42;
      case 'off':
        return MIN_GAIN;
    }
  }

  private noteFrequency(semitoneFromA3: number): number {
    return 220 * 2 ** (semitoneFromA3 / 12);
  }

  private envelope(
    param: AudioParam,
    when: number,
    peak: number,
    attack: number,
    duration: number,
  ): void {
    param.cancelScheduledValues(when);
    param.setValueAtTime(MIN_GAIN, when);
    param.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak), when + attack);
    param.exponentialRampToValueAtTime(MIN_GAIN, when + duration);
  }

  private createNoiseBuffer(): AudioBuffer {
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private cleanup(sources: SourceNode[], nodes: AudioNode[]): void {
    let remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        source.disconnect();
        remaining -= 1;
        if (remaining > 0) return;
        for (const node of nodes) node.disconnect();
      };
    }
  }
}
