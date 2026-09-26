// Physically-flavoured bloom: a 13-tap downsample chain followed by a tent-filtered upsample chain
// that accumulates additively back up to half resolution.

struct BloomParams {
  texel: vec2f,  // 1 / source size
  radius: f32,
  _pad: f32,
};

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> B: BloomParams;

struct FullscreenOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn fullscreen(@builtin(vertex_index) i: u32) -> FullscreenOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: FullscreenOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

fn tap(uv: vec2f, offset: vec2f) -> vec3f {
  return textureSampleLevel(source, linearSampler, uv + offset * B.texel, 0.0).rgb;
}

@fragment
fn down(in: FullscreenOut) -> @location(0) vec4f {
  let uv = in.uv;
  let a = tap(uv, vec2f(-2.0, 2.0));
  let b = tap(uv, vec2f(0.0, 2.0));
  let c = tap(uv, vec2f(2.0, 2.0));
  let d = tap(uv, vec2f(-2.0, 0.0));
  let e = tap(uv, vec2f(0.0, 0.0));
  let f = tap(uv, vec2f(2.0, 0.0));
  let g = tap(uv, vec2f(-2.0, -2.0));
  let h = tap(uv, vec2f(0.0, -2.0));
  let i = tap(uv, vec2f(2.0, -2.0));
  let j = tap(uv, vec2f(-1.0, 1.0));
  let k = tap(uv, vec2f(1.0, 1.0));
  let l = tap(uv, vec2f(-1.0, -1.0));
  let m = tap(uv, vec2f(1.0, -1.0));
  let color = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  return vec4f(color, 1.0);
}

@fragment
fn up(in: FullscreenOut) -> @location(0) vec4f {
  let uv = in.uv;
  let r = B.radius;
  var color = tap(uv, vec2f(0.0, 0.0)) * 4.0;
  color += (tap(uv, vec2f(-r, 0.0)) + tap(uv, vec2f(r, 0.0)) + tap(uv, vec2f(0.0, -r)) + tap(uv, vec2f(0.0, r))) * 2.0;
  color += tap(uv, vec2f(-r, -r)) + tap(uv, vec2f(r, -r)) + tap(uv, vec2f(-r, r)) + tap(uv, vec2f(r, r));
  return vec4f(color / 16.0, 1.0);
}
