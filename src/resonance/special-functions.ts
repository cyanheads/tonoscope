/**
 * @fileoverview Special functions behind the drum and sphere vessels: Bessel functions of the first
 * kind (circular membrane modes) and fully normalized associated Legendre functions (spherical
 * harmonics). Evaluated on the CPU once at startup and baked into lookup tables for the GPU.
 * @module resonance/special-functions
 */

/**
 * J_n(x) by Bessel's integral, J_n(x) = (1/π) ∫₀^π cos(nτ − x sin τ) dτ. The integrand is smooth,
 * periodic and even, so the trapezoid rule converges exponentially once the sample count exceeds
 * roughly x + n.
 */
export function besselJ(n: number, x: number): number {
  const intervals = Math.max(64, Math.ceil(Math.abs(x) + n) * 2 + 32);
  const h = Math.PI / intervals;
  let sum = 0.5 * (Math.cos(0) + Math.cos(n * Math.PI));
  for (let k = 1; k < intervals; k += 1) {
    const tau = k * h;
    sum += Math.cos(n * tau - x * Math.sin(tau));
  }
  return (sum * h) / Math.PI;
}

/** First `count` positive zeros of J_n — the clamped-edge wavenumbers of a unit drum. */
export function besselJZeros(n: number, count: number): number[] {
  const zeros: number[] = [];
  const step = 0.05;
  let x0 = n === 0 ? 0.5 : n * 0.9 + 0.5;
  let f0 = besselJ(n, x0);
  while (zeros.length < count) {
    const x1 = x0 + step;
    const f1 = besselJ(n, x1);
    if (f0 === 0 || f0 * f1 < 0) {
      let lo = x0;
      let hi = x1;
      let flo = f0;
      for (let i = 0; i < 48; i += 1) {
        const mid = 0.5 * (lo + hi);
        const fm = besselJ(n, mid);
        if (flo * fm <= 0) {
          hi = mid;
        } else {
          lo = mid;
          flo = fm;
        }
      }
      zeros.push(0.5 * (lo + hi));
    }
    x0 = x1;
    f0 = f1;
  }
  return zeros;
}

/**
 * Fully normalized associated Legendre function P̄_l^m(x), x = cos θ, via the stable upward
 * recurrence (Numerical Recipes, 3rd ed., §6.7). Omits the 1/√(4π) factor; callers normalize
 * amplitude empirically anyway.
 */
export function legendreNormalized(l: number, m: number, x: number): number {
  if (m < 0 || m > l) throw new RangeError(`Legendre order m=${m} outside 0..${l}`);
  let pmm = 1;
  if (m > 0) {
    const omx2 = (1 - x) * (1 + x);
    let fact = 1;
    for (let i = 1; i <= m; i += 1) {
      pmm *= (omx2 * fact) / (fact + 1);
      fact += 2;
    }
  }
  pmm = Math.sqrt((2 * m + 1) * pmm);
  if (m & 1) pmm = -pmm;
  if (l === m) return pmm;

  let pmmp1 = x * Math.sqrt(2 * m + 3) * pmm;
  if (l === m + 1) return pmmp1;

  let oldFact = Math.sqrt(2 * m + 3);
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll += 1) {
    const fact = Math.sqrt((4 * ll * ll - 1) / (ll * ll - m * m));
    pll = (x * pmmp1 - pmm / oldFact) * fact;
    oldFact = fact;
    pmm = pmmp1;
    pmmp1 = pll;
  }
  return pll;
}
