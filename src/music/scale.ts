/**
 * @fileoverview The playable scale — D Lydian across three octaves (D3–D6) — and pitch helpers.
 * Every note is addressed by its scale degree (0 = D3); degree order doubles as the order of
 * increasing figure complexity in each vessel.
 * @module music/scale
 */

/** Pitch-class names, index 0 = C. */
export const PITCH_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
] as const;

/** Semitone offsets of the Lydian mode from its tonic. */
export const LYDIAN_STEPS = [0, 2, 4, 6, 7, 9, 11] as const;

/** MIDI number of the lowest playable note (D3). */
export const TONIC_MIDI = 50;

/** Playable notes: three octaves plus the top tonic. */
export const NOTE_COUNT = 22;

export interface ScaleNote {
  /** Index into the playable range, 0 = D3. */
  readonly degree: number;
  readonly midi: number;
  readonly frequency: number;
  /** 0–11, C = 0. */
  readonly pitchClass: number;
  /** Scientific-pitch octave number (D4 → 4). */
  readonly octave: number;
  /** Pitch-class name without octave, e.g. "F♯". */
  readonly name: string;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function degreeToMidi(degree: number): number {
  const octave = Math.floor(degree / LYDIAN_STEPS.length);
  const step = degree - octave * LYDIAN_STEPS.length;
  return TONIC_MIDI + octave * 12 + (LYDIAN_STEPS[step] ?? 0);
}

function describe(degree: number): ScaleNote {
  const midi = degreeToMidi(degree);
  const pitchClass = ((midi % 12) + 12) % 12;
  return {
    degree,
    midi,
    frequency: midiToFrequency(midi),
    pitchClass,
    octave: Math.floor(midi / 12) - 1,
    name: PITCH_NAMES[pitchClass] ?? '?',
  };
}

/** The playable range, ascending. */
export const NOTES: readonly ScaleNote[] = Array.from({ length: NOTE_COUNT }, (_, d) =>
  describe(d),
);

export function noteAt(degree: number): ScaleNote {
  const note = NOTES[degree];
  if (!note) throw new RangeError(`Scale degree ${degree} is outside 0–${NOTE_COUNT - 1}`);
  return note;
}

/**
 * Nearest playable degree to an arbitrary (fractional) MIDI pitch. Pitches outside the range are
 * folded by octaves into it first, so a sung A2 still lands on a playable A.
 */
export function nearestDegree(midi: number): number {
  const low = TONIC_MIDI - 0.5;
  const high = degreeToMidi(NOTE_COUNT - 1) + 0.5;
  let folded = midi;
  while (folded < low) folded += 12;
  while (folded > high) folded -= 12;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const note of NOTES) {
    const distance = Math.abs(note.midi - folded);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = note.degree;
    }
  }
  return best;
}

/** "A4", "F♯3" — name plus octave for an arbitrary MIDI number. */
export function midiLabel(midi: number): string {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  return `${PITCH_NAMES[pitchClass]}${Math.floor(rounded / 12) - 1}`;
}
