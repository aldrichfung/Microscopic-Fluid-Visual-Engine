struct SimulationParams {
  grid: vec2<u32>,
  texel: vec2<f32>,
  delta: f32,
  dissipation: f32,
  padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var pressure: texture_2d<f32>;
@group(0) @binding(2) var divergence: texture_2d<f32>;
@group(0) @binding(3) var destination: texture_storage_2d<r32float, write>;

fn pressureAt(coordinate: vec2<i32>) -> f32 {
  let maximum = vec2<i32>(params.grid) - vec2<i32>(1);
  return textureLoad(pressure, clamp(coordinate, vec2<i32>(0), maximum), 0).x;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let neighbors = pressureAt(coordinate - vec2<i32>(1, 0))
    + pressureAt(coordinate + vec2<i32>(1, 0))
    + pressureAt(coordinate - vec2<i32>(0, 1))
    + pressureAt(coordinate + vec2<i32>(0, 1));
  let divergenceValue = textureLoad(divergence, coordinate, 0).x;
  let cellArea = params.texel.x * params.texel.y;
  textureStore(destination, coordinate, vec4<f32>((neighbors - divergenceValue * cellArea) * 0.25, 0.0, 0.0, 0.0));
}
