/**
 * @fileoverview The four resonators and the standing-wave mode each scale degree excites in them.
 * Builds the special-function lookup tables the GPU samples (Bessel for the drum, Legendre for the
 * sphere) and packs every mode into two vec4s whose meaning per vessel is documented in
 * `src/gpu/shaders/simulate.wgsl`. Degree order is ascending frequency, so higher notes excite
 * more intricate figures, as on a real Chladni plate.
 * @module resonance/vessels
 */

import { NOTE_COUNT } from '../music/index.ts';
import { besselJ, besselJZeros, legendreNormalized } from './special-functions.ts';

export type Vec4 = readonly [number, number, number, number];

export const VESSEL_KINDS = ['plate', 'drum', 'sphere', 'lattice'] as const;
export type VesselKind = (typeof VESSEL_KINDS)[number];

/** Bessel table: orders 0..BESSEL_ORDERS-1, x sampled uniformly on [0, BESSEL_X_MAX]. */
export const BESSEL_ORDERS = 13;
export const BESSEL_SAMPLES = 2048;
export const BESSEL_X_MAX = 32;
/** Legendre tables: θ sampled uniformly on [0, π]. */
export const LEGENDRE_SAMPLES = 1024;

export const LATTICE_FAMILIES = [
  'gyroid',
  'Schwarz P',
  'Schwarz D',
  'I-WP',
  'Neovius',
  'Fischer–Koch S',
] as const;

export interface ModeSpec {
  /** First parameter block; meaning depends on the vessel (see simulate.wgsl). */
  readonly p0: Vec4;
  /** Second parameter block; p1[3] is always the amplitude normalization. */
  readonly p1: Vec4;
  /** Figure caption fragment, e.g. "the plate in its (3, 8) mode". */
  readonly description: string;
}

export interface Framing {
  /** Camera elevation in radians. */
  readonly pitch: number;
  readonly distance: number;
  /** World-space y the camera orbits around. */
  readonly height: number;
}

export interface Vessel {
  readonly kind: VesselKind;
  /** Enum value the shaders switch on. */
  readonly index: number;
  readonly name: string;
  readonly modes: readonly ModeSpec[];
  readonly framing: Framing;
  /** y of the mirror floor under a floating vessel; null draws no reflection. */
  readonly floorY: number | null;
}

export interface Resonance {
  /** Bessel region then Legendre region, uploaded once as a storage buffer. */
  readonly tables: Float32Array;
  readonly vessels: readonly Vessel[];
}

type Draft = Omit<ModeSpec, 'p1'> & { readonly p1: readonly [number, number, number] };

