/**
 * @fileoverview Voice stealing: which sounding voice gives way when one more would pass the cap.
 * @module tests/audio/audio-engine
 */

import { describe, expect, it } from 'vitest';
import { MAX_VOICES, voiceToSteal } from '../../src/audio/audio-engine.ts';

const voices = (released: readonly boolean[]) =>
  released.map((isReleased, id) => ({ id, released: isReleased }));

describe('voiceToSteal', () => {
  it('leaves every voice alone while there is room', () => {
    expect(voiceToSteal(voices(Array(MAX_VOICES - 1).fill(true)), MAX_VOICES)).toBeUndefined();
  });

  it('cuts the oldest released voice first', () => {
    expect(voiceToSteal(voices([false, false, true, true]), 4)?.id).toBe(2);
  });

  it('cuts the oldest voice when every one is held', () => {
    expect(voiceToSteal(voices([false, false, false]), 3)?.id).toBe(0);
  });

  it('keeps a held note through a long run without passing the cap', () => {
    const sustained = { released: false };
    const live = [sustained];
    let previous: { released: boolean } | null = null;
    for (let step = 0; step < 40; step += 1) {
      if (previous) previous.released = true;
      const stolen = voiceToSteal(live, MAX_VOICES);
      if (stolen) live.splice(live.indexOf(stolen), 1);
      previous = { released: false };
      live.push(previous);
      expect(live.length).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(live).toContain(sustained);
  });
});
