/**
 * @fileoverview One sounding note: a struck glass partial stack (slightly inharmonic, upper
 * partials dying first) with an optional bowed layer that swells while the note is held, like a
 * glass harmonica.
 * @module audio/glass-voice
 */

interface Partial {
  readonly ratio: number;
  readonly gain: number;
  /** Decay time constant in seconds at 220 Hz; scaled by pitch. */
  readonly decay: number;
  readonly detune: number;
}

const STRUCK: readonly Partial[] = [
  { ratio: 1, gain: 1, decay: 1.9, detune: 0 },
  { ratio: 1, gain: 0.32, decay: 1.6, detune: 0.9 },
  { ratio: 2.005, gain: 0.3, decay: 1.1, detune: 0 },
  { ratio: 3.01, gain: 0.12, decay: 0.7, detune: -1.1 },
  { ratio: 4.18, gain: 0.07, decay: 0.38, detune: 0 },
  { ratio: 5.43, gain: 0.05, decay: 0.16, detune: 0 },
  { ratio: 0.5, gain: 0.1, decay: 2.2, detune: 0 },
];

export interface VoiceOptions {
  readonly frequency: number;
  /** 0–1. */
  readonly velocity: number;
  /** -1..1. */
  readonly pan: number;
  /** Add the sustained, bowed layer (for held notes). */
  readonly bowed: boolean;
}

/** Held: the bowed layer sustains. Released: ringing out. Ended: out of the audio graph. */
type VoiceState = 'held' | 'released' | 'ended';

export class GlassVoice {
  private readonly ctx: AudioContext;
  private readonly output: GainNode;
  private readonly bow: GainNode | null;
  /** Every source, so a stolen voice can stop them all at once. */
  private readonly sources: OscillatorNode[] = [];
  /** Bowed-layer sources, stopped on release; struck partials stop themselves. */
  private readonly sustained: OscillatorNode[] = [];
  private state: VoiceState;

  constructor(ctx: AudioContext, destination: AudioNode, options: VoiceOptions) {
    this.ctx = ctx;
    this.state = options.bowed ? 'held' : 'released';
    const now = ctx.currentTime;
    const { frequency, velocity } = options;
    const pitchScale = Math.min(1.6, Math.max(0.45, (220 / frequency) ** 0.45));

    const panner = new StereoPannerNode(ctx, { pan: options.pan });
    this.output = new GainNode(ctx, { gain: 0.0001 + 0.22 * velocity });
    const tone = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: Math.min(16000, frequency * (5 + velocity * 7)),
      Q: 0.3,
    });
    tone.connect(this.output).connect(panner).connect(destination);

    let longest = 0;
    for (const partial of STRUCK) {
      const pf = frequency * partial.ratio;
      if (pf > 15000) continue;
      const decay = partial.decay * pitchScale * (0.8 + velocity * 0.4);
      const osc = new OscillatorNode(ctx, { frequency: pf, detune: partial.detune * 1.7 });
      const amp = new GainNode(ctx, { gain: 0 });
      amp.gain.setValueAtTime(0, now);
      amp.gain.linearRampToValueAtTime(partial.gain, now + 0.004);
      amp.gain.setTargetAtTime(0, now + 0.004, decay);
      osc.connect(amp).connect(tone);
      osc.start(now);
      osc.stop(now + decay * 7 + 0.1);
      this.sources.push(osc);
      longest = Math.max(longest, decay * 7);
    }

    if (options.bowed) {
      this.bow = new GainNode(ctx, { gain: 0 });
      this.bow.gain.setTargetAtTime(0.42, now + 0.03, 0.28);
      const vibrato = new OscillatorNode(ctx, { frequency: 5.1 });
      const vibratoDepth = new GainNode(ctx, { gain: frequency * 0.0022 });
      vibrato.connect(vibratoDepth);
      const tremolo = new OscillatorNode(ctx, { frequency: 3.3 });
      const tremoloDepth = new GainNode(ctx, { gain: 0.07 });
      tremolo.connect(tremoloDepth).connect(this.bow.gain);
      for (const [ratio, gain, detune] of [
        [1, 0.8, -3],
        [1, 0.6, 4],
        [2, 0.18, 0],
        [3, 0.05, 2],
      ] as const) {
        const osc = new OscillatorNode(ctx, { frequency: frequency * ratio, detune });
        vibratoDepth.connect(osc.frequency);
        const amp = new GainNode(ctx, { gain });
        osc.connect(amp).connect(this.bow);
        osc.start(now);
        this.sustained.push(osc);
      }
      vibrato.start(now);
      tremolo.start(now);
      this.sustained.push(vibrato, tremolo);
      this.sources.push(...this.sustained);
      this.bow.connect(tone);
    } else {
      this.bow = null;
      window.setTimeout(() => this.disconnect(), (longest + 0.5) * 1000);
    }
  }

  /** No longer held: struck, or released and ringing out. */
  get released(): boolean {
    return this.state !== 'held';
  }

  /** Out of the audio graph; it costs nothing more. */
  get ended(): boolean {
    return this.state === 'ended';
  }

  /** Let the bowed layer fade; the struck partials ring out on their own. */
  release(): void {
    if (this.state !== 'held' || !this.bow) return;
    this.state = 'released';
    const now = this.ctx.currentTime;
    this.bow.gain.cancelScheduledValues(now);
    this.bow.gain.setTargetAtTime(0, now, 0.45);
    for (const osc of this.sustained) osc.stop(now + 3.5);
    window.setTimeout(() => this.disconnect(), 4000);
  }

  /** Cut the voice short to make room for another: gone in a tenth of a second, without a click. */
  steal(): void {
    if (this.state === 'ended') return;
    this.state = 'released';
    const now = this.ctx.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(0, now, 0.015);
    for (const osc of this.sources) osc.stop(now + 0.1);
    window.setTimeout(() => this.disconnect(), 150);
  }

  private disconnect(): void {
    this.state = 'ended';
    this.output.disconnect();
  }
}
