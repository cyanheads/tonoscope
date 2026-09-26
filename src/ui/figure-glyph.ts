/**
 * @fileoverview Draws a note's nodal lines as a small engraving-like mask — the plate of figures
 * along the bottom of the page. Uses the same mode math as the simulation, evaluated on the CPU.
 * @module ui/figure-glyph
 */

import { evaluateRawMode, type ModeSpec, type Vessel } from '../resonance/index.ts';

const TILT = 0.55;

/** World-space sample point for glyph pixel (u, v) ∈ [-1, 1]², or null outside the vessel. */
function project(vessel: Vessel, u: number, v: number): [number, number, number] | null {
  switch (vessel.kind) {
    case 'plate':
      return [u, 0, v];
    case 'drum':
    case 'lattice':
      return u * u + v * v > 1 ? null : [u, 0, v];
    case 'sphere': {
      const rr = u * u + v * v;
      if (rr > 1) return null;
      const w = Math.sqrt(1 - rr);
      const y = -v;
      const s = Math.sin(TILT);
      const c = Math.cos(TILT);
      return [u, y * c + w * s, -y * s + w * c];
    }
  }
}

/** Alpha-mask data URL of the figure; nodal lines opaque, the vessel outline faint. */
export function renderFigure(
  vessel: Vessel,
  mode: ModeSpec,
  tables: Float32Array,
  size: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for figure glyphs');
  const image = ctx.createImageData(size, size);

  const inset = 0.94;
  const field = new Float32Array((size + 1) * (size + 1)).fill(Number.NaN);
  for (let py = 0; py <= size; py += 1) {
    for (let px = 0; px <= size; px += 1) {
      const u = ((px / size) * 2 - 1) / inset;
      const v = ((py / size) * 2 - 1) / inset;
      const point = project(vessel, u, v);
      if (point) field[py * (size + 1) + px] = evaluateRawMode(vessel.kind, mode, tables, ...point);
    }
  }

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const f = field[py * (size + 1) + px] ?? Number.NaN;
      const fx = field[py * (size + 1) + px + 1] ?? Number.NaN;
      const fy = field[(py + 1) * (size + 1) + px] ?? Number.NaN;
      let alpha = 0;
      if (!Number.isNaN(f) && !Number.isNaN(fx) && !Number.isNaN(fy)) {
        const gradient = Math.hypot(fx - f, fy - f);
        const distance = Math.abs(f) / Math.max(gradient, 1e-6);
        alpha = Math.max(0, Math.min(1, 1.15 - distance * 0.9));
      }
      const u = (((px + 0.5) / size) * 2 - 1) / inset;
      const v = (((py + 0.5) / size) * 2 - 1) / inset;
      const edge =
        vessel.kind === 'plate' ? Math.min(1 - Math.abs(u), 1 - Math.abs(v)) : 1 - Math.hypot(u, v);
      const outline = Math.max(0, 1 - Math.abs(edge) * size * 0.5) * 0.45;
      image.data[(py * size + px) * 4 + 3] = Math.round(Math.max(alpha, outline) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
