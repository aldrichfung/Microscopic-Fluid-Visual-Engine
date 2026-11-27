struct SimulationParams {
  grid: vec2<u32>,
  texel: vec2<f32>,
  delta: f32,
  dissipation: f32,
  padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var destination: texture_storage_2d<rgba16float, write>;

fn loadClamped(tex: texture_2d<f32>, coordinate: vec2<i32>) -> vec4<f32> {
  let maximum = vec2<i32>(params.grid) - vec2<i32>(1);
  return textureLoad(tex, clamp(coordinate, vec2<i32>(0), maximum), 0);
}

fn sampleBilinear(tex: texture_2d<f32>, gridPosition: vec2<f32>) -> vec4<f32> {
  let coordinate = gridPosition - vec2<f32>(0.5);
  let base = vec2<i32>(floor(coordinate));
  let fraction = fract(coordinate);
  let a = mix(loadClamped(tex, base), loadClamped(tex, base + vec2<i32>(1, 0)), fraction.x);
  let b = mix(loadClamped(tex, base + vec2<i32>(0, 1)), loadClamped(tex, base + vec2<i32>(1, 1)), fraction.x);
  return mix(a, b, fraction.y);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let gridPosition = vec2<f32>(id.xy) + vec2<f32>(0.5);
  let currentVelocity = loadClamped(velocity, coordinate).xy;
  let previousPosition = gridPosition - currentVelocity * params.delta / params.texel;
  let attenuation = max(0.0, 1.0 - params.dissipation * params.delta);
  textureStore(destination, coordinate, sampleBilinear(source, previousPosition) * attenuation);
}
