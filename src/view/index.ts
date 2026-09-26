/**
 * @fileoverview Public surface of the view module: camera and matrix helpers.
 * @module view
 */

export { lookAt, type Mat4, multiply, perspective, type Vec3 } from './mat4.ts';
export { type CameraFraming, type CameraState, OrbitCamera, type Ray } from './orbit-camera.ts';
