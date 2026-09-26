/**
 * @fileoverview Monophonic pitch detection for the "Sing" mode — the McLeod Pitch Method
 * (normalized square difference function, first strong key maximum, parabolic refinement).
 * Pure function over a sample buffer so it can be tested without a microphone.
 * @module audio/pitch-detector
 */

export interface PitchReading {
  readonly frequency: number;
  /** NSDF peak height, 0–1: how periodic the signal is. Voices sit around 0.8–0.98. */
  readonly clarity: number;
}

export interface PitchOptions {
  readonly minFrequency?: number;
  readonly maxFrequency?: number;
  /** Fraction of the highest key maximum a candidate must reach to be chosen. */
  readonly threshold?: number;
}

export function rootMeanSquare(buffer: Float32Array): number {
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): PitchReading | null {
  const minFrequency = options.minFrequency ?? 65;
  const maxFrequency = options.maxFrequency ?? 1400;
  const threshold = options.threshold ?? 0.88;
  const n = buffer.length;
  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minFrequency));
  if (maxLag <= minLag) return null;

  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag += 1) {
    let acf = 0;
    let energy = 0;
    for (let i = 0; i < n - lag; i += 1) {
      const a = buffer[i] ?? 0;
      const b = buffer[i + lag] ?? 0;
      acf += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }

  const peaks: number[] = [];
  let lag = 1;
  while (lag < maxLag && (nsdf[lag] ?? 0) > 0) lag += 1;
  while (lag < maxLag) {
    while (lag < maxLag && (nsdf[lag] ?? 0) <= 0) lag += 1;
    let best = lag;
    while (lag < maxLag && (nsdf[lag] ?? 0) > 0) {
      if ((nsdf[lag] ?? 0) > (nsdf[best] ?? 0)) best = lag;
      lag += 1;
    }
    if (best >= minLag && best < maxLag) peaks.push(best);
  }
  if (peaks.length === 0) return null;

  const highest = Math.max(...peaks.map((p) => nsdf[p] ?? 0));
  const chosen = peaks.find((p) => (nsdf[p] ?? 0) >= threshold * highest);
  if (chosen === undefined) return null;

  const y0 = nsdf[chosen - 1] ?? 0;
  const y1 = nsdf[chosen] ?? 0;
  const y2 = nsdf[chosen + 1] ?? 0;
  const denominator = y0 - 2 * y1 + y2;
  const shift = denominator !== 0 ? (0.5 * (y0 - y2)) / denominator : 0;
  const period = chosen + shift;
  const clarity = y1 - 0.25 * (y0 - y2) * shift;
  return { frequency: sampleRate / period, clarity: Math.min(1, clarity) };
}
