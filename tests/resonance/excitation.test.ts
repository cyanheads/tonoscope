/**
 * @fileoverview Slot packing: strongest notes first, capped, zero-filled, layout matching the shader.
 * @module tests/resonance/excitation
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildResonance,
  type Excitation,
  MAX_SLOTS,
  packSlots,
  SLOT_FLOATS,
  type Vessel,
} from '../../src/resonance/index.ts';

let plate: Vessel;
beforeAll(() => {
  const found = buildResonance().vessels[0];
  if (!found) throw new Error('no plate');
  plate = found;
});

const note = (degree: number, amplitude: number): Excitation => ({
  degree,
  amplitude,
  color: [degree / 30, 0.5, 1],
});

describe('packSlots', () => {
  it('writes mode, color and amplitude for each slot, strongest first', () => {
    const out = new Float32Array(MAX_SLOTS * SLOT_FLOATS).fill(9);
    const count = packSlots(plate, [note(3, 0.2), note(10, 0.9)], out, 0);
    expect(count).toBe(2);
    expect([...out.slice(0, 4)]).toEqual([...(plate.modes[10]?.p0 ?? [])]);
    expect(out[11]).toBeCloseTo(0.9);
    expect([...out.slice(SLOT_FLOATS, SLOT_FLOATS + 4)]).toEqual([...(plate.modes[3]?.p0 ?? [])]);
    expect(out.slice(2 * SLOT_FLOATS).every((v) => v === 0)).toBe(true);
  });

  it('keeps only the strongest MAX_SLOTS notes', () => {
    const out = new Float32Array(MAX_SLOTS * SLOT_FLOATS);
    const many = Array.from({ length: MAX_SLOTS + 4 }, (_, i) => note(i, (i + 1) / 20));
    expect(packSlots(plate, many, out, 0)).toBe(MAX_SLOTS);
    const amplitudes = Array.from({ length: MAX_SLOTS }, (_, s) => out[s * SLOT_FLOATS + 11] ?? 0);
    expect(Math.min(...amplitudes)).toBeCloseTo(5 / 20);
  });

  it('refuses a degree the vessel has no mode for', () => {
    expect(() =>
      packSlots(plate, [note(99, 1)], new Float32Array(MAX_SLOTS * SLOT_FLOATS), 0),
    ).toThrow(RangeError);
  });
});
