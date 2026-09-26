/**
 * @fileoverview WebGPU bootstrap: adapter, device with raised storage limits, and the canvas
 * context. Failure is a value, not an exception, so the page can explain what is missing.
 * @module gpu/gpu-context
 */

export interface GpuContext {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  /** Largest grain count one vec4 storage buffer can hold on this device. */
  readonly maxGrains: number;
}

export type GpuFailure = 'no-webgpu' | 'no-adapter' | 'device-failed';

export type GpuInit =
  | { readonly ok: true; readonly gpu: GpuContext }
  | { readonly ok: false; readonly reason: GpuFailure; readonly detail: string };

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuInit> {
  if (!('gpu' in navigator)) {
    return { ok: false, reason: 'no-webgpu', detail: 'navigator.gpu is undefined' };
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return { ok: false, reason: 'no-adapter', detail: 'requestAdapter() returned null' };
  }
  const { maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredLimits: { maxStorageBufferBindingSize, maxBufferSize },
    });
  } catch (error) {
    return { ok: false, reason: 'device-failed', detail: String(error) };
  }
  const context = canvas.getContext('webgpu');
  if (!context) {
    return { ok: false, reason: 'device-failed', detail: 'canvas.getContext("webgpu") failed' };
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const maxGrains = Math.floor(Math.min(maxStorageBufferBindingSize, maxBufferSize) / 16);
  return { ok: true, gpu: { device, context, format, maxGrains } };
}
