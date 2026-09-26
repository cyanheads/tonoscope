/**
 * @fileoverview Microphone input for "Sing" mode. The signal is analysed only — never routed to
 * the speakers — so there is no feedback loop.
 * @module audio/microphone
 */

import { detectPitch, rootMeanSquare } from './pitch-detector.ts';

export interface VoiceReading {
  /** Detected fundamental in Hz, or null when the input is silent or unpitched. */
  readonly frequency: number | null;
  readonly clarity: number;
  /** Input loudness (RMS of the analysis window). */
  readonly level: number;
}

export type MicrophoneResult =
  | { readonly ok: true; readonly microphone: Microphone }
  | { readonly ok: false; readonly reason: 'denied' | 'unavailable'; readonly detail: string };

const SILENCE = 0.008;
const MIN_CLARITY = 0.82;

export class Microphone {
  private readonly ctx: AudioContext;
  private readonly stream: MediaStream;
  private readonly analyser: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;

  private constructor(ctx: AudioContext, stream: MediaStream, analyser: AnalyserNode) {
    this.ctx = ctx;
    this.stream = stream;
    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize);
  }

  static async open(ctx: AudioContext): Promise<MicrophoneResult> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: 'unavailable', detail: 'getUserMedia is not supported here' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const source = new MediaStreamAudioSourceNode(ctx, { mediaStream: stream });
      const analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
      source.connect(analyser);
      return { ok: true, microphone: new Microphone(ctx, stream, analyser) };
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      return { ok: false, reason: denied ? 'denied' : 'unavailable', detail: String(error) };
    }
  }

  read(): VoiceReading {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const level = rootMeanSquare(this.buffer);
    if (level < SILENCE) return { frequency: null, clarity: 0, level };
    const pitch = detectPitch(this.buffer, this.ctx.sampleRate);
    if (!pitch || pitch.clarity < MIN_CLARITY) {
      return { frequency: null, clarity: pitch?.clarity ?? 0, level };
    }
    return { frequency: pitch.frequency, clarity: pitch.clarity, level };
  }

  close(): void {
    for (const track of this.stream.getTracks()) track.stop();
    this.analyser.disconnect();
  }
}
