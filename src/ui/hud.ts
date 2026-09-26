/**
 * @fileoverview The page around the figure: title page, masthead controls, the running figure
 * caption, resonator switch, the strip of note figures, hints, and the about panel. Owns the DOM;
 * knows nothing about audio or the GPU.
 * @module ui/hud
 */

import { keyLabel, type PitchRange } from '../instrument/index.ts';
import type { Vessel } from '../resonance/index.ts';
import { renderFigure } from './figure-glyph.ts';

export type Way = 'play' | 'listen' | 'sing';

export interface HudHandlers {
  readonly onBegin: (withSound: boolean) => void;
  readonly onWay: (way: Way) => void;
  readonly onVessel: (index: number) => void;
  readonly onSound: () => void;
  readonly onCapture: () => void;
  readonly onFigure: (degree: number) => void;
}

export interface CaptionParts {
  readonly figure: number;
  readonly pitch: string;
  readonly text: string;
}

export interface FigureState {
  readonly degree: number;
  readonly amplitude: number;
  readonly hex: string;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector} in index.html`);
  return element;
}

export class Hud {
  private readonly body = document.body;
  private readonly figures = required<HTMLOListElement>(document, '.figures');
  private readonly figNumber = required<HTMLSpanElement>(document, '.fig-number');
  private readonly figText = required<HTMLSpanElement>(document, '.fig-text');
  private readonly hint = required<HTMLParagraphElement>(document, '.hint');
  private readonly about = required<HTMLElement>(document, '.about');
  private readonly glyphCache = new Map<string, string>();
  private figureButtons = new Map<number, HTMLButtonElement>();
  private hintTimer = 0;
  private stripKey = '';
  private readonly handlers: HudHandlers;

  constructor(handlers: HudHandlers) {
    this.handlers = handlers;
    document.addEventListener('click', this.onClick);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.toggleAbout(false);
    });
  }

  setStarted(): void {
    this.body.classList.add('started');
  }

  get aboutOpen(): boolean {
    return !this.about.hidden;
  }

  toggleAbout(force?: boolean): void {
    const open = force ?? this.about.hidden;
    this.about.hidden = !open;
    if (open) required<HTMLButtonElement>(this.about, '.close').focus();
  }

  setWay(way: Way): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-way]')) {
      button.setAttribute('aria-pressed', String(button.dataset.way === way));
    }
  }

  setVessel(index: number): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-vessel]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.vessel) === index));
    }
  }

  setSound(on: boolean): void {
    const button = required<HTMLButtonElement>(document, '[data-action="sound"]');
    button.setAttribute('aria-pressed', String(!on));
    button.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  }

  setNoteColor(hex: string): void {
    document.documentElement.style.setProperty('--note', hex);
  }

  setCaption(parts: CaptionParts | null): void {
    if (!parts) {
      this.figNumber.textContent = '';
      this.figText.replaceChildren();
      return;
    }
    this.figNumber.textContent = `Fig. ${parts.figure}.`;
    const pitch = document.createElement('span');
    pitch.className = 'pitch';
    pitch.textContent = parts.pitch;
    this.figText.replaceChildren(pitch, document.createTextNode(`: ${parts.text}.`));
  }

  /** Rebuild the figure strip when the vessel or the playable range changes. */
  showFigures(vessel: Vessel, tables: Float32Array, range: PitchRange): void {
    const key = `${vessel.index}:${range.low}-${range.high}`;
    if (key === this.stripKey) return;
    this.stripKey = key;
    const size = Math.round(40 * Math.min(2, window.devicePixelRatio || 1));
    this.figureButtons = new Map();
    const items: HTMLLIElement[] = [];
    for (let degree = range.low; degree <= range.high; degree += 1) {
      const mode = vessel.modes[degree];
      if (!mode) continue;
      const cacheKey = `${vessel.index}:${degree}:${size}`;
      let url = this.glyphCache.get(cacheKey);
      if (!url) {
        url = renderFigure(vessel, mode, tables, size);
        this.glyphCache.set(cacheKey, url);
      }
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'figure';
      button.dataset.degree = String(degree);
      button.setAttribute('aria-label', `Play figure ${degree + 1}`);
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.style.maskImage = `url(${url})`;
      glyph.style.setProperty('-webkit-mask-image', `url(${url})`);
      const label = document.createElement('span');
      label.className = 'key';
      label.textContent = keyLabel(degree);
      button.append(glyph, label);
      li.append(button);
      items.push(li);
      this.figureButtons.set(degree, button);
    }
    this.figures.replaceChildren(...items);
  }

  /** Light the figures of sounding notes in their colors. */
  updateFigures(sounding: readonly FigureState[], latest: number | null): void {
    const lit = new Map(sounding.filter((s) => s.amplitude > 0.06).map((s) => [s.degree, s]));
    for (const [degree, button] of this.figureButtons) {
      const state = lit.get(degree);
      button.classList.toggle('sounding', state !== undefined);
      button.classList.toggle('latest', degree === latest);
      if (state) button.style.setProperty('--tone', state.hex);
    }
  }

  showHint(text: string, seconds: number): void {
    window.clearTimeout(this.hintTimer);
    this.hint.textContent = text;
    this.hint.hidden = false;
    this.hint.classList.remove('fading');
    this.hintTimer = window.setTimeout(() => this.clearHint(), seconds * 1000);
  }

  clearHint(): void {
    if (this.hint.hidden) return;
    this.hint.classList.add('fading');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hint.hidden = true;
    }, 1000);
  }

  showUnsupported(reason: string): void {
    required<HTMLElement>(document, '.title-page').hidden = true;
    const panel = required<HTMLElement>(document, '.unsupported');
    required<HTMLElement>(panel, '[data-slot="reason"]').textContent = reason;
    panel.hidden = false;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>(
      '[data-action], [data-way], [data-vessel], [data-degree]',
    );
    if (!control) return;
    const { action, way, vessel, degree } = control.dataset;
    if (action) event.preventDefault();
    switch (action) {
      case 'begin-sound':
        this.handlers.onBegin(true);
        return;
      case 'begin-silent':
        this.handlers.onBegin(false);
        return;
      case 'sound':
        this.handlers.onSound();
        return;
      case 'capture':
        this.handlers.onCapture();
        return;
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        return;
      case 'about':
        this.toggleAbout();
        return;
    }
    if (way === 'play' || way === 'listen' || way === 'sing') this.handlers.onWay(way);
    else if (vessel !== undefined) this.handlers.onVessel(Number(vessel));
    else if (degree !== undefined) this.handlers.onFigure(Number(degree));
  };
}
