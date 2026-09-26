/**
 * @fileoverview Note lifecycle without audio: visual envelopes, release, pruning, onset agitation.
 * @module tests/instrument/instrument
 */

import { describe, expect, it } from 'vitest';
import { Instrument } from '../../src/instrument/instrument.ts';

const held = { velocity: 1, pan: 0, bowed: true, source: 'key' } as const;
const struck = { velocity: 1, pan: 0, bowed: false, source: 'composer' } as const;

const amplitudeAt = (instrument: Instrument, t: number) =>
  instrument.excitations(t)[0]?.amplitude ?? 0;

describe('Instrument', () => {
  it('strikes, then settles into a bowed sustain while held', () => {
    const instrument = new Instrument();
    instrument.noteOn(0, 7, held);
    expect(amplitudeAt(instrument, 0.03)).toBeGreaterThan(0.95);
    const sustain = amplitudeAt(instrument, 8);
    expect(sustain).toBeGreaterThan(0.8);
    expect(sustain).toBeLessThan(0.9);
  });

  it('fades after release and is then forgotten', () => {
    const instrument = new Instrument();
    const id = instrument.noteOn(0, 7, held);
    instrument.noteOff(2, id);
    expect(amplitudeAt(instrument, 2.5)).toBeLessThan(0.7);
    instrument.excitations(12);
    expect(instrument.soundingCount).toBe(0);
  });

  it('releases a timed note by itself', () => {
    const instrument = new Instrument();
    instrument.noteOn(0, 3, { ...held, holdFor: 1 });
    instrument.excitations(0.5);
    instrument.excitations(1.2);
    instrument.excitations(20);
    expect(instrument.soundingCount).toBe(0);
  });

  it('colors a sung note by the pitch actually sung', () => {
    const instrument = new Instrument();
    instrument.noteOn(0, 7, { ...held, source: 'voice', silent: true, pitchClass: 0 });
    const [voice] = instrument.excitations(0.1);
    expect(voice?.color[0]).toBeGreaterThan(voice?.color[2] ?? 1); // C is red
  });

  it('jolts on onsets and calms within a second', () => {
    const instrument = new Instrument();
    instrument.noteOn(0, 5, struck);
    expect(instrument.agitation(0.01)).toBeGreaterThan(0.9);
    expect(instrument.agitation(1)).toBe(0);
  });

  it('records what was played last', () => {
    const instrument = new Instrument();
    instrument.noteOn(0, 2, struck);
    instrument.noteOn(1, 9, held);
    expect(instrument.lastPlayed).toEqual({ degree: 9, source: 'key', at: 1 });
  });
});
