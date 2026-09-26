/**
 * @fileoverview Note lifecycle shared by every way of playing (pointer, keys, the composer, the
 * voice). Each note drives a glass voice when audio is on, and always drives the vessel: its
 * visual envelope (a strike that decays into a bowed sustain while held) is what the grains feel.
 * @module instrument/instrument
 */

import type { AudioEngine, GlassVoice } from '../audio/index.ts';
import { noteAt, pitchClassLinear } from '../music/index.ts';
import type { Excitation } from '../resonance/index.ts';

export type NoteSource = 'pointer' | 'key' | 'composer' | 'voice';

export interface NoteOptions {
  readonly velocity: number;
  readonly pan: number;
  /** Held notes swell into a bowed sustain until released. */
  readonly bowed: boolean;
  readonly source: NoteSource;
  /** Seconds after which the note releases itself. */
  readonly holdFor?: number;
  /** Color by this pitch class instead of the degree's (a sung note between scale steps). */
  readonly pitchClass?: number;
  /** Visual only: no synthesized sound (the voice supplies its own). */
  readonly silent?: boolean;
}

interface Note {
  readonly id: number;
  readonly degree: number;
  readonly start: number;
  readonly options: NoteOptions;
  readonly voice: GlassVoice | null;
  releaseAt: number | null;
  autoReleaseAt: number | null;
}

export interface Played {
  readonly degree: number;
  readonly source: NoteSource;
  readonly at: number;
}

const STRIKE_DECAY = 1.5;
const ONSET_DECAY = 0.16;
const BOW_RISE = 0.3;
const BOW_FALL = 0.85;
const BOW_LEVEL = 0.85;

function strikeEnvelope(t: number): number {
  if (t < 0) return 0;
  return t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) / STRIKE_DECAY);
}

export class Instrument {
  private notes: Note[] = [];
  private nextId = 1;
  private audio: AudioEngine | null = null;
  private latest: Played | null = null;

  attachAudio(engine: AudioEngine | null): void {
    this.audio = engine;
  }

  get lastPlayed(): Played | null {
    return this.latest;
  }

  get soundingCount(): number {
    return this.notes.length;
  }

  noteOn(now: number, degree: number, options: NoteOptions): number {
    const note = noteAt(degree);
    const voice =
      this.audio && !options.silent
        ? this.audio.play({
            frequency: note.frequency,
            velocity: options.velocity,
            pan: options.pan,
            bowed: options.bowed,
          })
        : null;
    const id = this.nextId;
    this.nextId += 1;
    this.notes.push({
      id,
      degree,
      start: now,
      options,
      voice,
      releaseAt: options.bowed ? null : now,
      autoReleaseAt: options.holdFor !== undefined ? now + options.holdFor : null,
    });
    this.latest = { degree, source: options.source, at: now };
    return id;
  }

  noteOff(now: number, id: number): void {
    const note = this.notes.find((n) => n.id === id);
    if (!note || note.releaseAt !== null) return;
    note.releaseAt = now;
    note.voice?.release();
  }

  releaseAll(now: number, source?: NoteSource): void {
    for (const note of this.notes) {
      if (source === undefined || note.options.source === source) this.noteOff(now, note.id);
    }
  }

  /**
   * The broadband jolt of note onsets, 0–1. A strike excites every mode for an instant, so all the
   * grains leap — not just those on the new note's antinodes — and the sustained mode then sorts
   * them into its full figure instead of nudging the old one.
   */
  agitation(now: number): number {
    let total = 0;
    for (const note of this.notes) {
      const t = now - note.start;
      if (t >= 0 && t < 0.8) total += note.options.velocity ** 2 * Math.exp(-t / ONSET_DECAY);
    }
    return Math.min(1, total);
  }

  /** Visual drive of every sounding note at `now`; forgets notes that have fallen silent. */
  excitations(now: number): Excitation[] {
    for (const note of this.notes) {
      if (note.autoReleaseAt !== null && now >= note.autoReleaseAt) this.noteOff(now, note.id);
    }
    const result: Excitation[] = [];
    this.notes = this.notes.filter((note) => {
      const amplitude = this.amplitude(note, now);
      if (note.releaseAt !== null && amplitude < 0.004 && now - note.start > 0.1) {
        note.voice?.release();
        return false;
      }
      const pitchClass = note.options.pitchClass ?? noteAt(note.degree).pitchClass;
      result.push({ degree: note.degree, amplitude, color: pitchClassLinear(pitchClass) });
      return true;
    });
    return result;
  }

  private amplitude(note: Note, now: number): number {
    const t = now - note.start;
    const v = note.options.velocity;
    const strike = v * strikeEnvelope(t);
    let bow = 0;
    if (note.options.bowed) {
      const heldUntil = note.releaseAt ?? now;
      const held = Math.max(0, heldUntil - note.start);
      bow = v * BOW_LEVEL * (1 - Math.exp(-held / BOW_RISE));
      if (note.releaseAt !== null) bow *= Math.exp(-(now - note.releaseAt) / BOW_FALL);
    }
    return Math.min(1, strike + bow * (1 - strike));
  }
}
