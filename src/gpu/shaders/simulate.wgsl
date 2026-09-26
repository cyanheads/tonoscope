// Tonoscope particle simulation: one invocation per grain.
//
// Grains behave like sand on a vibrating surface. Where the summed standing wave |u| is large the
// surface throws them into the air; where u is near zero (the nodal lines) they come to rest.
// Every sounding note is one Slot; its mode parameters mean different things per vessel:
//
//   plate   p0 = (n, m, s, -)          u = cos(nπX)cos(mπZ) + s·cos(mπX)cos(nπZ), X,Z ∈ [0,1]
//   drum    p0 = (nA, kA, nB, kB)      u = J_nA(kA·r)cos(nA·θ) + mix·J_nB(kB·r)cos(nB·θ + rot)
//           p1 = (mix, rot, -, norm)
//   sphere  p0 = (m1, m2, mix, rot)    u = P̄(l,m1)(θ)cos(m1·φ) + mix·P̄(l,m2)(θ)cos(m2·φ + rot)
//           p1 = (table1, table2, l, norm)
//   lattice p0 = (family, k, phase, -) u = TPMS(k·R·p + phase)
//           p1 = (rotA, rotB, -, norm)
//
// These mirror evaluateRawMode() in src/resonance/vessels.ts; change both together.
// BESSEL_SAMPLES, BESSEL_X_MAX, LEGENDRE_SAMPLES, MAX_SLOTS and RIM_FRACTION are prepended by
// particle-system.ts.

const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;

struct Slot {
  p0: vec4f,
  p1: vec4f,
  color: vec4f, // rgb linear, w = amplitude
};

struct SimParams {
  clock: vec4f,          // time, dt, morph progress (1 = settled), onset agitation
  counts: vec4u,         // particle count, vessel, slot count, generation
  frame: vec4u,          // frame index, -, -, -
  physics: vec4f,        // hop rate (1/s), hop speed, lateral speed, gravity
  physics2: vec4f,       // slide, lattice kick, lattice damping, color rate (1/s)
  pointer: vec4f,        // world hit xyz, strength
  pointerMotion: vec4f,  // world velocity xyz, radius
  slots: array<Slot, MAX_SLOTS>,
};

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> colors: array<u32>;
@group(0) @binding(4) var<storage, read> tables: array<f32>;

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn rand(state: ptr<function, u32>) -> f32 {
  *state = pcg(*state);
  return f32(*state) * (1.0 / 4294967296.0);
}

fn randUnit3(state: ptr<function, u32>) -> vec3f {
  let y = rand(state) * 2.0 - 1.0;
  let a = rand(state) * TAU;
  let s = sqrt(max(0.0, 1.0 - y * y));
  return vec3f(s * cos(a), y, s * sin(a));
}

fn lookup(base: u32, samples: u32, t: f32) -> f32 {
  let x = clamp(t, 0.0, 1.0) * f32(samples - 1u);
  let i0 = u32(floor(x));
  let i1 = min(i0 + 1u, samples - 1u);
  return mix(tables[base + i0], tables[base + i1], x - f32(i0));
}

fn besselJ(n: f32, x: f32) -> f32 {
  return lookup(u32(n) * BESSEL_SAMPLES, BESSEL_SAMPLES, x / BESSEL_X_MAX);
}

fn tpms(family: u32, q: vec3f) -> f32 {
  let c = cos(q);
  let s = sin(q);
  switch family {
    case 1u: { return c.x + c.y + c.z; }
    case 2u: { return s.x * s.y * s.z + s.x * c.y * c.z + c.x * s.y * c.z + c.x * c.y * s.z; }
    case 3u: {
      let c2 = cos(2.0 * q);
      return 2.0 * (c.x * c.y + c.y * c.z + c.z * c.x) - (c2.x + c2.y + c2.z);
    }
    case 4u: { return 3.0 * (c.x + c.y + c.z) + 4.0 * c.x * c.y * c.z; }
    case 5u: {
      let c2 = cos(2.0 * q);
      return c2.x * s.y * c.z + c.x * c2.y * s.z + s.x * c.y * c2.z;
    }
    default: { return s.x * c.y + s.y * c.z + s.z * c.x; }
  }
}

