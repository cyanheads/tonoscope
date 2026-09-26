/**
 * @fileoverview Public surface of the music module: scale, Scriabin colors, generative composer.
 * @module music
 */

export { BAR_SECONDS, type ComposedNote, Composer } from './composer.ts';
export {
  degreeToMidi,
  frequencyToMidi,
  LYDIAN_STEPS,
  midiLabel,
  midiToFrequency,
  NOTE_COUNT,
  NOTES,
  nearestDegree,
  noteAt,
  PITCH_NAMES,
  type ScaleNote,
  TONIC_MIDI,
} from './scale.ts';
export { hexToRgb, pitchClassHex, pitchClassLinear, type Rgb, SCRIABIN_HEX } from './scriabin.ts';
