/**
 * @fileoverview Public surface of the audio module: synth engine, glass voices, microphone, and
 * pitch detection.
 * @module audio
 */

export { AudioEngine } from './audio-engine.ts';
export { GlassVoice, type VoiceOptions } from './glass-voice.ts';
export { Microphone, type MicrophoneResult, type VoiceReading } from './microphone.ts';
export {
  detectPitch,
  type PitchOptions,
  type PitchReading,
  rootMeanSquare,
} from './pitch-detector.ts';
