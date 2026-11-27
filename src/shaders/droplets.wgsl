struct DropletParams {
  grid: vec2<u32>,
  count: u32,
  membraneStrength: f32,
  rimSharpness: f32,
  delta: f32,
  time: f32,
  padding: f32,
};

struct Droplet {
  position: vec2<f32>,
  velocity: vec2<f32>,
  radius: f32,
  opticalThickness: f32,
  refractiveIndex: f32,
  mobility: f32,
};

@group(0) @binding(0) var<uniform> params: DropletParams;
@group(0) @binding(1) var<storage, read> droplets: array<Droplet>;
@group(0) @binding(2) var destination: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(params.grid);
  var coverage = 0.0;
  var membrane = 0.0;
  var thickness = 0.0;
  var refraction = 0.0;

  for (var index = 0u; index < params.count; index += 1u) {
    let droplet = droplets[index];
    var offset = uv - droplet.position;
    offset -= round(offset);
    let distance = length(offset) / max(droplet.radius, 0.0001);
    let localCoverage = 1.0 - smoothstep(0.94, 1.0, distance);
    let localRim = exp(-abs(distance - 1.0) * params.rimSharpness * 0.12)
      * (1.0 - smoothstep(0.85, 1.15, distance))
      * params.membraneStrength;
    let localThickness = sqrt(max(0.0, 1.0 - distance * distance))
      * droplet.opticalThickness * localCoverage;
    coverage = max(coverage, localCoverage);
    membrane = max(membrane, localRim);
    thickness += localThickness;
    refraction = max(refraction, (droplet.refractiveIndex - 1.0) * 0.5 * localCoverage);
  }

  textureStore(
    destination,
    vec2<i32>(id.xy),
    vec4<f32>(coverage, membrane, thickness, refraction),
  );
}
