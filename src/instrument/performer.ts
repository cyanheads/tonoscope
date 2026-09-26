/**
 * @fileoverview Turns hands into notes and camera moves. Pointer: press to play the column under it
 * (hold to sustain, drag for a run); any movement stirs the grains. Right-drag or two fingers turn
 * the view; wheel or pinch zooms. Keyboard: letter rows play three octaves.
 * @module instrument/performer
 */

import type { OrbitCamera } from '../view/index.ts';
import type { Instrument } from './instrument.ts';
import { degreeAtX, KEY_DEGREES, type PitchRange } from './key-map.ts';

export interface PerformerHooks {
  /** Performance clock in seconds. */
  readonly now: () => number;
  readonly range: () => PitchRange;
  /** Whether the player has begun; until then the title page is up and the keys play nothing. */
  readonly started: () => boolean;
  /** Called on every note the player starts (not the composer or voice). */
  readonly onPlay: () => void;
}

interface Press {
  noteId: number | null;
  degree: number;
  x: number;
  y: number;
  /** Took part in a pinch: turns and zooms only, and plays nothing until it lifts. */
  pinched: boolean;
}

/**
 * Wheel deltas in lines (Firefox's mouse wheel, usually 3 a notch) become pixels at this height, so
 * a notch zooms about as far as the ~100 px other browsers report.
 */
const WHEEL_LINE_PX = 40;

export interface Stir {
  /** Pointer position in normalized device coordinates (-1..1, y up). */
  readonly ndcX: number;
  readonly ndcY: number;
  /** Seconds since the pointer last moved over the stage. */
  readonly idle: number;
}

export class Performer {
  private readonly presses = new Map<number, Press>();
  private readonly keys = new Map<string, number>();
  private orbiting: { x: number; y: number } | null = null;
  private pinch: { distance: number; x: number; y: number } | null = null;
  private stirState = { ndcX: 0, ndcY: 0, movedAt: Number.NEGATIVE_INFINITY };
  private readonly stage: HTMLCanvasElement;
  private readonly instrument: Instrument;
  private readonly camera: OrbitCamera;
  private readonly hooks: PerformerHooks;

