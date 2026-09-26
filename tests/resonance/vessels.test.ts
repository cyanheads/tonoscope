/**
 * @fileoverview The four vessels' mode sets: one per note, normalized, rising in complexity, and
 * obeying the boundary conditions and symmetries their physics implies.
 * @module tests/resonance/vessels
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { NOTE_COUNT } from '../../src/music/index.ts';
import {
  buildResonance,
  evaluateRawMode,
  type Resonance,
  tpms,
  VESSEL_KINDS,
  type Vessel,
} from '../../src/resonance/index.ts';

let resonance: Resonance;
const vessel = (kind: string): Vessel => {
  const found = resonance.vessels.find((v) => v.kind === kind);
  if (!found) throw new Error(`no ${kind}`);
  return found;
};

beforeAll(() => {
  resonance = buildResonance();
});

describe('buildResonance', () => {
  it('builds every vessel with one mode per playable note', () => {
    expect(resonance.vessels.map((v) => v.kind)).toEqual([...VESSEL_KINDS]);
    for (const v of resonance.vessels) {
      expect(v.modes).toHaveLength(NOTE_COUNT);
      for (const mode of v.modes) {
        expect(Number.isFinite(mode.p1[3])).toBe(true);
        expect(mode.p1[3]).toBeGreaterThan(0);
      }
    }
  });

  it('normalizes each mode to a peak of about one', () => {
    for (const v of resonance.vessels.filter((v) => v.kind !== 'lattice')) {
      for (const mode of v.modes) {
        let peak = 0;
        for (let i = 0; i < 400; i += 1) {
          const a = (i / 400) * Math.PI * 2;
          const r = ((i * 7) % 400) / 400;
          const point: [number, number, number] =
            v.kind === 'sphere'
              ? [
                  Math.cos(a) * Math.sqrt(1 - (r * 2 - 1) ** 2),
                  r * 2 - 1,
                  Math.sin(a) * Math.sqrt(1 - (r * 2 - 1) ** 2),
                ]
              : [Math.cos(a) * r, 0, Math.sin(a) * r];
          peak = Math.max(
            peak,
            Math.abs(evaluateRawMode(v.kind, mode, resonance.tables, ...point) * mode.p1[3]),
          );
        }
        expect(peak).toBeLessThan(1.05);
      }
    }
  });
});

describe('plate', () => {
  it('antisymmetric modes are still along the diagonal', () => {
    const plate = vessel('plate');
    const antisymmetric = plate.modes.filter((m) => m.p0[2] === -1);
    expect(antisymmetric.length).toBeGreaterThan(0);
    for (const mode of antisymmetric) {
      for (const t of [-0.8, -0.3, 0.1, 0.65]) {
        expect(evaluateRawMode('plate', mode, resonance.tables, t, 0, t)).toBeCloseTo(0, 10);
      }
    }
  });

  it('higher notes excite modes of higher wavenumber', () => {
    const plate = vessel('plate');
    const wavenumber = (i: number) => {
      const [n = 0, m = 0] = plate.modes[i]?.p0 ?? [];
      return n * n + m * m;
    };
    expect(wavenumber(NOTE_COUNT - 1)).toBeGreaterThan(wavenumber(0) * 10);
    for (let i = 1; i < NOTE_COUNT; i += 1)
      expect(wavenumber(i)).toBeGreaterThanOrEqual(wavenumber(i - 1));
  });
});

describe('drum', () => {
  it('is still at its clamped rim', () => {
    for (const mode of vessel('drum').modes) {
      for (const a of [0, 1.1, 2.9, 4.4]) {
        const value = evaluateRawMode('drum', mode, resonance.tables, Math.cos(a), 0, Math.sin(a));
        expect(Math.abs(value)).toBeLessThan(0.01);
      }
    }
  });
});

describe('sphere', () => {
  it('depends only on direction, not radius', () => {
    const mode = vessel('sphere').modes[9];
    if (!mode) throw new Error('missing sphere mode');
    const at = (s: number) =>
      evaluateRawMode('sphere', mode, resonance.tables, 0.3 * s, 0.5 * s, -0.81 * s);
    expect(at(1.4)).toBeCloseTo(at(1), 10);
  });
});

describe('tpms', () => {
  it('Schwarz P and the gyroid vanish where their surfaces pass', () => {
    expect(tpms(1, Math.PI / 2, Math.PI / 2, Math.PI / 2)).toBeCloseTo(0, 12);
    expect(tpms(0, 0, 0, 0)).toBeCloseTo(0, 12);
  });
});
