struct InjectionParams {
  grid: vec2<u32>,
  position: vec2<f32>,
  radius: f32,
  delta: f32,
  color: vec4<f32>,
  impulse: vec2<f32>,
  strength: f32,
  enabled: f32,
};

@group(0) @binding(0) var<uniform> params: InjectionParams;
@group(0) @binding(1) var sourceDye: texture_2d<f32>;
@group(0) @binding(2) var sourceVelocity: texture_2d<f32>;
@group(0) @binding(3) var destinationDye: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var destinationVelocity: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let dye = textureLoad(sourceDye, coordinate, 0);
  let velocity = textureLoad(sourceVelocity, coordinate, 0);
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(params.grid);
  let offset = (uv - params.position) / max(params.radius, 0.0001);
  let falloff = exp(-dot(offset, offset) * 2.5) * params.enabled;
  let amount = params.strength * params.delta * falloff;
  let nextDye = clamp(dye + vec4<f32>(params.color.rgb * amount, amount), vec4<f32>(0.0), vec4<f32>(8.0));
  let nextVelocity = vec4<f32>(velocity.xy + params.impulse * amount, 0.0, 0.0);
  textureStore(destinationDye, coordinate, nextDye);
  textureStore(destinationVelocity, coordinate, nextVelocity);
}
