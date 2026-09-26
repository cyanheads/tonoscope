/**
 * @fileoverview Computer-keyboard and pointer layouts. Each letter row is an octave starting on D
 * (Z row = D3, A row = D4, Q row = D5), and the pointer maps left-to-right across the screen.
 * Keys are matched by physical position (KeyboardEvent.code), so the layout survives AZERTY etc.
 * @module instrument/key-map
 */

import { NOTE_COUNT } from '../music/index.ts';

const ROWS: readonly (readonly [start: number, codes: readonly string[]])[] = [
  [0, ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']],
  [
    7,
    ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ],
  [14, ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP']],
];

/** Physical key code → scale degree. */
export const KEY_DEGREES: ReadonlyMap<string, number> = new Map(
  ROWS.flatMap(([start, codes]) =>
    codes.map((code, i) => [code, start + i] as const).filter(([, degree]) => degree < NOTE_COUNT),
  ),
);

/** The letter printed under each figure: the first letter key (lowest row) that plays it. */
export function keyLabel(degree: number): string {
  for (const [, codes] of ROWS) {
    for (const code of codes) {
      if (code.startsWith('Key') && KEY_DEGREES.get(code) === degree) {
        return code.slice(3).toLowerCase();
      }
    }
  }
  return '';
}

export interface PitchRange {
  /** Lowest playable degree, inclusive. */
  readonly low: number;
  /** Highest playable degree, inclusive. */
  readonly high: number;
}

/** Narrow screens get two octaves so each column stays wide enough for a fingertip. */
export function pitchRangeFor(width: number): PitchRange {
  return width < 760 ? { low: 4, high: 18 } : { low: 0, high: NOTE_COUNT - 1 };
}

/** Degree under a horizontal position given as 0 (left edge) … 1 (right edge). */
export function degreeAtX(x: number, range: PitchRange): number {
  const span = range.high - range.low + 1;
  const column = Math.min(span - 1, Math.max(0, Math.floor(x * span)));
  return range.low + column;
}
