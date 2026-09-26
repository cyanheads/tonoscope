/**
 * @fileoverview Keyboard rows and pointer columns.
 * @module tests/instrument/key-map
 */

import { describe, expect, it } from 'vitest';
import { degreeAtX, KEY_DEGREES, keyLabel, pitchRangeFor } from '../../src/instrument/key-map.ts';
import { NOTE_COUNT, noteAt } from '../../src/music/index.ts';

describe('keyboard', () => {
  it('starts each letter row on D, an octave apart', () => {
    for (const [code, octave] of [
      ['KeyZ', 3],
      ['KeyA', 4],
      ['KeyQ', 5],
    ] as const) {
      const note = noteAt(KEY_DEGREES.get(code) ?? -1);
      expect(`${note.name}${note.octave}`).toBe(`D${octave}`);
    }
  });

  it('reaches every playable note and nothing beyond', () => {
    const degrees = new Set(KEY_DEGREES.values());
    for (let d = 0; d < NOTE_COUNT; d += 1) expect(degrees.has(d)).toBe(true);
    expect(Math.max(...degrees)).toBe(NOTE_COUNT - 1);
  });

  it('labels each figure with a letter key', () => {
    expect(keyLabel(0)).toBe('z');
    expect(keyLabel(7)).toBe('a');
    expect(keyLabel(21)).toBe('i');
    for (let d = 0; d < NOTE_COUNT; d += 1) expect(keyLabel(d)).toMatch(/^[a-z]$/);
  });
});

describe('pointer', () => {
  it('maps the screen edge to edge across the range', () => {
    const range = pitchRangeFor(1440);
    expect(degreeAtX(0, range)).toBe(0);
    expect(degreeAtX(0.9999, range)).toBe(NOTE_COUNT - 1);
    expect(degreeAtX(1.5, range)).toBe(NOTE_COUNT - 1);
  });

  it('narrows to two octaves on small screens', () => {
    const range = pitchRangeFor(390);
    expect(range.high - range.low).toBe(14);
    expect(degreeAtX(0, range)).toBe(range.low);
  });
});
