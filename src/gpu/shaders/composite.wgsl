// Final image: HDR grains + bloom over a dark field tinted by the sounding note, then exposure,
// a soft shoulder, vignette, faint lens fringing, film grain and dither, encoded to sRGB.

struct Composite {
  tone: vec4f,  // exposure, bloom strength, grain amount, time
  look: vec4f,  // vignette, aberration, aspect, saturation
  tint: vec4f,  // atmosphere color (linear rgb), amount
};

@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> C: Composite;

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

fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(443.897, 441.423));
  let r = q + dot(q, q.yx + 19.19);
  return fract((r.x + r.y) * r.x);
}

fn toSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn composite(in: FullscreenOut) -> @location(0) vec4f {
  let uv = in.uv;
  let d = uv - 0.5;
  let ds = d * vec2f(C.look.z, 1.0);
  let r2 = dot(ds, ds);

  let fringe = d * C.look.y * r2;
  var color = vec3f(
    textureSampleLevel(hdr, linearSampler, uv - fringe, 0.0).r,
    textureSampleLevel(hdr, linearSampler, uv, 0.0).g,
    textureSampleLevel(hdr, linearSampler, uv + fringe, 0.0).b,
  );
  color += textureSampleLevel(bloom, linearSampler, uv, 0.0).rgb * C.tone.y;

  // Dense light runs toward white, as it would on film.
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color += vec3f(max(luma - 0.8, 0.0) * 0.1);

  // The room: near-black, with a low pool of the note's color behind the vessel.
  let pool = exp(-r2 * 2.6);
  color += vec3f(0.0022, 0.0026, 0.0048) * (1.2 - uv.y * 0.6) + C.tint.rgb * C.tint.w * pool;

  color = 1.0 - exp(-color * C.tone.x);
  let grey = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(grey), color, C.look.w);
  color *= mix(1.0, 1.0 - smoothstep(0.15, 1.35, sqrt(r2)), C.look.x);

  var srgb = toSrgb(color);
  let grain = hash(in.pos.xy + vec2f(fract(C.tone.w * 7.31) * 911.0, fract(C.tone.w * 3.17) * 577.0)) - 0.5;
  srgb += grain * C.tone.z * (0.35 + 0.65 * (1.0 - grey));
  srgb += (hash(in.pos.xy * 1.37 + 0.71) - 0.5) / 255.0;
  return vec4f(srgb, 1.0);
}
