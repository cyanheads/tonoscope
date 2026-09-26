/**
 * @fileoverview Slowly drifting orbit camera with damped user orbit/zoom, per-vessel framing, and
 * pointer rays for stirring grains.
 * @module view/orbit-camera
 */

import { lookAt, type Mat4, multiply, perspective, type Vec3 } from './mat4.ts';

export interface CameraFraming {
  readonly pitch: number;
  readonly distance: number;
  readonly height: number;
}

export interface CameraState {
  readonly viewProj: Mat4;
  readonly eye: Vec3;
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

const MIN_PITCH = 0.06;
const MAX_PITCH = 1.48;

export class OrbitCamera {
  readonly fovY = 0.6;
  /** Radians per second of unattended drift. */
  spin = 0.045;
  private yaw = 0.7;
  private pitch = 0.9;
  private distance = 3.2;
  private height = 0;
  private goalYaw = 0.7;
  private goalPitch = 0.9;
  private goalDistance = 3.2;
  private goalHeight = 0;
  private zoomFactor = 1;
  private aspect = 1;
  private basis = {
    eye: [0, 0, 0] as Vec3,
    right: [1, 0, 0] as Vec3,
    up: [0, 1, 0] as Vec3,
    forward: [0, 0, -1] as Vec3,
  };

  setFraming(framing: CameraFraming, immediate = false): void {
    this.goalPitch = framing.pitch;
    this.goalDistance = framing.distance;
    this.goalHeight = framing.height;
    if (immediate) {
      this.pitch = framing.pitch;
      this.distance = framing.distance * this.zoomFactor;
      this.height = framing.height;
    }
  }

  /** Current distance from the eye to the orbit center. */
  get range(): number {
    return this.distance;
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    this.goalYaw += deltaYaw;
    this.goalPitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.goalPitch + deltaPitch));
  }

  zoom(factor: number): void {
    this.zoomFactor = Math.min(2.2, Math.max(0.5, this.zoomFactor * factor));
  }

  update(dt: number, aspect: number): CameraState {
    this.aspect = aspect;
    this.goalYaw += this.spin * dt;
    const ease = 1 - Math.exp(-dt * 2.4);
    this.yaw += (this.goalYaw - this.yaw) * ease;
    this.pitch += (this.goalPitch - this.pitch) * ease;
    this.height += (this.goalHeight - this.height) * ease;
    // Framings are set for landscape; a narrow screen backs away so the vessel still fits across.
    const portraitFit = Math.max(1, 0.92 / aspect);
    this.distance += (this.goalDistance * this.zoomFactor * portraitFit - this.distance) * ease;

    const cp = Math.cos(this.pitch);
    const eye: Vec3 = [
      Math.sin(this.yaw) * cp * this.distance,
      this.height + Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * cp * this.distance,
    ];
    const target: Vec3 = [0, this.height, 0];
    const view = lookAt(eye, target, [0, 1, 0]);
    const proj = perspective(this.fovY, aspect, 0.05, 40);

    const fx = target[0] - eye[0];
    const fy = target[1] - eye[1];
    const fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz);
    const forward: Vec3 = [fx / fl, fy / fl, fz / fl];
    const rl = Math.hypot(forward[2], forward[0]) || 1;
    const right: Vec3 = [-forward[2] / rl, 0, forward[0] / rl];
    const up: Vec3 = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    this.basis = { eye, right, up, forward };
    return { viewProj: multiply(proj, view), eye };
  }

  /** World-space ray through a point in normalized device coordinates (-1..1, y up). */
  ray(ndcX: number, ndcY: number): Ray {
    const t = Math.tan(this.fovY / 2);
    const { eye, right, up, forward } = this.basis;
    const dx = forward[0] + right[0] * ndcX * t * this.aspect + up[0] * ndcY * t;
    const dy = forward[1] + right[1] * ndcX * t * this.aspect + up[1] * ndcY * t;
    const dz = forward[2] + right[2] * ndcX * t * this.aspect + up[2] * ndcY * t;
    const l = Math.hypot(dx, dy, dz);
    return { origin: eye, direction: [dx / l, dy / l, dz / l] };
  }
}
