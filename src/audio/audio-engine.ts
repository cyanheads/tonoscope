/**
 * @fileoverview The sound of the instrument: a voice bus feeding a generated-impulse hall reverb
 * and a filtered ping-pong delay, a quiet D drone underneath, and a gentle master compressor.
 * Everything is synthesized; nothing is loaded. Voices are capped, and the whole engine sleeps
 * while the page is hidden.
 * @module audio/audio-engine
 */

import { GlassVoice, type VoiceOptions } from './glass-voice.ts';

/**
 * Most voices sounding at once. Each is up to 13 oscillators, so a fast run or a mashed keyboard
 * would otherwise pile graphs up faster than they ring out and crackle on phones. Listen's own
 * texture, counted until each voice leaves the graph, has a median of 6 and a 99th percentile
 * of 10, so the cap all but never touches it, and the oldest released voice goes first.
 */
export const MAX_VOICES = 12;

/** Just what voice stealing needs to know about a voice. */
export interface Stealable {
  /** No longer held: struck, or ringing out after release. */
  readonly released: boolean;
}

/**
 * The voice to cut so one more fits under `cap`, or undefined while there is room. `live` is in
 * start order; the oldest released voice goes first (its tail is already fading), else the oldest.
 */
export function voiceToSteal<V extends Stealable>(live: readonly V[], cap: number): V | undefined {
  if (live.length < cap) return undefined;
  return live.find((voice) => voice.released) ?? live[0];
}

/** Stereo hall impulse: decaying noise that darkens as it fades, with a short pre-delay. */
function createImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * 0.018);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = preDelay; i < length; i += 1) {
      const t = (i - preDelay) / (length - preDelay);
      const noise = Math.random() * 2 - 1;
      const cutoff = 0.9 - 0.78 * t;
      low += cutoff * (noise - low);
      data[i] = low * (1 - t) ** 2.6 * Math.exp(-t * 2.2);
    }
  }
  return impulse;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly voices: GainNode;
  private readonly master: GainNode;
  private readonly droneGain: GainNode;
  /** Voices still in the graph, in start order. */
  private live: GlassVoice[] = [];
  private muted = false;
  private asleep = false;
  private sleepTimer = 0;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = new GainNode(ctx, { gain: 0.9 });
    const compressor = new DynamicsCompressorNode(ctx, {
      threshold: -16,
      knee: 12,
      ratio: 3,
      attack: 0.01,
      release: 0.35,
    });
    this.master.connect(compressor).connect(ctx.destination);

    this.voices = new GainNode(ctx, { gain: 0.8 });
    const dry = new GainNode(ctx, { gain: 0.62 });
    this.voices.connect(dry).connect(this.master);

    const reverb = new ConvolverNode(ctx, { buffer: createImpulse(ctx, 6.5) });
    const reverbSend = new GainNode(ctx, { gain: 0.55 });
    this.voices.connect(reverbSend).connect(reverb).connect(this.master);

    const delayIn = new GainNode(ctx, { gain: 0.16 });
    const left = new DelayNode(ctx, { delayTime: 0.46, maxDelayTime: 2 });
    const right = new DelayNode(ctx, { delayTime: 0.69, maxDelayTime: 2 });
    const feedback = new GainNode(ctx, { gain: 0.38 });
    const damp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2600 });
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.voices.connect(delayIn).connect(left);
    left.connect(damp).connect(right);
    right.connect(feedback).connect(left);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(reverbSend);
    merger.connect(new GainNode(ctx, { gain: 0.5 })).connect(this.master);

    this.droneGain = new GainNode(ctx, { gain: 0 });
    this.droneGain.connect(this.master);
    this.droneGain.connect(reverbSend);
    this.startDrone();
  }

  /**
   * Must run inside a user gesture: browsers only start audio after one. Resuming is not awaited —
   * nodes built while the context wakes simply start sounding once it runs.
   */
  static create(): AudioEngine {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    void ctx.resume();
    return new AudioEngine(ctx);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.fadeMaster(0.08);
  }

  /** Fade out and stop the audio clock, drone and all, while the page is hidden. */
  sleep(): void {
    if (this.asleep) return;
    this.asleep = true;
    this.fadeMaster(0.02);
    this.sleepTimer = window.setTimeout(() => void this.ctx.suspend(), 150);
  }

  /**
   * Undo `sleep()`, and restart a context the browser suspended or iOS interrupted (a call, the
   * screen locking). iOS may honor the restart only inside a user gesture, so input calls this too.
   */
  wake(): void {
    if (this.asleep) {
      this.asleep = false;
      window.clearTimeout(this.sleepTimer);
      this.fadeMaster(0.08);
    }
    // Outside a gesture the browser may refuse; the next gesture asks again.
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => undefined);
  }

  play(options: VoiceOptions): GlassVoice {
    this.live = this.live.filter((voice) => !voice.ended);
    const stolen = voiceToSteal(this.live, MAX_VOICES);
    if (stolen) {
      stolen.steal();
      this.live = this.live.filter((voice) => voice !== stolen);
    }
    const voice = new GlassVoice(this.ctx, this.voices, options);
    this.live.push(voice);
    return voice;
  }

  private fadeMaster(timeConstant: number): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted || this.asleep ? 0 : 0.9, now, timeConstant);
  }

  /** A D2/A2 pad an octave below the playable range, barely there, breathing slowly. */
  private startDrone(): void {
    const ctx = this.ctx;
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 420, Q: 0.6 });
    filter.connect(this.droneGain);
    const lfo = new OscillatorNode(ctx, { frequency: 0.05 });
    const lfoDepth = new GainNode(ctx, { gain: 180 });
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();
    for (const [frequency, detune, gain] of [
      [73.42, -4, 0.5],
      [73.42, 5, 0.5],
      [110, 2, 0.28],
      [146.83, -2, 0.12],
    ] as const) {
      const osc = new OscillatorNode(ctx, { type: 'triangle', frequency, detune });
      osc.connect(new GainNode(ctx, { gain })).connect(filter);
      osc.start();
    }
    this.droneGain.gain.setTargetAtTime(0.05, ctx.currentTime + 0.2, 2.5);
  }
}
