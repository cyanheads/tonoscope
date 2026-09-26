/**
 * @fileoverview Packs the currently sounding notes into the fixed slot array the simulation reads.
 * A slot is three vec4s: mode p0, mode p1 (p1.w = normalization), and color.rgb + amplitude.
 * @module resonance/excitation
 */

import type { Rgb } from '../music/index.ts';
import type { Vessel } from './vessels.ts';

export interface Excitation {
  readonly degree: number;
  /** Visual drive, 0–1: how hard the vessel is ringing in this note's mode. */
  readonly amplitude: number;
  /** Linear-light color the particles this note moves are painted with. */
  readonly color: Rgb;
}

export const MAX_SLOTS = 8;
export const SLOT_FLOATS = 12;

/**
 * Write up to MAX_SLOTS excitations (strongest first) into `out` starting at `offset`.
 * Unused slots are zeroed. Returns the number of slots written.
 */
export function packSlots(
  vessel: Vessel,
  excitations: readonly Excitation[],
  out: Float32Array,
  offset: number,
): number {
  const strongest = [...excitations].sort((a, b) => b.amplitude - a.amplitude).slice(0, MAX_SLOTS);
  out.fill(0, offset, offset + MAX_SLOTS * SLOT_FLOATS);
  strongest.forEach((excitation, slot) => {
    const mode = vessel.modes[excitation.degree];
    if (!mode) throw new RangeError(`No ${vessel.kind} mode for degree ${excitation.degree}`);
    const base = offset + slot * SLOT_FLOATS;
    out.set(mode.p0, base);
    out.set(mode.p1, base + 4);
    out.set(excitation.color, base + 8);
    out[base + 11] = excitation.amplitude;
  });
  return strongest.length;
}
