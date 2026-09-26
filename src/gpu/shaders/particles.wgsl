// Draws every grain as a single additive point into the HDR target. Instance 1 draws the mirror
// image under floating vessels. The fade entry point dims the previous frame for light trails.
// RIM_FRACTION is prepended by renderer.ts.

struct View {
  viewProj: mat4x4f,
  eye: vec4f,    // camera position xyz, time
  shade: vec4f,  // grain intensity, reflection gain, floor y, energy gain
  fog: vec4f,    // near, far, hot mix, rim gain (0 when the vessel has no rim)
};

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(3) var<storage, read> colors: array<u32>;

struct GrainOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn grainVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> GrainOut {
  var w = positions[vi].xyz;
  var gain = 1.0;
  if (inst == 1u) {
    let above = max(w.y - V.shade.z, 0.0);
    w.y = V.shade.z - above;
    gain = V.shade.y * exp(-above * 1.8);
  }
  let energy = velocities[vi].w;
  var base = unpack4x8unorm(colors[vi]).rgb;
  if (V.fog.w > 0.0 && positions[vi].w < RIM_FRACTION) {
    base = vec3f(0.78, 0.71, 0.58);
    gain *= V.fog.w;
  }
  let hot = mix(base, vec3f(1.0, 0.96, 0.9), clamp(energy * V.fog.z, 0.0, 0.55));
  let depth = 1.0 - smoothstep(V.fog.x, V.fog.y, distance(w, V.eye.xyz));
  var out: GrainOut;
  out.clip = V.viewProj * vec4f(w, 1.0);
  out.color = hot * V.shade.x * (0.55 + energy * V.shade.w) * gain * mix(0.3, 1.0, depth);
  return out;
}

@fragment
fn grainFragment(in: GrainOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}

struct FullscreenOut {
  @builtin(position) pos: vec4f,
};

@vertex
fn fadeVertex(@builtin(vertex_index) i: u32) -> FullscreenOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: FullscreenOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// Paired with a blend of (src: zero, dst: constant) so the target is scaled by the blend constant.
@fragment
fn fadeFragment() -> @location(0) vec4f {
  return vec4f(0.0);
}