/** Linear interpolation into a table region — mirrors `lookup()` in simulate.wgsl. */
export function tableLookup(
  tables: Float32Array,
  base: number,
  samples: number,
  t: number,
): number {
  const x = Math.min(1, Math.max(0, t)) * (samples - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(i0 + 1, samples - 1);
  const f = x - i0;
  const a = tables[base + i0] ?? 0;
  const b = tables[base + i1] ?? 0;
  return a + (b - a) * f;
}

function plateModes(): Draft[] {
  const candidates: { n: number; m: number; s: number; f: number }[] = [];
  for (let n = 0; n <= 13; n += 1) {
    for (let m = n + 1; m <= 14; m += 1) {
      // Past the first few, (0, m) modes are plain square grids; the figures worth seeing mix both axes.
      if (n === 0 && m > 3) continue;
      for (const s of [-1, 1]) candidates.push({ n, m, s, f: n * n + m * m });
    }
  }
  candidates.sort((a, b) => a.f - b.f || a.s - b.s);
  return Array.from({ length: NOTE_COUNT }, (_, i) => {
    const index = Math.round((i / (NOTE_COUNT - 1)) ** 1.25 * 150) + 3;
    const c = candidates[index] ?? candidates[candidates.length - 1];
    if (!c) throw new Error('Plate mode table is empty');
    return {
      p0: [c.n, c.m, c.s, 0],
      p1: [0, 0, 0],
      description: `the plate in its (${c.n}, ${c.m}) mode`,
    };
  });
}

function drumModes(): Draft[] {
  const candidates: { n: number; s: number; k: number }[] = [];
  // Axisymmetric (n = 0) modes are bare rings and swamp any partner, so every mode has diameters.
  for (let n = 1; n <= 10; n += 1) {
    besselJZeros(n, 5).forEach((k, i) => {
      candidates.push({ n, s: i + 1, k });
    });
  }
  candidates.sort((a, b) => a.k - b.k);
  return Array.from({ length: NOTE_COUNT }, (_, i) => {
    const index = Math.round((i / (NOTE_COUNT - 1)) ** 1.15 * 38) + 1;
    const a = candidates[index];
    const b = candidates.slice(index + 1).find((c) => c.n !== a?.n && c.n > 0);
    if (!a || !b) throw new Error(`No drum mode pair for degree ${i}`);
    const mix = 0.55 + 0.15 * (i % 3);
    const rot = (i * 0.618 * Math.PI) % (2 * Math.PI);
    return {
      p0: [a.n, a.k, b.n, b.k],
      p1: [mix, rot, 0],
      description: `the drum in modes (${a.n}, ${a.s}) and (${b.n}, ${b.s})`,
    };
  });
}

function sphereModes(appendTable: (l: number, m: number) => number): Draft[] {
  return Array.from({ length: NOTE_COUNT }, (_, i) => {
    const l = i + 2;
    const patterns: [number, number, number][] = [
      [0, l, 0.8],
      [Math.floor(l / 2), l, 0.6],
      [l - 1, Math.min(2, l), 0.55],
      [Math.floor((2 * l) / 3), Math.floor(l / 3), 0.7],
    ];
    const [m1, m2, mix] = patterns[i % patterns.length] ?? [0, l, 0.8];
    const offset1 = appendTable(l, m1);
    const offset2 = appendTable(l, m2);
    return {
      p0: [m1, m2, mix, (i * 0.9) % (2 * Math.PI)],
      p1: [offset1, offset2, l],
      description: `the sphere ringing at degree ${l}`,
    };
  });
}

function latticeModes(): Draft[] {
  const order = [0, 1, 2, 3, 0, 4, 5, 2, 0, 3, 1, 5];
  return Array.from({ length: NOTE_COUNT }, (_, i) => {
    const family = order[i % order.length] ?? 0;
    const k = 3.3 + i * 0.27;
    const cells = (2 * k) / (2 * Math.PI);
    const name = LATTICE_FAMILIES[family] ?? 'gyroid';
    return {
      p0: [family, k, i % 2 === 0 ? 0 : Math.PI / 4, 0],
      p1: [(i * 0.91) % Math.PI, (i * 0.53) % (2 * Math.PI), 0],
      description: `a ${name} surface, ${cells.toFixed(1)} cells across`,
    };
  });
}

/**
 * Raw (unnormalized) mode value at a world-space point. Mirrors `mode*()` in simulate.wgsl —
 * change both together.
 */
export function evaluateRawMode(
  kind: VesselKind,
  mode: Pick<ModeSpec, 'p0' | 'p1'>,
  tables: Float32Array,
  x: number,
  y: number,
  z: number,
): number {
  const [a, b, c, d] = mode.p0;
  switch (kind) {
    case 'plate': {
      const X = (x + 1) * 0.5 * Math.PI;
      const Z = (z + 1) * 0.5 * Math.PI;
      return Math.cos(a * X) * Math.cos(b * Z) + c * Math.cos(b * X) * Math.cos(a * Z);
    }
    case 'drum': {
      const r = Math.hypot(x, z);
      const theta = Math.atan2(z, x);
      const j1 = tableLookup(tables, a * BESSEL_SAMPLES, BESSEL_SAMPLES, (b * r) / BESSEL_X_MAX);
      const j2 = tableLookup(tables, c * BESSEL_SAMPLES, BESSEL_SAMPLES, (d * r) / BESSEL_X_MAX);
      return j1 * Math.cos(a * theta) + mode.p1[0] * j2 * Math.cos(c * theta + mode.p1[1]);
    }
    case 'sphere': {
      const len = Math.hypot(x, y, z) || 1;
      const t = Math.acos(Math.min(1, Math.max(-1, y / len))) / Math.PI;
      const phi = Math.atan2(z, x);
      const p1 = tableLookup(tables, mode.p1[0], LEGENDRE_SAMPLES, t);
      const p2 = tableLookup(tables, mode.p1[1], LEGENDRE_SAMPLES, t);
      return p1 * Math.cos(a * phi) + c * p2 * Math.cos(b * phi + d);
    }
    case 'lattice': {
      const [ra, rb] = mode.p1;
      const ca = Math.cos(ra);
      const sa = Math.sin(ra);
      const y1 = y * ca - z * sa;
      const z1 = y * sa + z * ca;
      const cb = Math.cos(rb);
      const sb = Math.sin(rb);
      const x2 = x * cb + z1 * sb;
      const z2 = -x * sb + z1 * cb;
      return tpms(a, x2 * b + c, y1 * b + c, z2 * b + c);
    }
  }
}

/** Triply periodic minimal-surface level functions; the surface is where the value crosses 0. */
export function tpms(family: number, x: number, y: number, z: number): number {
  const cx = Math.cos(x);
  const cy = Math.cos(y);
  const cz = Math.cos(z);
  const sx = Math.sin(x);
  const sy = Math.sin(y);
  const sz = Math.sin(z);
  switch (family) {
    case 1:
      return cx + cy + cz;
    case 2:
      return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz;
    case 3:
      return (
        2 * (cx * cy + cy * cz + cz * cx) - (Math.cos(2 * x) + Math.cos(2 * y) + Math.cos(2 * z))
      );
    case 4:
      return 3 * (cx + cy + cz) + 4 * cx * cy * cz;
    case 5:
      return Math.cos(2 * x) * sy * cz + cx * Math.cos(2 * y) * sz + sx * cy * Math.cos(2 * z);
    default:
      return sx * cy + sy * cz + sz * cx;
  }
}

/**
 * Deterministic sample points on/in a vessel, used to measure each mode's peak amplitude. The grid
 * includes its end points: plate modes peak on the edges, where a cell-centred grid never looks.
 */
function samplePoints(kind: VesselKind): [number, number, number][] {
  const points: [number, number, number][] = [];
  const n = 97;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const u = i / (n - 1);
      const v = j / (n - 1);
      if (kind === 'plate') points.push([u * 2 - 1, 0, v * 2 - 1]);
      else if (kind === 'drum') {
        const r = Math.sqrt(u);
        points.push([r * Math.cos(v * 2 * Math.PI), 0, r * Math.sin(v * 2 * Math.PI)]);
      } else if (kind === 'sphere') {
        const y = u * 2 - 1;
        const s = Math.sqrt(1 - y * y);
        points.push([s * Math.cos(v * 2 * Math.PI), y, s * Math.sin(v * 2 * Math.PI)]);
      } else {
        for (let k = 0; k < 7; k += 1) {
          const y = k / 3 - 1;
          points.push([u * 2 - 1, y, v * 2 - 1]);
        }
      }
    }
  }
  return points;
}

