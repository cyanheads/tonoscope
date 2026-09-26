/**
 * @fileoverview Public surface of the GPU module: device bootstrap, grain simulation, renderer.
 * @module gpu
 */

export { type GpuContext, type GpuFailure, type GpuInit, initGpu } from './gpu-context.ts';
export {
  DEFAULT_PHYSICS,
  ParticleSystem,
  type PhysicsSettings,
  type SimulationStep,
} from './particle-system.ts';
export { DEFAULT_LOOK, type Look, Renderer, type RenderStep } from './renderer.ts';
