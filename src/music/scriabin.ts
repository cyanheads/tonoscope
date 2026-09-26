/**
 * @fileoverview Pitch-class colors after Scriabin's "clavier à lumières" (Prometheus, 1910),
 * which walks the circle of fifths around the spectrum. Hues follow his scheme; values are
 * brightened so they read as emitted light on a dark field.
 * @module music/scriabin
 */

export type Rgb = readonly [number, number, number];

/** sRGB hex per pitch class, index 0 = C. */
export const SCRIABIN_HEX = [
  '#ff3b2a', // C   red
  '#b04dff', // C♯  violet
  '#ffe13a', // D   yellow
  '#8ea6d8', // D♯  steel
  '#a8e8ff', // E   pearly sky blue
  '#d0284f', // F   deep crimson
  '#3a78ff', // F♯  bright blue
  '#ff8f4a', // G   orange-rose
  '#c985ff', // G♯  lilac
  '#3fe38a', // A   green
  '#e08ea8', // A♯  rose-steel
  '#62b0ff', // B   blue
] as const;

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Linear-light color for a pitch class — what the particle shader accumulates. */
export function pitchClassLinear(pitchClass: number): Rgb {
  const hex = SCRIABIN_HEX[((pitchClass % 12) + 12) % 12] ?? '#ffffff';
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function pitchClassHex(pitchClass: number): string {
  return SCRIABIN_HEX[((pitchClass % 12) + 12) % 12] ?? '#ffffff';
}
