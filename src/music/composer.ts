/**
 * @fileoverview Generative autopilot for "Listen" mode — a slow Lydian progression where each bar
 * holds a bowed chord root (the figure you watch form) and scatters struck chord tones above it.
 * Deterministic for a given random source.
 * @module music/composer
 */

import { NOTE_COUNT } from './scale.ts';

export interface ComposedNote {
  readonly degree: number;
  /** 0–1. */
  readonly velocity: number;
  /** Seconds the note is held (bowed). 0 means a single strike. */
  readonly hold: number;
  /** Stereo position, -1 (left) to 1 (right). */
  readonly pan: number;
}

interface Scheduled {
  readonly at: number;
  readonly note: ComposedNote;
}

/** Chord roots as scale degrees: I II vi I iii II V I in D Lydian. */
const PROGRESSION = [0, 1, 5, 0, 2, 1, 4, 0] as const;

/** Seconds per bar. */
export const BAR_SECONDS = 6.4;

const MELODY_SLOTS = [0.9, 1.6, 2.5, 3.3, 4.2, 5.0, 5.7] as const;

/** Seconds from a (re)start to the next bar. */
const LEAD_IN = 0.35;

/**
 * A longer pause between updates (a hidden tab, a stalled page) skips ahead: the missed notes are
 * dropped and a fresh bar begins, instead of every missed bar sounding in one frame.
 */
const MAX_GAP = 1;

export class Composer {
  private nextBarAt = 0;
  private barIndex = 0;
  private lastUpdate = 0;
  private queue: Scheduled[] = [];
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** Restart the piece so its first bar begins shortly after `now`. */
  reset(now: number): void {
    this.barIndex = 0;
    this.restartAt(now);
  }

  /** Notes whose start time has arrived, in start order. */
  update(now: number): ComposedNote[] {
    if (now - this.lastUpdate > MAX_GAP) this.restartAt(now);
    this.lastUpdate = now;
    while (now >= this.nextBarAt) {
      this.scheduleBar(this.nextBarAt);
      this.nextBarAt += BAR_SECONDS;
    }
    const due: ComposedNote[] = [];
    this.queue = this.queue.filter((event) => {
      if (event.at > now) return true;
      due.push(event.note);
      return false;
    });
    return due;
  }

  /** Drop whatever is queued and begin the next bar shortly after `now`, keeping the progression. */
  private restartAt(now: number): void {
    this.nextBarAt = now + LEAD_IN;
    this.lastUpdate = now;
    this.queue = [];
  }

  private scheduleBar(start: number): void {
    const root = PROGRESSION[this.barIndex % PROGRESSION.length] ?? 0;
    this.barIndex += 1;
    const chord = [root, root + 2, root + 4, root + 6];
    const clampDegree = (d: number) => Math.min(NOTE_COUNT - 1, Math.max(0, d));

    this.queue.push({
      at: start,
      note: { degree: clampDegree(root + 7), velocity: 0.8, hold: BAR_SECONDS - 1.1, pan: 0 },
    });

    const strikes = 2 + Math.floor(this.random() * 3);
    const slots = [...MELODY_SLOTS].sort(() => this.random() - 0.5).slice(0, strikes);
    for (const offset of slots) {
      const tone = chord[Math.floor(this.random() * chord.length)] ?? root;
      const octave = this.random() < 0.7 ? 14 : 7;
      this.queue.push({
        at: start + offset + this.random() * 0.12,
        note: {
          degree: clampDegree(tone + octave),
          velocity: 0.35 + this.random() * 0.35,
          hold: 0,
          pan: this.random() * 1.4 - 0.7,
        },
      });
    }

    if (this.random() < 0.3) {
      this.queue.push({
        at: start + 3.1,
        note: {
          degree: clampDegree(root + 16),
          velocity: 0.45,
          hold: 2.4,
          pan: this.random() * 0.8 - 0.4,
        },
      });
    }
    this.queue.sort((a, b) => a.at - b.at);
  }
}
