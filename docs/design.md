# Design

How Tonoscope turns a note into a figure, and why it is built the way it is.

## Frame flow

1. **Notes.** Pointer, keys, the Listen composer, or the Sing microphone start notes on the `Instrument` (`src/instrument/instrument.ts`). Each note drives a glass voice (`src/audio/glass-voice.ts`) and carries a visual envelope: a strike that decays into a bowed sustain while held.
2. **Slots.** Every frame the strongest eight notes are packed into uniform slots (`src/resonance/excitation.ts`): the vessel's mode parameters for that scale degree, the note's Scriabin color, and its amplitude.
3. **Simulation.** One compute invocation per grain (`src/gpu/shaders/simulate.wgsl`) sums the slots' standing waves at the grain, then:
   - launches grains off the surface with probability rising with |u| (sand thrown from the vibrating regions);
   - slides grounded grains toward the nearest nodal line with a damped Newton step, −u∇u/|∇u|², so settling speed does not depend on how fine the figure is;
   - on each note onset, adds a brief broadband jolt that throws grains everywhere, so the new mode sorts fresh sand rather than nudging the previous figure;
   - paints moving grains with the colors of the notes moving them.
4. **Render.** Grains draw as additive 1-pixel points into an rgba16float target with light trails, then a six-level bloom, a film-like tone curve, vignette, fringing and grain (`src/gpu/renderer.ts`, `src/gpu/shaders/*.wgsl`).

## Resonators

| Vessel | Field u | Mode choice per degree |
|:---|:---|:---|
| Plate | cos(nπX)cos(mπZ) ± cos(mπX)cos(nπZ) on the unit square | sorted by n² + m²; (0, m) grids only for the lowest notes |
| Drum | J_nA(kA r)cos(nA θ) + mix·J_nB(kB r)cos(nB θ + rot), k = Bessel zeros | near-degenerate pairs with nodal diameters, sorted by k |
| Sphere | P̄(l, m1)(θ)cos(m1 φ) + mix·P̄(l, m2)(θ)cos(m2 φ + rot) | l = degree + 2; four m-mixing patterns in rotation |
| Lattice | a triply periodic surface function at wavenumber k inside a ball | gyroid, Schwarz P and D, I-WP, Neovius, Fischer–Koch S; k rises with pitch |

`evaluateRawMode()` in `src/resonance/vessels.ts` and `modeValue()` in `simulate.wgsl` are the same functions in two languages. Bessel and Legendre values come from lookup tables built on the CPU at startup and uploaded once.

## Decisions

- **WebGPU only, no WebGL fallback.** The simulation needs compute shaders and storage buffers at millions of grains; a WebGL port would be a second renderer to maintain for a shrinking audience. Unsupported browsers get a clear message.
- **Points, not splats.** One-pixel additive points read as fine sand at 4 M grains and cost far less than atomic splatting; bloom supplies the glow.
- **Physics tuned for legibility over exactness.** Grains hop and slide like sand but also get a Newton-step pull and an onset jolt. Pure hop-diffusion left most of a new figure empty when a figure was already on the plate.
- **Higher pitch, finer figure.** Degree order is ascending mode frequency in every vessel, matching what Chladni and Jenny observed.
- **D Lydian across three octaves.** Any combination of notes in it sounds consonant enough for idle clicking; the raised fourth keeps it bright.
- **Scriabin's colors.** Each pitch class takes the hue Scriabin assigned it for *Prometheus*; the interface itself stays colorless so the notes supply all the color.
- **Everything synthesized.** Voices, reverb impulse and drone are generated at runtime; the app ships no audio files.
- **IM Fell type and treatise captions.** The interface reads like the plates of an eighteenth-century acoustics book (numbered figures, italic captions) so the only futuristic element is the figure itself.
