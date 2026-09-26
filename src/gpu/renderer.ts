/**
 * @fileoverview Frame rendering: additive grain points (plus mirror image) into an HDR target with
 * light trails, a six-level bloom chain, and the composite to the canvas.
 * @module gpu/renderer
 */

import { type ParticleSystem, RIM_FRACTION } from './particle-system.ts';
import bloomSource from './shaders/bloom.wgsl?raw';
import compositeSource from './shaders/composite.wgsl?raw';
import particlesSource from './shaders/particles.wgsl?raw';

export interface Look {
  /** Brightness each grain adds before exposure, scaled internally by screen and grain count. */
  readonly grainGain: number;
  /** How much a vibrating grain brightens. */
  readonly energyGain: number;
  /** How far energetic grains shift toward white. */
  readonly hotMix: number;
  /** Fraction of last frame kept, 0–1: longer light trails as it rises. */
  readonly trail: number;
  readonly exposure: number;
  readonly bloom: number;
  readonly grain: number;
  readonly vignette: number;
  readonly aberration: number;
  readonly saturation: number;
}

export const DEFAULT_LOOK: Look = {
  grainGain: 0.4,
  energyGain: 1.5,
  hotMix: 0.35,
  trail: 0.5,
  exposure: 1.0,
  bloom: 0.2,
  grain: 0.035,
  vignette: 0.85,
  aberration: 0.012,
  saturation: 1.18,
};

export interface RenderStep {
  readonly viewProj: Float32Array;
  readonly eye: readonly [number, number, number];
  readonly time: number;
  /** Mirror floor under the vessel, or null. */
  readonly floor: { readonly y: number; readonly gain: number } | null;
  /** Brightness of the rim grains outlining a flat vessel; 0 when the vessel has no rim. */
  readonly rimGain: number;
  /** Atmosphere color (linear) and amount. */
  readonly tint: readonly [number, number, number, number];
  readonly fogNear: number;
  readonly fogFar: number;
  /** Scales every grain's brightness; dips while grains are packed together in flight. */
  readonly intensity: number;
  readonly look: Look;
}

const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
const BLOOM_LEVELS = 6;

interface BloomLevel {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
}

export class Renderer {
  private width = 1;
  private height = 1;
  private hdr: GPUTexture | null = null;
  private hdrView: GPUTextureView | null = null;
  private levels: BloomLevel[] = [];
  private downGroups: GPUBindGroup[] = [];
  private upGroups: GPUBindGroup[] = [];
  private compositeGroup: GPUBindGroup | null = null;
  private bloomParams: GPUBuffer[] = [];
  private cleared = false;

  private readonly sampler: GPUSampler;
  private readonly viewBuffer: GPUBuffer;
  private readonly viewData = new Float32Array(28);
  private readonly compositeBuffer: GPUBuffer;
  private readonly compositeData = new Float32Array(12);
  private readonly grainPipeline: GPURenderPipeline;
  private readonly fadePipeline: GPURenderPipeline;
  private readonly downPipeline: GPURenderPipeline;
  private readonly upPipeline: GPURenderPipeline;
  private readonly compositePipeline: GPURenderPipeline;
  private readonly grainGroup: GPUBindGroup;
  private readonly bloomLayout: GPUBindGroupLayout;
  private readonly compositeLayout: GPUBindGroupLayout;
  private readonly device: GPUDevice;
  private readonly particles: ParticleSystem;