function normalize(kind: VesselKind, drafts: Draft[], tables: Float32Array): ModeSpec[] {
  const points = samplePoints(kind);
  return drafts.map((draft) => {
    const probe = { p0: draft.p0, p1: [...draft.p1, 1] as const };
    let peak = 0;
    for (const [x, y, z] of points) {
      peak = Math.max(peak, Math.abs(evaluateRawMode(kind, probe, tables, x, y, z)));
    }
    return { ...draft, p1: [draft.p1[0], draft.p1[1], draft.p1[2], peak > 0 ? 1 / peak : 1] };
  });
}

/** Build every vessel's mode set and the lookup tables they sample. Runs once at startup. */
export function buildResonance(): Resonance {
  const legendre: number[] = [];
  const legendreBase = BESSEL_ORDERS * BESSEL_SAMPLES;
  const legendreIndex = new Map<string, number>();
  const appendLegendre = (l: number, m: number): number => {
    const key = `${l}:${m}`;
    const existing = legendreIndex.get(key);
    if (existing !== undefined) return existing;
    const offset = legendreBase + legendre.length;
    for (let i = 0; i < LEGENDRE_SAMPLES; i += 1) {
      const theta = (i / (LEGENDRE_SAMPLES - 1)) * Math.PI;
      legendre.push(legendreNormalized(l, m, Math.cos(theta)));
    }
    legendreIndex.set(key, offset);
    return offset;
  };

  const sphereDrafts = sphereModes(appendLegendre);
  const tables = new Float32Array(legendreBase + legendre.length);
  for (let n = 0; n < BESSEL_ORDERS; n += 1) {
    for (let i = 0; i < BESSEL_SAMPLES; i += 1) {
      tables[n * BESSEL_SAMPLES + i] = besselJ(n, (i / (BESSEL_SAMPLES - 1)) * BESSEL_X_MAX);
    }
  }
  tables.set(legendre, legendreBase);

  const vessels: Vessel[] = [
    {
      kind: 'plate',
      index: 0,
      name: 'Plate',
      modes: normalize('plate', plateModes(), tables),
      framing: { pitch: 0.92, distance: 5.4, height: -0.16 },
      floorY: null,
    },
    {
      kind: 'drum',
      index: 1,
      name: 'Drum',
      modes: normalize('drum', drumModes(), tables),
      framing: { pitch: 0.98, distance: 5.0, height: -0.14 },
      floorY: null,
    },
    {
      kind: 'sphere',
      index: 2,
      name: 'Sphere',
      modes: normalize('sphere', sphereDrafts, tables),
      framing: { pitch: 0.24, distance: 5.5, height: -0.3 },
      floorY: -1.42,
    },
    {
      kind: 'lattice',
      index: 3,
      name: 'Lattice',
      modes: normalize('lattice', latticeModes(), tables),
      framing: { pitch: 0.3, distance: 5.5, height: -0.3 },
      floorY: -1.42,
    },
  ];
  return { tables, vessels };
}