fn modeValue(vessel: u32, slot: Slot, p: vec3f) -> f32 {
  let a = slot.p0;
  let b = slot.p1;
  switch vessel {
    case 0u: {
      let X = (p.x + 1.0) * 0.5 * PI;
      let Z = (p.z + 1.0) * 0.5 * PI;
      return cos(a.x * X) * cos(a.y * Z) + a.z * cos(a.y * X) * cos(a.x * Z);
    }
    case 1u: {
      let r = length(p.xz);
      let th = atan2(p.z, p.x);
      return besselJ(a.x, a.y * r) * cos(a.x * th) + b.x * besselJ(a.z, a.w * r) * cos(a.z * th + b.y);
    }
    case 2u: {
      let d = normalize(p);
      let t = acos(clamp(d.y, -1.0, 1.0)) / PI;
      let ph = atan2(d.z, d.x);
      let l1 = lookup(u32(b.x), LEGENDRE_SAMPLES, t);
      let l2 = lookup(u32(b.y), LEGENDRE_SAMPLES, t);
      return l1 * cos(a.x * ph) + a.z * l2 * cos(a.y * ph + a.w);
    }
    default: {
      let ca = cos(b.x);
      let sa = sin(b.x);
      let y1 = p.y * ca - p.z * sa;
      let z1 = p.y * sa + p.z * ca;
      let cb = cos(b.y);
      let sb = sin(b.y);
      let q = vec3f(p.x * cb + z1 * sb, y1, -p.x * sb + z1 * cb);
      return tpms(u32(a.x), q * a.y + vec3f(a.z));
    }
  }
}

fn field(vessel: u32, p: vec3f) -> f32 {
  var u = 0.0;
  for (var k = 0u; k < P.counts.z; k++) {
    let slot = P.slots[k];
    u += slot.color.w * slot.p1.w * modeValue(vessel, slot, p);
  }
  return u;
}

fn sampleVessel(vessel: u32, h: vec3f) -> vec3f {
  switch vessel {
    case 0u: { return vec3f(h.x * 2.0 - 1.0, 0.0, h.y * 2.0 - 1.0); }
    case 1u: {
      let r = sqrt(h.x);
      let a = h.y * TAU;
      return vec3f(r * cos(a), 0.0, r * sin(a));
    }
    case 2u: {
      let y = h.x * 2.0 - 1.0;
      let s = sqrt(max(0.0, 1.0 - y * y));
      let a = h.y * TAU;
      return vec3f(s * cos(a), y, s * sin(a));
    }
    default: {
      let y = h.x * 2.0 - 1.0;
      let s = sqrt(max(0.0, 1.0 - y * y));
      let a = h.y * TAU;
      return vec3f(s * cos(a), y, s * sin(a)) * pow(h.z, 1.0 / 3.0) * 0.985;
    }
  }
}

// A point on the edge of a flat vessel, t ∈ [0, 1) around the perimeter, just outside the sand.
fn rimPoint(vessel: u32, t: f32) -> vec3f {
  let edge = 1.014;
  if (vessel == 1u) {
    let a = t * TAU;
    return vec3f(cos(a), 0.0, sin(a)) * edge;
  }
  let s = t * 4.0;
  let f = (fract(s) * 2.0 - 1.0) * edge;
  switch u32(s) {
    case 0u: { return vec3f(f, 0.0, -edge); }
    case 1u: { return vec3f(edge, 0.0, f); }
    case 2u: { return vec3f(-f, 0.0, edge); }
    default: { return vec3f(-edge, 0.0, -f); }
  }
}

// Divergence-free swirl: each component ignores its own axis.
fn flow(p: vec3f, t: f32) -> vec3f {
  return vec3f(
    sin(p.y * 2.1 + t * 0.9) + sin(p.z * 3.3 - t * 0.6),
    sin(p.z * 1.9 - t * 0.7) + sin(p.x * 2.7 + t * 0.5),
    sin(p.x * 2.3 + t * 0.8) + sin(p.y * 3.1 - t * 0.4),
  );
}

