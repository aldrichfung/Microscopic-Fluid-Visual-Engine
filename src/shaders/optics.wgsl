struct OpticsParams {
  grid: vec2<u32>,
  absorption: vec3<f32>,
  exposure: f32,
  specularStrength: f32,
  darkFieldStrength: f32,
  time: f32,
  padding: f32,
};

@group(0) @binding(0) var<uniform> params: OpticsParams;
@group(0) @binding(1) var dye: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var height: texture_2d<f32>;
@group(0) @binding(4) var destination: texture_storage_2d<rgba16float, write>;

fn densityAt(coordinate: vec2<i32>) -> f32 {
  let maximum = vec2<i32>(params.grid) - vec2<i32>(1);
  let safeCoordinate = clamp(coordinate, vec2<i32>(0), maximum);
  return textureLoad(dye, safeCoordinate, 0).a + textureLoad(height, safeCoordinate, 0).x;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let sample = textureLoad(dye, coordinate, 0);
  let density = max(sample.a, 0.0);
  let pigment = sample.rgb / max(density, 0.0001);
  let gradient = vec2<f32>(
    densityAt(coordinate + vec2<i32>(1, 0)) - densityAt(coordinate - vec2<i32>(1, 0)),
    densityAt(coordinate + vec2<i32>(0, 1)) - densityAt(coordinate - vec2<i32>(0, 1)),
  );
  let normal = normalize(vec3<f32>(-gradient * 7.0, 1.0));
  let lightDirection = normalize(vec3<f32>(-0.45, 0.55, 0.8));
  let halfDirection = normalize(lightDirection + vec3<f32>(0.0, 0.0, 1.0));
  let specular = pow(max(dot(normal, halfDirection), 0.0), 48.0) * params.specularStrength * density;
  let transmission = exp(-params.absorption * density * 0.35);
  let darkField = length(gradient) * params.darkFieldStrength;
  let motionTint = textureLoad(velocity, coordinate, 0).xy * 0.015;
  var color = pigment * transmission * density + vec3<f32>(darkField + specular);
  color += vec3<f32>(motionTint.x, motionTint.y, -motionTint.x) * density;
  color = vec3<f32>(1.0) - exp(-max(color, vec3<f32>(0.0)) * params.exposure);
  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  textureStore(destination, coordinate, vec4<f32>(color, 1.0));
}