  constructor(device: GPUDevice, format: GPUTextureFormat, particles: ParticleSystem) {
    this.device = device;
    this.particles = particles;
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.viewBuffer = device.createBuffer({
      label: 'view',
      size: this.viewData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.compositeBuffer = device.createBuffer({
      label: 'composite',
      size: this.compositeData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const particlesModule = device.createShaderModule({
      label: 'grains',
      code: `const RIM_FRACTION: f32 = ${RIM_FRACTION};\n${particlesSource}`,
    });
    const bloomModule = device.createShaderModule({ label: 'bloom', code: bloomSource });
    const compositeModule = device.createShaderModule({
      label: 'composite',
      code: compositeSource,
    });
    const additive: GPUBlendState = {
      color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
      alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
    };

    const grainLayout = device.createBindGroupLayout({
      label: 'grains',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.grainPipeline = device.createRenderPipeline({
      label: 'grains',
      layout: device.createPipelineLayout({ bindGroupLayouts: [grainLayout] }),
      vertex: { module: particlesModule, entryPoint: 'grainVertex' },
      fragment: {
        module: particlesModule,
        entryPoint: 'grainFragment',
        targets: [{ format: HDR_FORMAT, blend: additive }],
      },
      primitive: { topology: 'point-list' },
    });
    this.grainGroup = device.createBindGroup({
      layout: grainLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewBuffer } },
        { binding: 1, resource: { buffer: particles.positions } },
        { binding: 2, resource: { buffer: particles.velocities } },
        { binding: 3, resource: { buffer: particles.colors } },
      ],
    });
    this.fadePipeline = device.createRenderPipeline({
      label: 'trail fade',
      layout: device.createPipelineLayout({ bindGroupLayouts: [] }),
      vertex: { module: particlesModule, entryPoint: 'fadeVertex' },
      fragment: {
        module: particlesModule,
        entryPoint: 'fadeFragment',
        targets: [
          {
            format: HDR_FORMAT,
            blend: {
              color: { operation: 'add', srcFactor: 'zero', dstFactor: 'constant' },
              alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'constant' },
            },
          },
        ],
      },
    });

    this.bloomLayout = device.createBindGroupLayout({
      label: 'bloom',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const bloomPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bloomLayout],
    });
    this.downPipeline = device.createRenderPipeline({
      label: 'bloom down',
      layout: bloomPipelineLayout,
      vertex: { module: bloomModule, entryPoint: 'fullscreen' },
      fragment: { module: bloomModule, entryPoint: 'down', targets: [{ format: HDR_FORMAT }] },
    });
    this.upPipeline = device.createRenderPipeline({
      label: 'bloom up',
      layout: bloomPipelineLayout,
      vertex: { module: bloomModule, entryPoint: 'fullscreen' },
      fragment: {
        module: bloomModule,
        entryPoint: 'up',
        targets: [{ format: HDR_FORMAT, blend: additive }],
      },
    });

    this.compositeLayout = device.createBindGroupLayout({
      label: 'composite',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.compositePipeline = device.createRenderPipeline({
      label: 'composite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.compositeLayout] }),
      vertex: { module: compositeModule, entryPoint: 'fullscreen' },
      fragment: { module: compositeModule, entryPoint: 'composite', targets: [{ format }] },
    });
  }

  get pixelCount(): number {
    return this.width * this.height;
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.hdr) return;
    this.width = w;
    this.height = h;
    this.hdr?.destroy();
    for (const level of this.levels) level.texture.destroy();
    for (const buffer of this.bloomParams) buffer.destroy();
    this.bloomParams = [];

    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.hdr = this.device.createTexture({ label: 'hdr', size: [w, h], format: HDR_FORMAT, usage });
    this.hdrView = this.hdr.createView();
    this.cleared = false;

    this.levels = [];
    let lw = w;
    let lh = h;
    for (let i = 0; i < BLOOM_LEVELS; i += 1) {
      lw = Math.max(1, Math.floor(lw / 2));
      lh = Math.max(1, Math.floor(lh / 2));
      const texture = this.device.createTexture({
        label: `bloom ${i + 1}`,
        size: [lw, lh],
        format: HDR_FORMAT,
        usage,
      });
      this.levels.push({ texture, view: texture.createView(), width: lw, height: lh });
    }

    const params = (sourceWidth: number, sourceHeight: number, radius: number) => {
      const buffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(
        buffer,
        0,
        new Float32Array([1 / sourceWidth, 1 / sourceHeight, radius, 0]),
      );
      this.bloomParams.push(buffer);
      return buffer;
    };
    const group = (view: GPUTextureView, buffer: GPUBuffer) =>
      this.device.createBindGroup({
        layout: this.bloomLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer } },
        ],
      });

