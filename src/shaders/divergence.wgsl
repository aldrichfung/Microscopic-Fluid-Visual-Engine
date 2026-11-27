struct SimulationParams {
  grid: vec2<u32>,
  texel: vec2<f32>,
  delta: f32,
  dissipation: f32,
  padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var velocity: texture_2d<f32>;
@group(0) @binding(2) var destination: texture_storage_2d<r32float, write>;

fn velocityAt(coordinate: vec2<i32>) -> vec2<f32> {
  let maximum = vec2<i32>(params.grid) - vec2<i32>(1);
  return textureLoad(velocity, clamp(coordinate, vec2<i32>(0), maximum), 0).xy;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let left = velocityAt(coordinate - vec2<i32>(1, 0)).x;
  let right = velocityAt(coordinate + vec2<i32>(1, 0)).x;
  let top = velocityAt(coordinate - vec2<i32>(0, 1)).y;
  let bottom = velocityAt(coordinate + vec2<i32>(0, 1)).y;
  let divergence = 0.5 * ((right - left) / params.texel.x + (bottom - top) / params.texel.y);
  textureStore(destination, coordinate, vec4<f32>(divergence, 0.0, 0.0, 0.0));
}
