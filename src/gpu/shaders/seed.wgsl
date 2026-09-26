// Initial grain layout: a thin spiral nebula, which the first vessel morph gathers onto the plate.
// Shares SimParams and bindings with simulate.wgsl (concatenated before compilation).

@compute @workgroup_size(256)
fn seed(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.counts.x) { return; }
  var rng = pcg(i * 2654435761u + P.frame.x);
  let s = rand(&rng);
  let arm = floor(rand(&rng) * 3.0);
  let r = 0.15 + pow(rand(&rng), 0.6) * 2.4;
  let spread = (rand(&rng) - 0.5) * 0.9 / (0.6 + r);
  let a = arm * TAU / 3.0 + r * 1.7 + spread;
  let y = (rand(&rng) + rand(&rng) + rand(&rng) - 1.5) * 0.09 * (1.2 - r * 0.25);
  positions[i] = vec4f(r * cos(a), y + 0.25, r * sin(a), s);
  velocities[i] = vec4f(-sin(a) * 0.35, 0.0, cos(a) * 0.35, 0.0);
  colors[i] = pack4x8unorm(vec4f(0.78, 0.71, 0.58, 1.0));
}
