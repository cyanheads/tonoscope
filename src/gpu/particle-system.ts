/**
 * @fileoverview Grain state on the GPU (position, velocity, color) and the compute passes that
 * seed and advance it. See `src/gpu/shaders/simulate.wgsl` for the physics.
 * @module gpu/particle-system
 */

import {
  BESSEL_SAMPLES,
  BESSEL_X_MAX,
  LEGENDRE_SAMPLES,
  MAX_SLOTS,
  SLOT_FLOATS,
} from '../resonance/index.ts';
import seedSource from './shaders/seed.wgsl?raw';
import simulateSource from './shaders/simulate.wgsl?raw';

/** Share of grains (by seed) that outline the plate and drum rather than acting as sand. */
export const RIM_FRACTION = 0.006;

export interface PhysicsSettings {
  /** Launches per second for a grain at full vibration. */
  readonly hopRate: number;
  readonly hopSpeed: number;
  readonly lateral: number;
  readonly gravity: number;
  /** Newton-step rate (1/s) pulling grounded grains onto nodal lines. */
  readonly slide: number;
  readonly latticeKick: number;
  /** Per-frame velocity retention inside the lattice (at 60 fps). */
  readonly latticeDamping: number;
  /** How fast a moving grain takes on the color of the note moving it (1/s). */
  readonly colorRate: number;
}

export const DEFAULT_PHYSICS: PhysicsSettings = {
  hopRate: 14,
  hopSpeed: 1.25,
  lateral: 0.42,
  gravity: 7.5,
  slide: 1.6,
  latticeKick: 0.055,
  latticeDamping: 0.86,
  colorRate: 3.2,
};

export interface SimulationStep {
  readonly time: number;
  readonly dt: number;
  /** Vessel-change progress; 1 means every grain has landed. */
  readonly morph: number;
  /** Onset jolt, 0–1: launches grains everywhere regardless of the standing wave. */
  readonly agitation: number;
  readonly vessel: number;
  readonly generation: number;
  readonly frame: number;
  readonly slots: Float32Array;
  readonly slotCount: number;
  /** World-space stir point and strength (0 = no stirring). */
  readonly pointer: readonly [number, number, number, number];
  /** World-space stir velocity and radius. */
  readonly pointerMotion: readonly [number, number, number, number];
  readonly physics: PhysicsSettings;
}

const PARAM_VEC4S = 7 + MAX_SLOTS * 3;
const WORKGROUP = 256;

export class ParticleSystem {
  readonly capacity: number;
  readonly positions: GPUBuffer;
  readonly velocities: GPUBuffer;
  readonly colors: GPUBuffer;
  private activeCount: number;
  private readonly params: GPUBuffer;
  private readonly paramData = new ArrayBuffer(PARAM_VEC4S * 16);
  private readonly paramF32 = new Float32Array(this.paramData);
  private readonly paramU32 = new Uint32Array(this.paramData);
  private readonly simulatePipeline: GPUComputePipeline;
  private readonly seedPipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly device: GPUDevice;

