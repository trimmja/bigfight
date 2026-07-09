import type { GameEvents } from '../core/events';
import { clamp } from '../core/math';

type UiKind = GameEvents['ui']['kind'];
type SourceNode = AudioBufferSourceNode | OscillatorNode;

const MIN_GAIN = 0.0001;
const TAIL_SECONDS = 0.04;

/**
 * Disposable procedural SFX synths built from Web Audio nodes.
 */
export class Sfx {
  private readonly noiseBuffer: AudioBuffer;

  /**
   * Creates a synth bank routed into the provided SFX bus.
   */
  constructor(
    private readonly ctx: AudioContext,
    private readonly bus: GainNode,
  ) {
    this.noiseBuffer = this.createNoiseBuffer();
  }

  /**
   * Impact burst whose weight scales with damage.
   */
  hit(intensity: number): number {
    if (!this.canSchedule()) return 0;

    const amount = clamp(intensity, 0, 25);
    const when = this.ctx.currentTime + 0.001;
    const duration = 0.06 + amount * 0.0035;
    const noise = this.createNoiseSource();
    const noiseFilter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();
    const square = this.ctx.createOscillator();
    const squareGain = this.ctx.createGain();
    const sources: SourceNode[] = [noise, square];
    const nodes: AudioNode[] = [noiseFilter, noiseGain, squareGain];

    noiseFilter.type = 'bandpass';
    noiseFilter.Q.setValueAtTime(6, when);
    noiseFilter.frequency.setValueAtTime(800, when);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, when + duration);
    this.envelope(noiseGain.gain, when, 0.1 + amount * 0.014, 0.004, duration);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.bus);

    square.type = 'square';
    square.frequency.setValueAtTime(300, when);
    square.frequency.exponentialRampToValueAtTime(80, when + duration);
    this.envelope(squareGain.gain, when, 0.04 + amount * 0.006, 0.003, duration * 0.9);
    square.connect(squareGain);
    squareGain.connect(this.bus);

    if (amount >= 10) {
      const thump = this.ctx.createOscillator();
      const thumpGain = this.ctx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(55, when);
      this.envelope(thumpGain.gain, when, 0.18, 0.006, 0.16);
      thump.connect(thumpGain);
      thumpGain.connect(this.bus);
      sources.push(thump);
      nodes.push(thumpGain);
      thump.start(when);
      thump.stop(when + 0.16 + TAIL_SECONDS);
    }

    this.cleanup(sources, nodes);
    noise.start(when, Math.random() * 0.5);
    noise.stop(when + duration + TAIL_SECONDS);
    square.start(when);
    square.stop(when + duration + TAIL_SECONDS);
    return duration + 0.18;
  }

  /**
   * KO blast with an explosion body and rising triad sting.
   */
  ko(): number {
    if (!this.canSchedule()) return 0;

    const baseDuration = this.explode();
    const when = this.ctx.currentTime + 0.03;
    const duration = 0.35;
    const freqs = [400, 500, 600] as const;
    const sources: SourceNode[] = [];
    const nodes: AudioNode[] = [];

    for (let i = 0; i < freqs.length; i += 1) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startFreq = freqs[i] ?? 400;
      osc.type = 'sawtooth';
      osc.detune.setValueAtTime((i - 1) * 8, when);
      osc.frequency.setValueAtTime(startFreq, when);
      osc.frequency.exponentialRampToValueAtTime(startFreq * 3, when + duration);
      this.envelope(gain.gain, when, 0.06, 0.02, duration);
      osc.connect(gain);
      gain.connect(this.bus);
      sources.push(osc);
      nodes.push(gain);
      osc.start(when);
      osc.stop(when + duration + TAIL_SECONDS);
    }

    this.cleanup(sources, nodes);
    return Math.max(baseDuration, duration + 0.08);
  }

  /**
   * Quiet upward jump portamento.
   */
  jump(): number {
    return this.simpleTone('sine', 250, 600, 0.12, 0.045);
  }

  /**
   * Weapon fire palette keyed by projectile kind.
   */
  shoot(kind: string): number {
    const normalized = kind.toLowerCase();
    if (normalized === 'gun' || normalized === 'bullet') return this.shootGun();
    if (normalized === 'laser') return this.shootLaser();
    if (normalized === 'rocket' || normalized === 'bomb') return this.shootWhoosh();
    if (normalized === 'feather') return this.shootFeather();
    if (normalized === 'slash') return this.shootSlash();
    if (normalized === 'flame') return this.shootFlame();
    if (normalized === 'shockwave') return this.shootThunder();
    return this.shootMagic();
  }

  /** Airy "shwip" for sword slash waves: fast bandpass noise sweep upward. */
  private shootSlash(): number {
    if (!this.canSchedule()) return 0;
    const when = this.ctx.currentTime + 0.001;
    const duration = 0.14;
    const noise = this.createNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.6, when);
    filter.frequency.setValueAtTime(900, when);
    filter.frequency.exponentialRampToValueAtTime(4200, when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.11, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    this.cleanup([noise], [filter, gain]);
    noise.start(when, Math.random() * 0.5);
    noise.stop(when + duration + TAIL_SECONDS);
    return duration;
  }

  /** Fire whoosh: rising filtered roar with a crackle tail. */
  private shootFlame(): number {
    if (!this.canSchedule()) return 0;
    const when = this.ctx.currentTime + 0.001;
    const duration = 0.4;
    const noise = this.createNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(0.9, when);
    filter.frequency.setValueAtTime(320, when);
    filter.frequency.exponentialRampToValueAtTime(1500, when + duration * 0.6);
    filter.frequency.exponentialRampToValueAtTime(700, when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.16, when + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    this.cleanup([noise], [filter, gain]);
    noise.start(when, Math.random() * 0.4);
    noise.stop(when + duration + TAIL_SECONDS);
    return duration;
  }

  /** Thunder crack for hammer shockwaves: instant snap + deep rolling boom. */
  private shootThunder(): number {
    if (!this.canSchedule()) return 0;
    const when = this.ctx.currentTime + 0.001;
    const duration = 0.55;
    // Snap: short bright noise burst.
    const snap = this.createNoiseSource();
    const snapFilter = this.ctx.createBiquadFilter();
    const snapGain = this.ctx.createGain();
    snapFilter.type = 'highpass';
    snapFilter.frequency.setValueAtTime(2400, when);
    snapGain.gain.setValueAtTime(0.0001, when);
    snapGain.gain.exponentialRampToValueAtTime(0.2, when + 0.006);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    snap.connect(snapFilter);
    snapFilter.connect(snapGain);
    snapGain.connect(this.bus);
    // Boom: low rumble sweeping down + sub thump.
    const boom = this.createNoiseSource();
    const boomFilter = this.ctx.createBiquadFilter();
    const boomGain = this.ctx.createGain();
    boomFilter.type = 'lowpass';
    boomFilter.frequency.setValueAtTime(900, when);
    boomFilter.frequency.exponentialRampToValueAtTime(120, when + duration);
    boomGain.gain.setValueAtTime(0.0001, when);
    boomGain.gain.exponentialRampToValueAtTime(0.22, when + 0.03);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    boom.connect(boomFilter);
    boomFilter.connect(boomGain);
    boomGain.connect(this.bus);
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, when);
    sub.frequency.exponentialRampToValueAtTime(38, when + 0.3);
    subGain.gain.setValueAtTime(0.0001, when);
    subGain.gain.exponentialRampToValueAtTime(0.24, when + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
    sub.connect(subGain);
    subGain.connect(this.bus);
    this.cleanup([snap, boom, sub], [snapFilter, snapGain, boomFilter, boomGain, subGain]);
    snap.start(when, Math.random() * 0.5);
    snap.stop(when + 0.1 + TAIL_SECONDS);
    boom.start(when, Math.random() * 0.3);
    boom.stop(when + duration + TAIL_SECONDS);
    sub.start(when);
    sub.stop(when + 0.4 + TAIL_SECONDS);
    return duration;
  }

  /**
   * Full procedural explosion.
   */
  explode(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.6;
    const noise = this.createNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(2, when);
    filter.frequency.setValueAtTime(2000, when);
    filter.frequency.exponentialRampToValueAtTime(100, when + duration);
    this.envelope(noiseGain.gain, when, 0.55, 0.01, duration);

    sub.type = 'sine';
    sub.frequency.setValueAtTime(55, when);
    sub.frequency.exponentialRampToValueAtTime(36, when + 0.28);
    this.envelope(subGain.gain, when, 0.24, 0.006, 0.32);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.bus);
    sub.connect(subGain);
    subGain.connect(this.bus);

    this.cleanup([noise, sub], [filter, noiseGain, subGain]);
    noise.start(when, Math.random() * 0.35);
    noise.stop(when + duration + TAIL_SECONDS);
    sub.start(when);
    sub.stop(when + 0.32 + TAIL_SECONDS);
    return duration + TAIL_SECONDS;
  }

  /**
   * Bright ascending pickup arpeggio.
   */
  pickup(): number {
    if (!this.canSchedule()) return 0;
    this.scheduleArp([660, 880, 1320], 0.03, 0.05, 0.055);
    return 0.13;
  }

  /**
   * Major arpeggio with high sparkle tones.
   */
  powerup(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    this.scheduleArp([440, 550, 660, 880], 0.045, 0.08, 0.07);
    const sparkles = [1760, 2349, 2637] as const;
    for (let i = 0; i < sparkles.length; i += 1) {
      this.scheduleTone({
        type: 'sine',
        startFreq: sparkles[i] ?? 1760,
        endFreq: (sparkles[i] ?? 1760) * 1.2,
        when: when + 0.08 + i * 0.025,
        duration: 0.06,
        peak: 0.035,
        attack: 0.006,
      });
    }
    return 0.28;
  }

  /**
   * Compact two-note wave-clear fanfare.
   */
  waveClear(): number {
    if (!this.canSchedule()) return 0;
    this.scheduleArp([784, 1047], 0.08, 0.12, 0.075);
    return 0.24;
  }

  /**
   * Distorted low boss roar with noise rumble.
   */
  bossRoar(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.8;
    const roar = this.ctx.createOscillator();
    const shaper = this.ctx.createWaveShaper();
    const roarGain = this.ctx.createGain();
    const noise = this.createNoiseSource();
    const noiseFilter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();

    roar.type = 'sawtooth';
    roar.frequency.setValueAtTime(80, when);
    roar.frequency.exponentialRampToValueAtTime(45, when + duration);
    shaper.curve = this.distortionCurve(1.8);
    shaper.oversample = '2x';
    this.envelope(roarGain.gain, when, 0.26, 0.03, duration);

    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(300, when);
    noiseFilter.frequency.exponentialRampToValueAtTime(90, when + duration);
    this.envelope(noiseGain.gain, when, 0.22, 0.04, duration);

    roar.connect(shaper);
    shaper.connect(roarGain);
    roarGain.connect(this.bus);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.bus);

    this.cleanup([roar, noise], [shaper, roarGain, noiseFilter, noiseGain]);
    roar.start(when);
    roar.stop(when + duration + TAIL_SECONDS);
    noise.start(when, Math.random() * 0.2);
    noise.stop(when + duration + TAIL_SECONDS);
    return duration + TAIL_SECONDS;
  }

  /**
   * Short UI blips with distinct interaction colors.
   */
  ui(kind: UiKind): number {
    switch (kind) {
      case 'move':
        return this.simpleTone('sine', 440, 440, 0.04, 0.035);
      case 'confirm':
        return this.simpleTone('sine', 660, 880, 0.06, 0.05);
      case 'back':
        return this.simpleTone('triangle', 330, 220, 0.07, 0.04);
      case 'buy':
        if (!this.canSchedule()) return 0;
        this.scheduleArp([880, 1320], 0.04, 0.06, 0.055);
        return 0.12;
      case 'error':
        return this.simpleTone('square', 150, 145, 0.12, 0.06);
      case 'unlock':
        if (!this.canSchedule()) return 0;
        this.scheduleArp([660, 880, 1320], 0.04, 0.08, 0.06);
        return 0.18;
    }
  }

  private shootGun(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.03;
    const square = this.ctx.createOscillator();
    const squareGain = this.ctx.createGain();
    const click = this.createNoiseSource();
    const clickFilter = this.ctx.createBiquadFilter();
    const clickGain = this.ctx.createGain();

    square.type = 'square';
    square.frequency.setValueAtTime(220, when);
    this.envelope(squareGain.gain, when, 0.08, 0.002, duration);
    clickFilter.type = 'highpass';
    clickFilter.frequency.setValueAtTime(3500, when);
    this.envelope(clickGain.gain, when, 0.08, 0.001, 0.025);

    square.connect(squareGain);
    squareGain.connect(this.bus);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.bus);

    this.cleanup([square, click], [squareGain, clickFilter, clickGain]);
    square.start(when);
    square.stop(when + duration + TAIL_SECONDS);
    click.start(when, Math.random() * 0.5);
    click.stop(when + 0.025 + TAIL_SECONDS);
    return 0.08;
  }

  private shootLaser(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.15;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, when);
    osc.frequency.exponentialRampToValueAtTime(300, when + duration);
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(10, when);
    filter.frequency.setValueAtTime(1800, when);
    filter.frequency.exponentialRampToValueAtTime(500, when + duration);
    this.envelope(gain.gain, when, 0.09, 0.004, duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    this.cleanup([osc], [filter, gain]);
    osc.start(when);
    osc.stop(when + duration + TAIL_SECONDS);
    return duration + TAIL_SECONDS;
  }

  private shootWhoosh(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.16;
    const noise = this.createNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.8, when);
    filter.frequency.setValueAtTime(1400, when);
    filter.frequency.exponentialRampToValueAtTime(240, when + duration);
    this.envelope(gain.gain, when, 0.11, 0.012, duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    this.cleanup([noise], [filter, gain]);
    noise.start(when, Math.random() * 0.4);
    noise.stop(when + duration + TAIL_SECONDS);
    return duration + TAIL_SECONDS;
  }

  private shootMagic(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.14;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(500, when);
    osc.frequency.exponentialRampToValueAtTime(900, when + duration);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(18, when);
    lfoGain.gain.setValueAtTime(20, when);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    this.envelope(gain.gain, when, 0.075, 0.01, duration);

    osc.connect(gain);
    gain.connect(this.bus);
    this.cleanup([osc, lfo], [gain, lfoGain]);
    osc.start(when);
    osc.stop(when + duration + TAIL_SECONDS);
    lfo.start(when);
    lfo.stop(when + duration + TAIL_SECONDS);
    return duration + TAIL_SECONDS;
  }

  private shootFeather(): number {
    if (!this.canSchedule()) return 0;

    const when = this.ctx.currentTime + 0.001;
    const duration = 0.08;
    const noise = this.createNoiseSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1800, when);
    filter.frequency.exponentialRampToValueAtTime(800, when + duration);
    this.envelope(gain.gain, when, 0.035, 0.01, duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    this.cleanup([noise], [filter, gain]);
    noise.start(when, Math.random() * 0.6);
    noise.stop(when + duration + TAIL_SECONDS);
    return duration + TAIL_SECONDS;
  }

  private simpleTone(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    peak: number,
  ): number {
    if (!this.canSchedule()) return 0;
    this.scheduleTone({
      type,
      startFreq,
      endFreq,
      when: this.ctx.currentTime + 0.001,
      duration,
      peak,
      attack: Math.min(0.01, duration * 0.25),
    });
    return duration + TAIL_SECONDS;
  }

  private scheduleArp(
    freqs: readonly number[],
    stepSeconds: number,
    noteSeconds: number,
    peak: number,
  ): void {
    const when = this.ctx.currentTime + 0.001;
    for (let i = 0; i < freqs.length; i += 1) {
      this.scheduleTone({
        type: 'triangle',
        startFreq: freqs[i] ?? 660,
        endFreq: freqs[i] ?? 660,
        when: when + i * stepSeconds,
        duration: noteSeconds,
        peak,
        attack: 0.006,
      });
    }
  }

  private scheduleTone(options: {
    type: OscillatorType;
    startFreq: number;
    endFreq: number;
    when: number;
    duration: number;
    peak: number;
    attack: number;
  }): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = options.type;
    osc.frequency.setValueAtTime(options.startFreq, options.when);
    osc.frequency.exponentialRampToValueAtTime(options.endFreq, options.when + options.duration);
    this.envelope(gain.gain, options.when, options.peak, options.attack, options.duration);
    osc.connect(gain);
    gain.connect(this.bus);
    this.cleanup([osc], [gain]);
    osc.start(options.when);
    osc.stop(options.when + options.duration + TAIL_SECONDS);
  }

  private envelope(
    param: AudioParam,
    when: number,
    peak: number,
    attack: number,
    duration: number,
  ): void {
    const safePeak = Math.max(MIN_GAIN, peak);
    param.cancelScheduledValues(when);
    param.setValueAtTime(MIN_GAIN, when);
    param.exponentialRampToValueAtTime(safePeak, when + attack);
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

  private createNoiseSource(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    return source;
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

  private distortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const buffer = new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT);
    const curve = new Float32Array(buffer);
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    return curve;
  }

  private canSchedule(): boolean {
    return this.ctx.state === 'running';
  }
}
