/**
 * @fileoverview Composition root: boots WebGPU, builds the resonators, wires audio, input and the
 * page together, and runs the frame loop (notes → slots → simulate → render → HUD).
 * @module main
 */

import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import './ui/styles.css';

import { AudioEngine, Microphone, setAudioSession } from './audio/index.ts';
import {
  DEFAULT_LOOK,
  DEFAULT_PHYSICS,
  type GpuFailure,
  initGpu,
  ParticleSystem,
  Renderer,
} from './gpu/index.ts';
import { Instrument, Performer, pitchRangeFor } from './instrument/index.ts';
import {
  Composer,
  frequencyToMidi,
  midiLabel,
  nearestDegree,
  noteAt,
  pitchClassHex,
} from './music/index.ts';
import {
  buildResonance,
  type Excitation,
  evaluateRawMode,
  MAX_SLOTS,
  packSlots,
  SLOT_FLOATS,
  type Vessel,
} from './resonance/index.ts';
import { Hud, type Way } from './ui/index.ts';
import { OrbitCamera, type Ray, type Vec3 } from './view/index.ts';

const MORPH_SECONDS = 3.2;
const STIR_RADIUS = 0.24;

const FAILURE_TEXT: Record<GpuFailure, string> = {
  'no-webgpu':
    'This browser does not offer WebGPU. It runs in current Chrome, Edge and Safari, including on iPhone and iPad, and in Firefox on Windows.',
  'no-adapter':
    'WebGPU is present, but no graphics adapter answered. It may be switched off in the browser settings or unavailable for this graphics card.',
  'device-failed':
    'The graphics device could not be created. Closing other GPU-heavy tabs and reloading may help.',
};

const clock = (): number => performance.now() / 1000;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function requestedGrains(maxGrains: number): number {
  const param = new URLSearchParams(location.search).get('grains');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let grains = coarse ? 1 << 20 : 1 << 22;
  if (param) {
    const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(param.trim());
    if (match) {
      const scale = { k: 1e3, m: 1e6, '': 1 }[(match[2] ?? '').toLowerCase()] ?? 1;
      grains = Number(match[1]) * scale;
    }
  }
  return Math.max(1 << 14, Math.min(maxGrains, Math.round(grains / 256) * 256));
}

function intersect(vessel: Vessel, ray: Ray): Vec3 | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  if (vessel.kind === 'plate' || vessel.kind === 'drum') {
    if (Math.abs(dy) < 1e-4) return null;
    const t = -oy / dy;
    if (t <= 0) return null;
    const x = ox + dx * t;
    const z = oz + dz * t;
    return Math.max(Math.abs(x), Math.abs(z)) < 1.3 ? [x, 0, z] : null;
  }
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? [ox + dx * t, oy + dy * t, oz + dz * t] : null;
}

function stageCanvas(): HTMLCanvasElement {
  const stage = document.querySelector<HTMLCanvasElement>('#stage');
  if (!stage) throw new Error('index.html is missing <canvas id="stage">');
  return stage;
}