@compute @workgroup_size(256)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.counts.x) { return; }

  let time = P.clock.x;
  let dt = P.clock.y;
  let vessel = P.counts.y;
  var rng = pcg(i ^ pcg(P.frame.x * 0x9E3779B9u + 17u));

  let p4 = positions[i];
  var p = p4.xyz;
  let seed = p4.w;
  let v4 = velocities[i];
  var v = v4.xyz;
  var energy = v4.w;
  var color = unpack4x8unorm(colors[i]);

  // A sliver of the grains trace the edge of a flat vessel instead of playing sand.
  let isRim = vessel <= 1u && seed < RIM_FRACTION;
  let rim = rimPoint(vessel, fract(seed * 7919.31));

  // Vessel change: fly to a fresh uniform sample of the new resonator, staggered by seed.
  let morph = P.clock.z;
  let delay = fract(seed * 7.137) * 0.42;
  let flight = clamp((morph - delay) / 0.58, 0.0, 1.0);
  if (flight < 1.0) {
    let h = vec3f(
      f32(pcg(i * 3u + P.counts.w * 0x9E3779B9u)),
      f32(pcg(i * 3u + 1u + P.counts.w * 0x85EBCA6Bu)),
      f32(pcg(i * 3u + 2u + P.counts.w * 0xC2B2AE35u)),
    ) * (1.0 / 4294967296.0);
    let destination = select(sampleVessel(vessel, h), rim, isRim);
    let pull = mix(1.5, 26.0, flight * flight);
    v += ((destination - p) * pull - v * 3.2 + flow(p * 1.3, time) * 1.1 * (1.0 - flight)) * dt;
    p += v * dt;
    p = mix(p, destination, smoothstep(0.8, 1.0, flight) * 0.25);
    energy = mix(energy, 0.55, 0.05);
    positions[i] = vec4f(p, seed);
    velocities[i] = vec4f(v, energy);
    return;
  }
  if (isRim) {
    positions[i] = vec4f(rim, seed);
    velocities[i] = vec4f(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Standing-wave field at the grain, with each note's share for painting.
  var u = 0.0;
  var paint = vec3f(0.0);
  var paintWeight = 0.0;
  for (var k = 0u; k < P.counts.z; k++) {
    let slot = P.slots[k];
    let c = slot.color.w * slot.p1.w * modeValue(vessel, slot, p);
    u += c;
    paint += slot.color.rgb * abs(c);
    paintWeight += abs(c);
  }
  let a = min(abs(u), 1.5);
  let e = 0.0025;
  var grad = vec3f(0.0);
  if (P.counts.z > 0u) {
    grad.x = (field(vessel, p + vec3f(e, 0.0, 0.0)) - u) / e;
    grad.z = (field(vessel, p + vec3f(0.0, 0.0, e)) - u) / e;
    if (vessel >= 2u) {
      grad.y = (field(vessel, p + vec3f(0.0, e, 0.0)) - u) / e;
    }
  }
  // Newton step toward the nearest nodal line/surface (Δp = −u∇u/|∇u|²), as a velocity. It moves
  // grains at a rate set by distance-to-node, independent of how fine the figure is.
  var slide = -u * grad / (dot(grad, grad) + 1e-3) * P.physics2.x;
  let slideLength = length(slide);
  if (slideLength > 0.35) { slide *= 0.35 / slideLength; }

  let hopRate = P.physics.x;
  let hopSpeed = P.physics.y;
  let lateral = P.physics.z;
  let gravity = P.physics.w;
  // A note onset jolts the whole surface: every grain may leap, and farther than the standing
  // wave alone would throw it, so the new mode sorts fresh sand instead of nudging the old figure.
  let shake = P.clock.w;
  let drive = max(a, shake * 0.9);
  let spread = a + shake * 2.4;
  let launch = 1.0 - exp(-hopRate * dt * smoothstep(0.015, 0.7, drive) * (1.0 + shake * 1.5));
  var airborne = false;

  if (vessel <= 1u) {
    // Flat vessels: y is height above the surface.
    airborne = p.y > 0.0001;
    if (!airborne) {
      if (rand(&rng) < launch) {
        let ang = rand(&rng) * TAU;
        let sp = spread * lateral * (0.25 + 0.75 * rand(&rng));
        v = vec3f(cos(ang) * sp, drive * hopSpeed * (0.3 + 0.7 * rand(&rng)), sin(ang) * sp);
      } else {
        v = vec3f(v.x * 0.6 + slide.x * 0.4, 0.0, v.z * 0.6 + slide.z * 0.4);
      }
    }
    v.y -= gravity * dt;
  } else if (vessel == 2u) {
    // Sphere: height is radial distance above the shell.
    let n = normalize(p);
    var vr = dot(v, n);
    var vt = v - n * vr;
    airborne = length(p) > 1.0001;
    if (!airborne) {
      if (rand(&rng) < launch) {
        let t = normalize(cross(n, randUnit3(&rng)) + vec3f(1e-5));
        vt = t * spread * lateral * (0.25 + 0.75 * rand(&rng));
        vr = drive * hopSpeed * (0.3 + 0.7 * rand(&rng));
      } else {
        vt = vt * 0.6 + (slide - n * dot(slide, n)) * 0.4;
        vr = 0.0;
      }
    }
    vr -= gravity * dt;
    v = n * vr + vt;
  } else {
    // Lattice: grains diffuse through the volume and are trapped on the nodal surface.
    let kick = P.physics2.y * sqrt(dt * 60.0);
    let jolt = max(a, shake * 1.4);
    v = v * pow(P.physics2.z, dt * 60.0) + randUnit3(&rng) * jolt * kick + slide * P.physics2.z * 0.12;
  }

  // A moving pointer stirs the grains like a fingertip through sand.
  if (P.pointer.w > 0.0) {
    let d = p - P.pointer.xyz;
    let dist = length(d);
    let radius = P.pointerMotion.w;
    if (dist < radius) {
      let f = 1.0 - dist / radius;
      let push = P.pointerMotion.xyz * 0.9 + normalize(d + vec3f(1e-5)) * 0.35;
      v += push * f * f * P.pointer.w;
      if (vessel <= 1u) {
        v.y += f * f * P.pointer.w * 0.9;
        p.y = max(p.y, 0.0002);
      }
      energy = max(energy, f * P.pointer.w * 0.6);
    }
  }

  p += v * dt;

  let landing = select(1.0, 0.4, airborne);
  switch vessel {
    case 0u: {
      if (p.y < 0.0) { p.y = 0.0; v = vec3f(v.x * landing, 0.0, v.z * landing); }
      if (abs(p.x) > 1.0) { p.x = sign(p.x) * (2.0 - abs(p.x)); v.x = -v.x * 0.3; }
      if (abs(p.z) > 1.0) { p.z = sign(p.z) * (2.0 - abs(p.z)); v.z = -v.z * 0.3; }
      p.x = clamp(p.x, -1.0, 1.0);
      p.z = clamp(p.z, -1.0, 1.0);
    }
    case 1u: {
      if (p.y < 0.0) { p.y = 0.0; v = vec3f(v.x * landing, 0.0, v.z * landing); }
      let r = length(p.xz);
      if (r > 1.0) {
        let n = p.xz / r;
        p = vec3f(n.x * (2.0 - r), p.y, n.y * (2.0 - r));
        let vn = dot(v.xz, n);
        v = vec3f(v.x - n.x * vn * 1.3, v.y, v.z - n.y * vn * 1.3);
      }
      let r2 = length(p.xz);
      if (r2 > 1.0) { p = vec3f(p.x / r2, p.y, p.z / r2); }
    }
    case 2u: {
      let r = length(p);
      let n = p / max(r, 1e-5);
      if (r < 1.0) {
        p = n;
        v = (v - n * dot(v, n)) * landing;
      }
    }
    default: {
      let r = length(p);
      if (r > 1.0) {
        let n = p / r;
        p = n * max(2.0 - r, 0.0);
        v -= n * max(dot(v, n), 0.0) * 1.6;
      }
    }
  }

  energy = mix(energy, a, 1.0 - exp(-dt * 5.0));

  if (paintWeight > 1e-4) {
    let rate = clamp(a * P.physics2.w * dt, 0.0, 1.0);
    let dither = vec4f(rand(&rng), rand(&rng), rand(&rng), 0.0) - vec4f(0.5, 0.5, 0.5, 0.0);
    color = vec4f(mix(color.rgb, paint / paintWeight, rate), 1.0) + dither / 255.0;
    colors[i] = pack4x8unorm(color);
  }

  positions[i] = vec4f(p, seed);
  velocities[i] = vec4f(v, energy);
}
