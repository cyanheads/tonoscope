/**
 * @fileoverview Pitch detection against synthetic voiced signals: sines, harmonic-rich tones with a
 * weak fundamental, vibrato, and noise.
 * @module tests/audio/pitch-detector
 */

import { describe, expect, it } from 'vitest';
import { detectPitch, rootMeanSquare } from '../../src/audio/pitch-detector.ts';

const RATE = 48000;

function tone(
  frequency: number,
  partials: readonly number[],
  length = 2048,
  vibrato = 0,
): Float32Array {
  const buffer = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i += 1) {
    const f = frequency * (1 + vibrato * Math.sin((2 * Math.PI * 5 * i) / RATE));
    phase += (2 * Math.PI * f) / RATE;
    buffer[i] = partials.reduce((sum, gain, k) => sum + gain * Math.sin((k + 1) * phase), 0) * 0.3;
  }
  return buffer;
}

function noise(length = 2048, seed = 7): Float32Array {
  let state = seed;
  return Float32Array.from({ length }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * 0.4;
  });
}

const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));

describe('detectPitch', () => {
  it.each([98, 146.83, 220, 440, 659.25, 987.77])('finds a pure %f Hz sine within 5 cents', (f) => {
    const reading = detectPitch(tone(f, [1]), RATE);
    expect(reading).not.toBeNull();
    expect(cents(reading?.frequency ?? 0, f)).toBeLessThan(5);
    expect(reading?.clarity).toBeGreaterThan(0.95);
  });

  it('reports the fundamental of a voice-like tone, not its louder second harmonic', () => {
    const reading = detectPitch(tone(196, [0.6, 1, 0.5, 0.3]), RATE);
    expect(cents(reading?.frequency ?? 0, 196)).toBeLessThan(10);
  });

  it('tracks a note sung with vibrato', () => {
    const reading = detectPitch(tone(220, [1, 0.5, 0.25], 2048, 0.006), RATE);
    expect(cents(reading?.frequency ?? 0, 220)).toBeLessThan(15);
  });

  it('rates white noise as unclear', () => {
    const reading = detectPitch(noise(), RATE);
    expect(reading === null || reading.clarity < 0.6).toBe(true);
  });
});

describe('rootMeanSquare', () => {
  it('is amplitude / √2 for a sine', () => {
    const buffer = Float32Array.from({ length: 4800 }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / RATE),
    );
    expect(rootMeanSquare(buffer)).toBeCloseTo(Math.SQRT1_2, 3);
  });
});
