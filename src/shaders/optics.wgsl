struct OpticsParams {
  grid: vec2<u32>,
  padding: vec2<f32>,
  absorption: vec3<f32>,
  exposure: f32,
  specularStrength: f32,
  darkFieldStrength: f32,
  time: f32,
  interferenceStrength: f32,
  interferenceScale: f32,
  rimSharpness: f32,
  magneticEnabled: f32,
  reserved: f32,
  darkColor: vec4<f32>,
  luminousColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: OpticsParams;
@group(0) @binding(1) var dye: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var height: texture_2d<f32>;
@group(0) @binding(4) var phase: texture_2d<f32>;
@group(0) @binding(5) var droplets: texture_2d<f32>;
@group(0) @binding(6) var destination: texture_storage_2d<rgba16float, write>;

fn safeCoordinate(coordinate: vec2<i32>) -> vec2<i32> {
  return clamp(coordinate, vec2<i32>(0), vec2<i32>(params.grid) - vec2<i32>(1));
}

fn densityAt(coordinate: vec2<i32>) -> f32 {
  let safe = safeCoordinate(coordinate);
  let magneticDensity = params.magneticEnabled * smoothstep(-0.2, 0.25, textureLoad(phase, safe, 0).x);
  let dropletThickness = textureLoad(droplets, safe, 0).z;
  return textureLoad(dye, safe, 0).a
    + textureLoad(height, safe, 0).x
    + magneticDensity
    + dropletThickness;
}

fn dropletThicknessAt(coordinate: vec2<i32>) -> f32 {
  return textureLoad(droplets, safeCoordinate(coordinate), 0).z;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let droplet = textureLoad(droplets, coordinate, 0);
  let dropletGradient = vec2<f32>(
    dropletThicknessAt(coordinate + vec2<i32>(1, 0)) - dropletThicknessAt(coordinate - vec2<i32>(1, 0)),
    dropletThicknessAt(coordinate + vec2<i32>(0, 1)) - dropletThicknessAt(coordinate - vec2<i32>(0, 1)),
  );
  let refractionOffset = vec2<i32>(-dropletGradient * droplet.w * 18.0);
  let sample = textureLoad(dye, safeCoordinate(coordinate + refractionOffset), 0);
  let density = max(sample.a, 0.0);
  let pigment = sample.rgb / max(density, 0.0001);
  let gradient = vec2<f32>(
    densityAt(coordinate + vec2<i32>(1, 0)) - densityAt(coordinate - vec2<i32>(1, 0)),
    densityAt(coordinate + vec2<i32>(0, 1)) - densityAt(coordinate - vec2<i32>(0, 1)),
  );
  let normal = normalize(vec3<f32>(-gradient * 7.0, 1.0));
  let lightDirection = normalize(vec3<f32>(-0.45, 0.55, 0.8));
  let halfDirection = normalize(lightDirection + vec3<f32>(0.0, 0.0, 1.0));
  let specular = pow(max(dot(normal, halfDirection), 0.0), 48.0)
    * params.specularStrength * (density + droplet.x + droplet.y);

  let phaseValue = textureLoad(phase, coordinate, 0).x;
  let magneticMask = smoothstep(-0.12, 0.18, phaseValue) * params.magneticEnabled;
  let magneticRim = exp(-abs(phaseValue) * params.rimSharpness) * params.magneticEnabled;
  let magneticColor = mix(params.darkColor.rgb, params.luminousColor.rgb, magneticMask);
  let totalDensity = density + magneticMask * 0.65 + droplet.z * 0.35;
  let transmission = exp(-params.absorption * totalDensity * 0.35);
  let darkField = length(gradient) * params.darkFieldStrength;
  let motionTint = textureLoad(velocity, coordinate, 0).xy * 0.015;
  let interference = 0.5 + 0.5 * cos(
    6.28318530718 * (droplet.z * params.interferenceScale + vec3<f32>(0.0, 0.33, 0.67))
  );

  var color = pigment * transmission * density;
  color += magneticColor * transmission * magneticMask;
  color += params.luminousColor.rgb * magneticRim * (0.18 + params.darkFieldStrength * 0.35);
  color += interference * droplet.x * params.interferenceStrength * transmission;
  color += vec3<f32>(darkField + specular + droplet.y * (0.2 + params.specularStrength * 0.35));
  color += vec3<f32>(motionTint.x, motionTint.y, -motionTint.x) * density;
  color = vec3<f32>(1.0) - exp(-max(color, vec3<f32>(0.0)) * params.exposure);
  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  textureStore(destination, coordinate, vec4<f32>(color, 1.0));
}
