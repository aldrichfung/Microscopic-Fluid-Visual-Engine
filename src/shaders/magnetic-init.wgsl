struct MagneticParams {
  grid: vec2<u32>,
  texel: vec2<f32>,
  fieldPosition: vec2<f32>,
  delta: f32,
  interfaceTension: f32,
  separation: f32,
  coarsening: f32,
  magneticStrength: f32,
  patternScale: f32,
  mobility: f32,
  seed: u32,
  initialPattern: u32,
  time: f32,
};

@group(0) @binding(0) var<uniform> params: MagneticParams;
@group(0) @binding(1) var destination: texture_storage_2d<r32float, write>;

fn random(pixel: u32) -> f32 {
  var value = pixel + params.seed * 747796405u;
  value = (value ^ (value >> 16u)) * 2246822519u;
  value = (value ^ (value >> 13u)) * 3266489917u;
  value = value ^ (value >> 16u);
  return f32(value) * 2.3283064365386963e-10;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(params.grid);
  let noise = random(id.x + id.y * params.grid.x) - 0.5;
  let frequency = 6.28318530718 / max(params.patternScale, 0.005);
  var shape = noise;

  switch params.initialPattern {
    case 0u: {
      shape = sin((uv.x + 0.12 * sin(uv.y * 6.28318530718)) * frequency) + noise * 0.35;
    }
    case 1u: {
      shape = (params.patternScale * 2.2 - length(uv - vec2<f32>(0.5))) * frequency + noise * 0.15;
    }
    default: {
      shape = noise + 0.3 * sin(uv.x * frequency) * cos(uv.y * frequency * 0.83);
    }
  }

  let phase = clamp(shape * 1.8, -1.0, 1.0);
  textureStore(destination, coordinate, vec4<f32>(phase, 0.0, 0.0, 0.0));
}
