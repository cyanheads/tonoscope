# tonoscope

A browser instrument that makes sound visible: each note excites a standing-wave mode of one of four resonators (plate, drum, sphere, lattice), and ~4 M WebGPU grains settle into its figure while a synthesized glass voice rings. Static Vite + TypeScript site, no backend, live at https://tonoscope.caseyjhand.com (Cloudflare Workers static assets).

**Orientation:** this file is the behavioral layer; `README.md` has the surface and structure, `docs/design.md` the physics, frame flow and recorded decisions.

## Stack & gate

Bun, Vite 8, TypeScript 7 (strict, `erasableSyntaxOnly` — no parameter properties or enums), raw WebGPU + WGSL (no three.js), Web Audio, Biome, Vitest. Font: `@fontsource/im-fell-english`.

**Gate: `bun run check`** (typecheck + `biome check` + Vitest + changelog sync). Biome warnings count as failures. Tests cover the pure logic (scale, composer, pitch detection, special functions, mode math, slot packing, note envelopes); GPU and DOM code is verified visually with `bun run snapshot`.

## Running it

| Mode | Command | Notes |
|:---|:---|:---|
| Dev | `bun run dev` | http://127.0.0.1:5199, hot reload (WGSL edits reload too) |
| Build | `bun run build` → `dist/` | Fully static; deployable anywhere |
| Deploy | `bun run deploy` | Gate, build, then `wrangler deploy` of `dist/` as an assets-only Worker on the `tonoscope.caseyjhand.com` custom domain (`wrangler.jsonc`). Uses `CLOUDFLARE_API_TOKEN` from the shell; the token needs Account → Workers Scripts: Edit |
| Prod-like local | `bunx wrangler dev --port 8799` | Serves `dist/` with `public/_headers` applied — the way to test CSP changes before deploying |
| Stills | `bun run snapshot [--scenes "0:9,2:14+17"] [--width 390 --height 844] [--about]` | Headless Chrome with WebGPU over CDP; dev server must be running; writes `stills/` |

Debug handle in the page: `window.tonoscope` (`particles.sample(n)` reads grains back from the GPU, `instrument.noteOn(...)`, `setVessel(i)`, `vessels`, `tables`, `evaluateRawMode`). GPU validation errors log as `[tonoscope] GPU error:`.

## Architecture

Input or composer → `Instrument` notes → `packSlots` (≤ 8 slots) → `simulate.wgsl` (one invocation per grain) → `renderer.ts` (points → HDR trails → bloom → composite) → canvas. `src/main.ts` wires it and runs the loop.

| Path | Role |
|:---|:---|
| `src/resonance/vessels.ts` | Mode selection per degree, Bessel/Legendre tables, CPU `evaluateRawMode`, camera framing |
| `src/gpu/shaders/simulate.wgsl` | Grain physics: hop, Newton slide, onset jolt, stir, morph between vessels, painting |
| `src/gpu/particle-system.ts` | Grain buffers, sim uniform packing, WGSL constant header |
| `src/gpu/renderer.ts` | Render/bloom/composite pipelines, `Look` defaults |
| `src/instrument/instrument.ts` | Note envelopes (visual), onset agitation, audio voice ownership |
| `src/audio/` | `AudioEngine` (bus, reverb, delay, drone), `GlassVoice`, `Microphone`, `detectPitch` |
| `src/ui/hud.ts` | All DOM: title page, captions, figure strip, vessel/way buttons, about |

## The rules that matter

- **Mode math lives in two places** — `evaluateRawMode()` (TS) and `modeValue()` (WGSL) must stay identical, including parameter meanings documented at the top of `simulate.wgsl`. The figure strip and tests use the TS copy; the grains use the WGSL copy.
- **Uniform layouts are hand-packed.** `SimParams` offsets in `particle-system.ts#encode` and `View`/`Composite` in `renderer.ts` must match the WGSL structs field for field (vec4 granularity).
- **WGSL constants are injected**, not declared: `BESSEL_SAMPLES`, `BESSEL_X_MAX`, `LEGENDRE_SAMPLES`, `MAX_SLOTS`, `RIM_FRACTION` come from TS headers. `target` and other WGSL reserved words fail silently at pipeline creation — watch the console for `[tonoscope] GPU error`.
- **Audio starts only inside a user gesture** (`AudioEngine.create()` is synchronous and never awaits `resume()`; awaiting it stalls the UI where no output device exists).
- **The audio session follows the way.** `syncAudioSession()` in main.ts sets `play-and-record` in Sing and `playback` otherwise; switching away from `play-and-record` ends a live microphone track. Anything timed by the frame loop stops in a hidden tab, so `visibilitychange` releases notes and sleeps the engine.
- **Degree order = complexity order** in every vessel; tests enforce ascending plate wavenumber. Adding a mode means keeping that property.
- **Copy is sentence case, plain, treatise-flavored.** No all-caps labels; figure captions read `Fig. N. <pitch>: <mode description>.` Run a `writing-humanizer` pass on substantial copy changes.
- **The interface stays colorless** except `--note`, which follows the last note's Scriabin color.
- **The CSP in `public/_headers` is strict** (same-origin only plus Cloudflare Web Analytics, `data:` images for the figure-strip masks, no inline script or style). One console CSP error on the live site is expected: Cloudflare's injected JavaScript Detections inline script, deliberately left blocked (see `docs/design.md`). A new external resource, inline `<style>`/`style=` markup, `innerHTML`, a worker or AudioWorklet from a blob, or WASM each needs a matching CSP change — verify under `wrangler dev` with no violations in the console.

## Where things live

- `docs/design.md` — physics, frame flow, decisions
- `docs/images/` — README stills (regenerate with `bun run snapshot`, convert to JPEG)
- `changelog/<series>/<version>.md` — per-release notes; `CHANGELOG.md` is generated (`bun run changelog:build`), never hand-edited
- `stills/` — snapshot output, gitignored

## Triggers

| When the ask is | Do this |
|:---|:---|
| "add a resonator / vessel" | Add a `VesselKind`, mode builder, `evaluateRawMode` case, `modeValue`/`sampleVessel` cases in WGSL, a vessel button in `index.html`, a glyph projection in `figure-glyph.ts`, tests |
| "change the look", "too bright", "more color" | `DEFAULT_LOOK` in `src/gpu/renderer.ts`, then `composite.wgsl`; review with `bun run snapshot` |
| "grains feel sluggish / too jumpy" | `DEFAULT_PHYSICS` in `src/gpu/particle-system.ts`; onset jolt in `Instrument.agitation` |
| "change the scale / key" | `src/music/scale.ts` (`LYDIAN_STEPS`, `TONIC_MIDI`), composer progression, key-map tests |
| "take screenshots", "show me" | `bun run dev` then `bun run snapshot` |
| "deploy it", "ship it live", "push to the site" | `bun run deploy`, then verify https://tonoscope.caseyjhand.com returns the new asset hashes and run `bun run snapshot --url https://tonoscope.caseyjhand.com/` |

## Commit stance

Public (Apache-2.0), Claude-maintained repo: commit and push verified work as it lands once `bun run check` is green. Everything tracked is public, so hosting-account settings, secrets and local paths stay out of it. Versioned releases add a `changelog/` entry and rebuild `CHANGELOG.md`; the site updates only when `bun run deploy` runs — pushing to GitHub deploys nothing.
