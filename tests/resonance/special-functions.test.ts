/**
 * @fileoverview Bessel and Legendre functions against published values and identities.
 * @module tests/resonance/special-functions
 */

import { describe, expect, it } from 'vitest';
import { besselJ, besselJZeros, legendreNormalized } from '../../src/resonance/index.ts';

describe('besselJ', () => {
  it('matches tabulated values', () => {
    expect(besselJ(0, 0)).toBeCloseTo(1, 10);
    expect(besselJ(1, 0)).toBeCloseTo(0, 10);
    expect(besselJ(0, 1)).toBeCloseTo(0.7651976866, 8);
    expect(besselJ(1, 2.5)).toBeCloseTo(0.4970941025, 8);
    expect(besselJ(5, 10)).toBeCloseTo(-0.2340615282, 8);
  });

  it('satisfies the recurrence J(n-1) + J(n+1) = (2n/x) J(n)', () => {
    const x = 7.3;
    for (let n = 1; n < 10; n += 1) {
      expect(besselJ(n - 1, x) + besselJ(n + 1, x)).toBeCloseTo(((2 * n) / x) * besselJ(n, x), 8);
    }
  });
});

describe('besselJZeros', () => {
  it('finds the known clamped-drum wavenumbers', () => {
    const [j01, j02] = besselJZeros(0, 2);
    const [j11] = besselJZeros(1, 1);
    const [j21] = besselJZeros(2, 1);
    expect(j01).toBeCloseTo(2.404825558, 6);
    expect(j02).toBeCloseTo(5.52007811, 6);
    expect(j11).toBeCloseTo(3.83170597, 6);
    expect(j21).toBeCloseTo(5.135622302, 6);
  });
});

describe('legendreNormalized', () => {
  it('matches closed forms (without the 1/√4π factor)', () => {
    const x = 0.37;
    expect(legendreNormalized(0, 0, x)).toBeCloseTo(1, 12);
    expect(legendreNormalized(1, 0, x)).toBeCloseTo(Math.sqrt(3) * x, 12);
    expect(legendreNormalized(2, 0, x)).toBeCloseTo((Math.sqrt(5) * (3 * x * x - 1)) / 2, 12);
    expect(legendreNormalized(1, 1, x)).toBeCloseTo(-Math.sqrt(1.5) * Math.sqrt(1 - x * x), 12);
  });

  it('is orthogonal, with ∫P̄² dx = 2 (the harmonic is orthonormal once divided by √4π)', () => {
    const integrate = (f: (x: number) => number) => {
      const n = 4000;
      let sum = 0;
      for (let i = 0; i < n; i += 1) sum += f(-1 + ((i + 0.5) * 2) / n);
      return (sum * 2) / n;
    };
    expect(integrate((x) => legendreNormalized(6, 2, x) ** 2)).toBeCloseTo(2, 3);
    expect(integrate((x) => legendreNormalized(6, 2, x) * legendreNormalized(8, 2, x))).toBeCloseTo(
      0,
      4,
    );
  });

  it('rejects an order above the degree', () => {
    expect(() => legendreNormalized(2, 3, 0.1)).toThrow(RangeError);
  });
});