  constructor(device: GPUDevice, capacity: number, tables: Float32Array) {
    this.device = device;
    this.capacity = capacity;
    this.activeCount = capacity;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.positions = device.createBuffer({
      label: 'grain positions',
      size: capacity * 16,
      usage: storage,
    });
    this.velocities = device.createBuffer({
      label: 'grain velocities',
      size: capacity * 16,
      usage: storage,
    });
    this.colors = device.createBuffer({
      label: 'grain colors',
      size: capacity * 4,
      usage: storage,
    });
    const tableBuffer = device.createBuffer({
      label: 'mode tables',
      size: tables.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(tableBuffer, 0, tables);
    this.params = device.createBuffer({
      label: 'simulation params',
      size: this.paramData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const header = [
      `const BESSEL_SAMPLES: u32 = ${BESSEL_SAMPLES}u;`,
      `const BESSEL_X_MAX: f32 = ${BESSEL_X_MAX.toFixed(1)};`,
      `const LEGENDRE_SAMPLES: u32 = ${LEGENDRE_SAMPLES}u;`,
      `const MAX_SLOTS: u32 = ${MAX_SLOTS}u;`,
      `const RIM_FRACTION: f32 = ${RIM_FRACTION};`,
    ].join('\n');
    const module = device.createShaderModule({
      label: 'simulate',
      code: `${header}\n${simulateSource}\n${seedSource}`,
    });
    const compute = GPUShaderStage.COMPUTE;
    const layout = device.createBindGroupLayout({
      label: 'simulation',
      entries: [
        { binding: 0, visibility: compute, buffer: { type: 'uniform' } },
        { binding: 1, visibility: compute, buffer: { type: 'storage' } },
        { binding: 2, visibility: compute, buffer: { type: 'storage' } },
        { binding: 3, visibility: compute, buffer: { type: 'storage' } },
        { binding: 4, visibility: compute, buffer: { type: 'read-only-storage' } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    this.simulatePipeline = device.createComputePipeline({
      label: 'simulate',
      layout: pipelineLayout,
      compute: { module, entryPoint: 'simulate' },
    });
    this.seedPipeline = device.createComputePipeline({
      label: 'seed',
      layout: pipelineLayout,
      compute: { module, entryPoint: 'seed' },
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.positions } },
        { binding: 2, resource: { buffer: this.velocities } },
        { binding: 3, resource: { buffer: this.colors } },
        { binding: 4, resource: { buffer: tableBuffer } },
      ],
    });
  }

  get count(): number {
    return this.activeCount;
  }

  /** Shrink (or restore) the simulated grain count without reallocating. */
  setCount(count: number): void {
    this.activeCount = Math.max(1, Math.min(this.capacity, Math.floor(count)));
  }

  /** Scatter every grain into the opening nebula. */
  seed(salt: number): void {
    this.paramU32.fill(0);
    this.paramU32[4] = this.capacity;
    this.paramU32[8] = salt >>> 0;
    this.device.queue.writeBuffer(this.params, 0, this.paramData);
    const encoder = this.device.createCommandEncoder({ label: 'seed' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.seedPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.capacity / WORKGROUP));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** Read back the first `n` grains' position (xyz, seed) and velocity (xyz, energy), for debugging. */
  async sample(n: number): Promise<{ positions: number[]; velocities: number[] }> {
    const bytes = Math.min(n, this.capacity) * 16;
    const staging = [0, 1].map(() =>
      this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    );
    const [positions, velocities] = staging as [GPUBuffer, GPUBuffer];
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.positions, 0, positions, 0, bytes);
    encoder.copyBufferToBuffer(this.velocities, 0, velocities, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    const read = async (buffer: GPUBuffer) => {
      await buffer.mapAsync(GPUMapMode.READ);
      const values = Array.from(new Float32Array(buffer.getMappedRange().slice(0)));
      buffer.destroy();
      return values;
    };
    return { positions: await read(positions), velocities: await read(velocities) };
  }

  encode(encoder: GPUCommandEncoder, step: SimulationStep): void {
    const f = this.paramF32;
    const u = this.paramU32;
    const ph = step.physics;
    f.set([step.time, step.dt, step.morph, step.agitation], 0);
    u.set([this.activeCount, step.vessel, step.slotCount, step.generation], 4);
    u.set([step.frame >>> 0, 0, 0, 0], 8);
    f.set([ph.hopRate, ph.hopSpeed, ph.lateral, ph.gravity], 12);
    f.set([ph.slide, ph.latticeKick, ph.latticeDamping, ph.colorRate], 16);
    f.set(step.pointer, 20);
    f.set(step.pointerMotion, 24);
    f.set(step.slots.subarray(0, MAX_SLOTS * SLOT_FLOATS), 28);
    this.device.queue.writeBuffer(this.params, 0, this.paramData);

    const pass = encoder.beginComputePass({ label: 'simulate' });
    pass.setPipeline(this.simulatePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.activeCount / WORKGROUP));
    pass.end();
  }
}
