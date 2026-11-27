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
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var destination: texture_storage_2d<r32float, write>;

fn phaseAt(coordinate: vec2<i32>) -> f32 {
  let maximum = vec2<i32>(params.grid) - vec2<i32>(1);
  return textureLoad(source, clamp(coordinate, vec2<i32>(0), maximum), 0).x;
}

fn ringAverage(coordinate: vec2<i32>, radius: f32) -> f32 {
  var total = 0.0;
  for (var index = 0u; index < 8u; index += 1u) {
    let angle = f32(index) * 0.78539816339;
    let offset = vec2<i32>(vec2<f32>(cos(angle), sin(angle)) * radius);
    total += phaseAt(coordinate + offset);
  }
  return total * 0.125;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let phase = clamp(phaseAt(coordinate), -1.25, 1.25);
  let left = phaseAt(coordinate - vec2<i32>(1, 0));
  let right = phaseAt(coordinate + vec2<i32>(1, 0));
  let top = phaseAt(coordinate - vec2<i32>(0, 1));
  let bottom = phaseAt(coordinate + vec2<i32>(0, 1));
  let laplacian = left + right + top + bottom - 4.0 * phase;

  let radius = max(2.0, f32(min(params.grid.x, params.grid.y)) * params.patternScale * 0.35);
  let outer = ringAverage(coordinate, radius);
  let inner = ringAverage(coordinate, radius * 0.5);
  let nonlocalPhase = mix(inner, outer, 0.65);
  let doubleWell = phase * (phase * phase - 1.0);

  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(params.grid);
  let fieldOffset = (uv - params.fieldPosition) / max(params.patternScale * 2.5, 0.02);
  let fieldFalloff = exp(-dot(fieldOffset, fieldOffset));
  let magneticDrive = params.magneticStrength * fieldFalloff * (0.35 + 0.65 * (nonlocalPhase * 0.5 + 0.5));
  let drive = params.interfaceTension * laplacian
    - params.separation * doubleWell
    + params.coarsening * (nonlocalPhase - phase)
    + magneticDrive;
  let nextPhase = clamp(phase + params.mobility * params.delta * drive, -1.5, 1.5);
  textureStore(destination, coordinate, vec4<f32>(nextPhase, 0.0, 0.0, 0.0));
}
