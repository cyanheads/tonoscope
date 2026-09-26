/**
 * @fileoverview The playable D Lydian range and pitch helpers.
 * @module tests/music/scale
 */

import { describe, expect, it } from 'vitest';
import {
  degreeToMidi,
  frequencyToMidi,
  midiLabel,
  midiToFrequency,
  NOTE_COUNT,
  NOTES,
  nearestDegree,
  noteAt,
} from '../../src/music/index.ts';

describe('scale', () => {
  it('spans D3 to D6 in D Lydian', () => {
    expect(NOTES).toHaveLength(NOTE_COUNT);
    expect(NOTES.map((n) => `${n.name}${n.octave}`).slice(0, 8)).toEqual([
      'D3',
      'E3',
      'F♯3',
      'G♯3',
      'A3',
      'B3',
      'C♯4',
      'D4',
    ]);
    expect(noteAt(NOTE_COUNT - 1).midi).toBe(86);
  });

  it('rises strictly with degree', () => {
    for (let d = 1; d < NOTE_COUNT; d += 1)
      expect(degreeToMidi(d)).toBeGreaterThan(degreeToMidi(d - 1));
  });

  it('round-trips MIDI and frequency', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(frequencyToMidi(440)).toBe(69);
    expect(frequencyToMidi(midiToFrequency(57.3))).toBeCloseTo(57.3, 9);
  });

  it('rejects degrees outside the range', () => {
    expect(() => noteAt(NOTE_COUNT)).toThrow(RangeError);
  });

  it('labels MIDI numbers', () => {
    expect(midiLabel(69)).toBe('A4');
    expect(midiLabel(61.2)).toBe('C♯4');
  });
});

describe('nearestDegree', () => {
  it('snaps an in-scale pitch to its own degree', () => {
    expect(nearestDegree(69)).toBe(11); // A4
  });

  it('snaps an out-of-scale pitch to a neighbour', () => {
    expect([10, 11]).toContain(nearestDegree(68.4)); // between G♯4 and A4
  });

  it('folds pitches outside the range by octaves', () => {
    expect(noteAt(nearestDegree(45)).name).toBe('A'); // A2, below the range
    expect(noteAt(nearestDegree(93)).name).toBe('A'); // A6, above it
  });
});