    const hdrView = this.hdrView;
    this.downGroups = this.levels.map((_, i) => {
      const source = i === 0 ? { view: hdrView, width: w, height: h } : this.levels[i - 1];
      if (!source) throw new Error('Bloom chain is missing a level');
      return group(source.view, params(source.width, source.height, 1));
    });
    this.upGroups = this.levels.slice(0, -1).map((_, i) => {
      const source = this.levels[i + 1];
      if (!source) throw new Error('Bloom chain is missing a level');
      return group(source.view, params(source.width, source.height, 1));
    });
    const bloomTop = this.levels[0];
    if (!bloomTop) throw new Error('Bloom chain is empty');
    this.compositeGroup = this.device.createBindGroup({
      layout: this.compositeLayout,
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: bloomTop.view },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.compositeBuffer } },
      ],
    });
  }

  encode(encoder: GPUCommandEncoder, target: GPUTextureView, step: RenderStep): void {
    const hdrView = this.hdrView;
    const compositeGroup = this.compositeGroup;
    if (!hdrView || !compositeGroup) throw new Error('Renderer.resize() must run before encode()');
    const look = step.look;
    const density = this.pixelCount / this.particles.count;
    const grain = look.grainGain * density * (1 - look.trail) * step.intensity;

    const v = this.viewData;
    v.set(step.viewProj, 0);
    v.set([step.eye[0], step.eye[1], step.eye[2], step.time], 16);
    v.set([grain, step.floor?.gain ?? 0, step.floor?.y ?? 0, look.energyGain], 20);
    v.set([step.fogNear, step.fogFar, look.hotMix, step.rimGain], 24);
    this.device.queue.writeBuffer(this.viewBuffer, 0, v);

    const c = this.compositeData;
    c.set([look.exposure, look.bloom, look.grain, step.time], 0);
    c.set([look.vignette, look.aberration, this.width / this.height, look.saturation], 4);
    c.set(step.tint, 8);
    this.device.queue.writeBuffer(this.compositeBuffer, 0, c);

    const scene = encoder.beginRenderPass({
      label: 'grains',
      colorAttachments: [
        {
          view: hdrView,
          loadOp: this.cleared ? 'load' : 'clear',
          clearValue: [0, 0, 0, 0],
          storeOp: 'store',
        },
      ],
    });
    this.cleared = true;
    scene.setPipeline(this.fadePipeline);
    scene.setBlendConstant([look.trail, look.trail, look.trail, look.trail]);
    scene.draw(3);
    scene.setPipeline(this.grainPipeline);
    scene.setBindGroup(0, this.grainGroup);
    scene.draw(this.particles.count, step.floor ? 2 : 1);
    scene.end();

    this.levels.forEach((level, i) => {
      const pass = encoder.beginRenderPass({
        label: `bloom down ${i + 1}`,
        colorAttachments: [
          { view: level.view, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' },
        ],
      });
      pass.setPipeline(this.downPipeline);
      const group = this.downGroups[i];
      if (!group) throw new Error('Bloom down group missing');
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    });
    for (let i = this.levels.length - 2; i >= 0; i -= 1) {
      const level = this.levels[i];
      const group = this.upGroups[i];
      if (!level || !group) throw new Error('Bloom up chain is incomplete');
      const pass = encoder.beginRenderPass({
        label: `bloom up ${i + 1}`,
        colorAttachments: [{ view: level.view, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(this.upPipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }

    const final = encoder.beginRenderPass({
      label: 'composite',
      colorAttachments: [
        { view: target, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' },
      ],
    });
    final.setPipeline(this.compositePipeline);
    final.setBindGroup(0, compositeGroup);
    final.draw(3);
    final.end();
  }
}
