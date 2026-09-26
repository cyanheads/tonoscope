/**
 * @fileoverview The Listen-mode composer: deterministic under a seeded source, bar-shaped, in range.
 * @module tests/music/composer
 */

import { describe, expect, it } from 'vitest';
import { BAR_SECONDS, type ComposedNote, Composer, NOTE_COUNT } from '../../src/music/index.ts';

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function perform(composer: Composer, seconds: number): { at: number; note: ComposedNote }[] {
  const heard: { at: number; note: ComposedNote }[] = [];
  composer.reset(0);
  for (let t = 0; t <= seconds; t += 1 / 60) {
    for (const note of composer.update(t)) heard.push({ at: t, note });
  }
  return heard;
}

describe('Composer', () => {
  it('is deterministic for a given random source', () => {
    expect(perform(new Composer(seeded(3)), 20)).toEqual(perform(new Composer(seeded(3)), 20));
  });

  it('opens every bar with a held chord root', () => {
    const heard = perform(new Composer(seeded(11)), BAR_SECONDS * 4);
    const held = heard.filter((h) => h.note.hold > 0 && h.note.velocity === 0.8);
    expect(held.length).toBeGreaterThanOrEqual(4);
    for (let bar = 1; bar < held.length; bar += 1) {
      const gap = (held[bar]?.at ?? 0) - (held[bar - 1]?.at ?? 0);
      expect(gap).toBeCloseTo(BAR_SECONDS, 1);
    }
  });

  it('keeps every note inside the playable range', () => {
    for (const { note } of perform(new Composer(seeded(29)), 120)) {
      expect(note.degree).toBeGreaterThanOrEqual(0);
      expect(note.degree).toBeLessThan(NOTE_COUNT);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
    }
  });
});