async function boot(): Promise<void> {
  const stage = stageCanvas();

  let way: Way = 'listen';
  let vesselIndex = 0;
  let generation = 1;
  let morph = 0;
  let audio: AudioEngine | null = null;
  let soundOn = false;
  let microphone: Microphone | null = null;
  let voice: { id: number; degree: number; midi: number; heardAt: number } | null = null;
  let voicePending: { degree: number; since: number } | null = null;
  let captureRequested = false;
  let started = false;
  let firstPlayHintCleared = false;
  /** Bumped by every change of way, so a Sing request that is overtaken knows it. */
  let wayRequest = 0;
  /** When the vessel last changed, until its grains land. */
  let switchedAt: number | null = null;

  const instrument = new Instrument();
  const composer = new Composer();
  const camera = new OrbitCamera();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) camera.spin = 0;

  const hud = new Hud({
    onBegin: (withSound) => begin(withSound),
    onWay: (next) => void setWay(next),
    onVessel: (index) => setVessel(index),
    onSound: () => toggleSound(),
    onCapture: () => {
      captureRequested = true;
    },
    onFigure: (degree) => performer.tap(degree),
  });

  const init = await initGpu(stage);
  if (!init.ok) {
    hud.showUnsupported(FAILURE_TEXT[init.reason]);
    console.error(`[tonoscope] WebGPU unavailable: ${init.detail}`);
    return;
  }
  const { device, context } = init.gpu;
  device.addEventListener('uncapturederror', (event) => {
    console.error(`[tonoscope] GPU error: ${(event as GPUUncapturedErrorEvent).error.message}`);
  });
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') {
      hud.showUnsupported('The graphics device was lost. Reload the page to start again.');
    }
  });

  const { tables, vessels } = buildResonance();
  const vesselAt = (index: number): Vessel => {
    const vessel = vessels[index];
    if (!vessel) throw new RangeError(`No vessel ${index}`);
    return vessel;
  };

  const particles = new ParticleSystem(device, requestedGrains(init.gpu.maxGrains), tables);
  particles.seed(Math.floor(Math.random() * 2 ** 31));
  const renderer = new Renderer(device, init.gpu.format, particles);
  camera.setFraming(vesselAt(0).framing, true);

  const performer = new Performer(stage, instrument, camera, {
    now: clock,
    range: () => pitchRangeFor(window.innerWidth),
    started: () => started,
    onPlay: () => {
      if (way === 'listen' && started) void setWay('play');
      if (!firstPlayHintCleared && started) {
        firstPlayHintCleared = true;
        window.setTimeout(() => hud.clearHint(), 1200);
      }
    },
  });

  /** The devicePixelRatio the canvas was last sized for. */
  let density = 0;
  const resize = (): void => {
    density = window.devicePixelRatio || 1;
    const dpr = Math.min(density, 2);
    stage.width = Math.max(1, Math.floor(stage.clientWidth * dpr));
    stage.height = Math.max(1, Math.floor(stage.clientHeight * dpr));
    renderer.resize(stage.width, stage.height);
    hud.showFigures(vesselAt(vesselIndex), tables, pitchRangeFor(window.innerWidth));
  };
  window.addEventListener('resize', resize);
  resize();

  /** Sing needs the microphone; every other way plays through the iPhone's silent switch. */
  function syncAudioSession(): void {
    setAudioSession(way === 'sing' ? 'play-and-record' : 'playback');
  }

  function ensureAudio(): AudioEngine {
    if (!audio) {
      syncAudioSession();
      audio = AudioEngine.create();
      instrument.attachAudio(audio);
    }
    return audio;
  }

  /** Restart the audio clock where it should run: with sound on, or while singing (pitch needs it). */
  function wakeAudio(): void {
    if (soundOn || way === 'sing') audio?.wake();
  }

  function begin(withSound: boolean): void {
    if (started) return;
    started = true;
    hud.setStarted();
    if (withSound) {
      ensureAudio();
      soundOn = true;
      hud.setSound(true);
      void setWay('play');
      instrument.noteOn(clock(), 7, {
        velocity: 0.75,
        pan: 0,
        bowed: true,
        source: 'pointer',
        holdFor: 2.2,
      });
      hud.showHint(
        window.matchMedia('(pointer: coarse)').matches
          ? 'Tap anywhere to play: low notes to the left, high to the right. Hold to sustain, slide for a run.'
          : 'Click anywhere to play: low notes to the left, high to the right. Hold to sustain, drag for a run, or play the letter keys.',
        12,
      );
    } else {
      hud.setSound(false);
      void setWay('listen');
      hud.showHint('Playing itself, in silence. The speaker above turns the sound on.', 7);
    }
  }

  function toggleSound(): void {
    const engine = ensureAudio();
    soundOn = !soundOn;
    engine.setMuted(!soundOn);
    if (soundOn) engine.wake();
    hud.setSound(soundOn);
  }

  async function setWay(next: Way): Promise<void> {
    if (next === 'sing' && way === 'sing') return; // already singing, or asking for the microphone
    wayRequest += 1;
    const request = wayRequest;
    const now = clock();
    const previous = way;
    way = next;
    hud.setWay(next);
    if (previous === 'listen' && next !== 'listen') instrument.releaseAll(now, 'composer');
    if (previous === 'sing' && next !== 'sing') {
      microphone?.close();
      microphone = null;
      syncAudioSession();
      instrument.releaseAll(now, 'voice');
      voice = null;
    }
    if (next === 'listen') composer.reset(now);
    if (next !== 'sing') return;

    const engine = ensureAudio();
    if (!soundOn) engine.setMuted(true);
    engine.wake();
    syncAudioSession();
    const result = await Microphone.open(engine.ctx);
    if (request !== wayRequest) {
      // The player chose another way while the permission prompt was up.
      if (result.ok) {
        result.microphone.close();
        syncAudioSession();
      }
      return;
    }
    if (!result.ok) {
      hud.showHint(
        result.reason === 'denied'
          ? "The microphone is blocked. Allow it in this site's settings to sing."
          : 'No microphone is available.',
        7,
      );
      await setWay('play');
      return;
    }
    microphone = result.microphone;
    hud.showHint('Sing or hum a long, steady note and watch it take shape.', 7);
  }

  function setVessel(index: number): void {
    if (index === vesselIndex || !vessels[index]) return;
    vesselIndex = index;
    generation += 1;
    morph = 0;
    switchedAt = clock();
    const vessel = vesselAt(index);
    camera.setFraming(vessel.framing);
    hud.setVessel(index);
    hud.showFigures(vessel, tables, pitchRangeFor(window.innerWidth));
    lastCaptionKey = '';
  }

  window.addEventListener('keydown', (event) => {
    if (!started || event.metaKey || event.ctrlKey || event.altKey || hud.aboutOpen) return;
    if (/^Digit[1-4]$/.test(event.code)) setVessel(Number(event.code.slice(5)) - 1);
    if (event.code === 'Space') {
      event.preventDefault();
      void setWay(way === 'listen' ? 'play' : 'listen');
    }
  });

  /**
   * Frames stop while the page is hidden, and with them every timed release, so nothing may keep
   * sounding: notes are released, the microphone closes, and the audio clock sleeps.
   */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      wakeAudio();
      return;
    }
    if (way === 'sing') void setWay('play');
    instrument.releaseAll(clock());
    audio?.sleep();
  });

  /**
   * iOS can leave audio interrupted after a call or a screen lock until a gesture restarts it. A
   * touch counts as a gesture on release, a mouse button or key on press.
   */
  for (const type of ['pointerdown', 'pointerup', 'keydown'] as const) {
    window.addEventListener(type, wakeAudio);
  }

  function listenToVoice(now: number): void {
    if (!microphone) return;
    const reading = microphone.read();
    if (reading.frequency !== null) {
      const midi = frequencyToMidi(reading.frequency);
      const degree = nearestDegree(midi);
      if (voice && voice.degree === degree) {
        voice.midi = midi;
        voice.heardAt = now;
        voicePending = null;
        return;
      }
      if (!voicePending || voicePending.degree !== degree) {
        voicePending = { degree, since: now };
        return;
      }
      if (now - voicePending.since < 0.06) return;
      if (voice) instrument.noteOff(now, voice.id);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      const id = instrument.noteOn(now, degree, {
        velocity: Math.min(1, Math.max(0.55, reading.level * 9)),
        pan: 0,
        bowed: true,
        source: 'voice',
        silent: true,
        pitchClass,
      });
      voice = { id, degree, midi, heardAt: now };
      voicePending = null;
    } else if (voice && now - voice.heardAt > 0.3) {
      instrument.noteOff(now, voice.id);
      voice = null;
    }
  }

  /**
   * After a resonator switch the grains land as a blank sheet under a caption naming the last
   * note's figure. In Play, with nothing sounding (by the figure strip's measure) and nothing
   * played since the switch, that note sounds again, silently, so its figure forms. Listen and
   * Sing keep the vessel busy themselves.
   */
  function refigure(now: number, since: number, excitations: readonly Excitation[]): void {
    const latest = instrument.lastPlayed;
    if (way !== 'play' || !latest || latest.at >= since) return;
    if (excitations.some((e) => e.amplitude > 0.06)) return;
    instrument.noteOn(now, latest.degree, {
      velocity: 0.75,
      pan: 0,
      bowed: true,
      source: latest.source,
      silent: true,
      holdFor: 1.6,
    });
  }

  let lastCaptionKey = '';
  function updateCaption(): void {
    const latest = instrument.lastPlayed;
    const vessel = vesselAt(vesselIndex);
    const key = latest
      ? `${vessel.index}:${latest.degree}:${latest.at}:${latest.source === 'voice' ? Math.round((voice?.midi ?? 0) * 4) : ''}`
      : '';
    if (key === lastCaptionKey) return;
    lastCaptionKey = key;
    if (!latest) {
      hud.setCaption(null);
      return;
    }
    const note = noteAt(latest.degree);
    const mode = vessel.modes[latest.degree];
    if (!mode) return;
    if (latest.source === 'voice' && voice) {
      const hz = 440 * 2 ** ((voice.midi - 69) / 12);
      hud.setCaption({
        figure: latest.degree + 1,
        pitch: `Your ${midiLabel(voice.midi)}, ${Math.round(hz)} Hz`,
        text: mode.description,
      });
      hud.setNoteColor(pitchClassHex(Math.round(voice.midi)));
      return;
    }
    hud.setCaption({
      figure: latest.degree + 1,
      pitch: `${note.name}${note.octave}, ${Math.round(note.frequency)} Hz`,
      text: mode.description,
    });
    hud.setNoteColor(pitchClassHex(note.pitchClass));
  }

  const slots = new Float32Array(MAX_SLOTS * SLOT_FLOATS);
  const tint: [number, number, number, number] = [0, 0, 0, 0];
  let stirHit: Vec3 | null = null;
  const stirMotion: [number, number, number] = [0, 0, 0];
  let stirStrength = 0;
  let last = clock();
  let frame = 0;
  let slowTime = 0;
  const startedAt = last;

  function updateTint(excitations: readonly Excitation[], dt: number): void {
    let total = 0;
    const mix = [0, 0, 0];
    for (const e of excitations) {
      total += e.amplitude;
      mix[0] = (mix[0] ?? 0) + e.color[0] * e.amplitude;
      mix[1] = (mix[1] ?? 0) + e.color[1] * e.amplitude;
      mix[2] = (mix[2] ?? 0) + e.color[2] * e.amplitude;
    }
    const k = 1 - Math.exp(-dt * 2);
    if (total > 0) {
      for (let i = 0; i < 3; i += 1)
        tint[i] = (tint[i] ?? 0) + ((mix[i] ?? 0) / total - (tint[i] ?? 0)) * k;
    }
    tint[3] += (Math.min(1, total) * 0.03 - tint[3]) * k;
  }

  function updateStir(vessel: Vessel, dt: number): void {
    const stir = performer.stir;
    const hit =
      stir.idle < 0.12 && !hud.aboutOpen
        ? intersect(vessel, camera.ray(stir.ndcX, stir.ndcY))
        : null;
    if (hit && stirHit) {
      const k = 1 - Math.exp(-dt * 18);
      for (let i = 0; i < 3; i += 1) {
        const velocity = ((hit[i] ?? 0) - (stirHit[i] ?? 0)) / Math.max(dt, 1e-3);
        stirMotion[i] = (stirMotion[i] ?? 0) + (velocity - (stirMotion[i] ?? 0)) * k;
      }
    } else {
      stirMotion.fill(0);
    }
    stirHit = hit;
    const speed = Math.hypot(...stirMotion);
    const goal = hit ? Math.min(1.2, speed * 0.6) : 0;
    stirStrength += (goal - stirStrength) * (1 - Math.exp(-dt * 10));
  }

  function capture(): void {
    captureRequested = false;
    const latest = instrument.lastPlayed;
    const vessel = vesselAt(vesselIndex);
    stage.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `tonoscope-${vessel.kind}${latest ? `-fig-${latest.degree + 1}` : ''}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }, 'image/png');
  }

  function tick(): void {
    const now = clock();
    const dt = Math.min(now - last, 1 / 20);
    last = now;
    frame += 1;

    if (way === 'listen') {
      for (const note of composer.update(now)) {
        instrument.noteOn(now, note.degree, {
          velocity: note.velocity,
          pan: note.pan,
          bowed: note.hold > 0,
          source: 'composer',
          ...(note.hold > 0 ? { holdFor: note.hold } : {}),
        });
      }
    }
    if (way === 'sing') listenToVoice(now);
    if (morph < 1) morph = Math.min(1, morph + dt / MORPH_SECONDS);

    const vessel = vesselAt(vesselIndex);
    const excitations = instrument.excitations(now);
    if (switchedAt !== null && morph === 1) {
      refigure(now, switchedAt, excitations);
      switchedAt = null;
    }
    const slotCount = packSlots(vessel, excitations, slots, 0);
    updateTint(excitations, dt);
    updateStir(vessel, dt);

    // A move to a display of another density changes devicePixelRatio without a resize event.
    if ((window.devicePixelRatio || 1) !== density) resize();
    const view = camera.update(dt, stage.width / stage.height);
    const encoder = device.createCommandEncoder({ label: 'frame' });
    particles.encode(encoder, {
      time: now - startedAt,
      dt,
      morph,
      agitation: instrument.agitation(now),
      vessel: vessel.index,
      generation,
      frame,
      slots,
      slotCount,
      pointer: stirHit ? [stirHit[0], stirHit[1], stirHit[2], stirStrength] : [0, 0, 0, 0],
      pointerMotion: [stirMotion[0], stirMotion[1], stirMotion[2], STIR_RADIUS],
      physics: DEFAULT_PHYSICS,
    });
    renderer.encode(encoder, context.getCurrentTexture().createView(), {
      viewProj: view.viewProj,
      eye: view.eye,
      time: now - startedAt,
      floor: vessel.floorY === null ? null : { y: vessel.floorY, gain: 0.16 },
      rimGain: vessel.floorY === null ? 0.22 : 0,
      tint,
      fogNear: camera.range - 1.1,
      fogFar: camera.range + 2.4,
      intensity: 0.4 + 0.6 * smoothstep(0.55, 1, morph),
      look: DEFAULT_LOOK,
    });
    device.queue.submit([encoder.finish()]);
    if (captureRequested) capture();

    // Shed grains if this device cannot hold a smooth frame rate.
    if (now - startedAt > 4) {
      slowTime = dt > 1 / 38 ? slowTime + dt : Math.max(0, slowTime - dt * 0.5);
      if (slowTime > 1.5 && particles.count > 1 << 18) {
        particles.setCount(particles.count * 0.7);
        slowTime = 0;
        console.info(`[tonoscope] reduced to ${particles.count.toLocaleString()} grains`);
      }
    }

    hud.updateFigures(
      excitations.map((e) => ({
        degree: e.degree,
        amplitude: e.amplitude,
        hex: pitchClassHex(noteAt(e.degree).pitchClass),
      })),
      instrument.lastPlayed?.degree ?? null,
    );
    updateCaption();
    requestAnimationFrame(tick);
  }

  hud.setWay(way);
  hud.setVessel(vesselIndex);
  composer.reset(clock());
  requestAnimationFrame(tick);
  Object.assign(window, {
    tonoscope: { particles, instrument, camera, setVessel, vessels, tables, evaluateRawMode },
  });
}

void boot();
