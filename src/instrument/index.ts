/**
 * @fileoverview Public surface of the instrument module: note lifecycle, input, key layout.
 * @module instrument
 */

export { Instrument, type NoteOptions, type NoteSource, type Played } from './instrument.ts';
export { degreeAtX, KEY_DEGREES, keyLabel, type PitchRange, pitchRangeFor } from './key-map.ts';
export { Performer, type PerformerHooks, type Stir } from './performer.ts';