  constructor(
    stage: HTMLCanvasElement,
    instrument: Instrument,
    camera: OrbitCamera,
    hooks: PerformerHooks,
  ) {
    this.stage = stage;
    this.instrument = instrument;
    this.camera = camera;
    this.hooks = hooks;
    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('pointermove', this.onPointerMove);
    stage.addEventListener('pointerup', this.onPointerUp);
    stage.addEventListener('pointercancel', this.onPointerUp);
    stage.addEventListener('lostpointercapture', this.onPointerUp);
    stage.addEventListener('wheel', this.onWheel, { passive: false });
    stage.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseEverything);
  }

  get stir(): Stir {
    return {
      ndcX: this.stirState.ndcX,
      ndcY: this.stirState.ndcY,
      idle: this.hooks.now() - this.stirState.movedAt,
    };
  }

  /** Play one note programmatically (the figure strip), held for a moment. */
  tap(degree: number): void {
    const now = this.hooks.now();
    this.instrument.noteOn(now, degree, {
      velocity: 0.8,
      pan: 0,
      bowed: true,
      source: 'pointer',
      holdFor: 0.45,
    });
    this.hooks.onPlay();
  }

  private readonly releaseEverything = (): void => {
    const now = this.hooks.now();
    for (const id of this.keys.values()) this.instrument.noteOff(now, id);
    this.keys.clear();
    for (const press of this.presses.values()) {
      if (press.noteId !== null) this.instrument.noteOff(now, press.noteId);
    }
    this.presses.clear();
    this.orbiting = null;
    this.pinch = null;
  };

  private strike(press: Press, velocityScale: number): void {
    const rect = this.stage.getBoundingClientRect();
    const x = (press.x - rect.left) / rect.width;
    const y = (press.y - rect.top) / rect.height;
    press.degree = degreeAtX(x, this.hooks.range());
    press.noteId = this.instrument.noteOn(this.hooks.now(), press.degree, {
      velocity: (0.45 + 0.55 * (1 - y)) * velocityScale,
      pan: (x * 2 - 1) * 0.7,
      bowed: true,
      source: 'pointer',
    });
    this.hooks.onPlay();
  }

  private trackStir(event: PointerEvent): void {
    const rect = this.stage.getBoundingClientRect();
    this.stirState = {
      ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ndcY: 1 - ((event.clientY - rect.top) / rect.height) * 2,
      movedAt: this.hooks.now(),
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.stage.setPointerCapture(event.pointerId);
    this.trackStir(event);
    if (event.button === 2 || event.shiftKey || event.ctrlKey) {
      this.orbiting = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    const press: Press = {
      noteId: null,
      degree: -1,
      x: event.clientX,
      y: event.clientY,
      pinched: this.pinch !== null,
    };
    this.presses.set(event.pointerId, press);

    if (event.pointerType === 'touch' && this.presses.size === 2) {
      const now = this.hooks.now();
      for (const p of this.presses.values()) {
        if (p.noteId !== null) this.instrument.noteOff(now, p.noteId);
        p.noteId = null;
        p.pinched = true;
      }
      const [a, b] = [...this.presses.values()];
      if (a && b) {
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        };
      }
      return;
    }
    if (!press.pinched) this.strike(press, 1);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.trackStir(event);
    if (this.orbiting) {
      const dx = event.clientX - this.orbiting.x;
      const dy = event.clientY - this.orbiting.y;
      this.orbiting = { x: event.clientX, y: event.clientY };
      this.camera.orbit(-dx * 0.006, dy * 0.005);
      return;
    }
    const press = this.presses.get(event.pointerId);
    if (!press) return;
    press.x = event.clientX;
    press.y = event.clientY;

    if (this.pinch) {
      const [a, b] = [...this.presses.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      this.camera.zoom(this.pinch.distance / Math.max(distance, 1));
      this.camera.orbit(-(x - this.pinch.x) * 0.006, (y - this.pinch.y) * 0.005);
      this.pinch = { distance, x, y };
      return;
    }
    if (press.pinched) return;

    const rect = this.stage.getBoundingClientRect();
    const degree = degreeAtX((event.clientX - rect.left) / rect.width, this.hooks.range());
    if (degree !== press.degree) {
      if (press.noteId !== null) this.instrument.noteOff(this.hooks.now(), press.noteId);
      this.strike(press, 0.8);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.orbiting = null;
    const press = this.presses.get(event.pointerId);
    if (!press) return;
    if (press.noteId !== null) this.instrument.noteOff(this.hooks.now(), press.noteId);
    this.presses.delete(event.pointerId);
    if (this.presses.size < 2) this.pinch = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const pixels =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * this.stage.clientHeight
          : event.deltaY;
    /**
     * A trackpad pinch arrives as Ctrl-wheel events of a few pixels each: follow the fingers
     * closely, but cap each step so Ctrl with a mouse wheel does not leap.
     */
    const rate = event.ctrlKey ? 0.01 : 0.0012;
    this.camera.zoom(Math.exp(Math.min(0.25, Math.max(-0.25, pixels * rate))));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.hooks.started() || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const degree = KEY_DEGREES.get(event.code);
    if (degree === undefined || this.keys.has(event.code)) return;
    if (event.target instanceof HTMLElement && event.target.closest('.about')) return;
    event.preventDefault();
    const id = this.instrument.noteOn(this.hooks.now(), degree, {
      velocity: 0.78,
      pan: ((degree % 7) / 6 - 0.5) * 0.8,
      bowed: true,
      source: 'key',
    });
    this.keys.set(event.code, id);
    this.hooks.onPlay();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const id = this.keys.get(event.code);
    if (id === undefined) return;
    this.instrument.noteOff(this.hooks.now(), id);
    this.keys.delete(event.code);
  };
}
