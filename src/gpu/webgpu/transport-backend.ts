import type { EngineBackend, ShaderLibrary } from "../interfaces.js";
import type { InjectionSource, Project, TransportLayer } from "../../core/project.js";
import type { SimulationContext } from "../../core/scheduler.js";
import { ComputeProgram, makeUniformBuffer } from "./compute.js";
import { WebGpuFieldSet } from "./fields.js";

/** First executable GPU backend: injection, transport, pressure projection, and optics. */
export class WebGpuTransportBackend implements EngineBackend {
  public readonly kind = "webgpu" as const;

  private readonly programs: Record<keyof ShaderLibrary, ComputeProgram>;
  private readonly velocityParams: GPUBuffer;
  private readonly dyeParams: GPUBuffer;
  private readonly opticsParams: GPUBuffer;
  private readonly injectionParams = new Map<string, GPUBuffer>();
  private fields: WebGpuFieldSet | undefined;
  private velocityPingPong = false;
  private dyePingPong = false;
  private pressurePingPong = false;

  public constructor(
    private readonly device: GPUDevice,
    shaders: ShaderLibrary,
  ) {
    this.programs = {
      inject: new ComputeProgram(device, "inject", shaders.inject),
      advect: new ComputeProgram(device, "advect", shaders.advect),
      divergence: new ComputeProgram(device, "divergence", shaders.divergence),
      pressure: new ComputeProgram(device, "pressure", shaders.pressure),
      project: new ComputeProgram(device, "project", shaders.project),
      optics: new ComputeProgram(device, "optics", shaders.optics),
    };
    this.velocityParams = makeUniformBuffer(device, "mfve:velocity-params", 32);
    this.dyeParams = makeUniformBuffer(device, "mfve:dye-params", 32);
    this.opticsParams = makeUniformBuffer(device, "mfve:optics-params", 48);
  }

  public initialize(project: Project): Promise<void> {
    this.fields?.destroy();
    this.fields = new WebGpuFieldSet(this.device, project.grid);
    this.reset(project);
    return Promise.resolve();
  }

  public reset(_project: Project): void {
    this.requireFields().clear();
    this.velocityPingPong = false;
    this.dyePingPong = false;
    this.pressurePingPong = false;
  }

  public resize(gridWidth: number, gridHeight: number): void {
    const fields = this.requireFields();
    fields.resize({ width: gridWidth, height: gridHeight });
    fields.clear();
  }

  public step(context: SimulationContext, project: Project): void {
    const fields = this.requireFields();
    const layer = project.layers.find(
      (candidate): candidate is TransportLayer => candidate.kind === "transport" && candidate.enabled,
    );
    if (!layer) return;

    this.device.queue.writeBuffer(
      this.velocityParams,
      0,
      simulationParameters(project, context.deltaSeconds, layer.velocityDissipation),
    );
    this.device.queue.writeBuffer(
      this.dyeParams,
      0,
      simulationParameters(project, context.deltaSeconds, layer.dyeDissipation),
    );
    this.device.queue.writeBuffer(this.opticsParams, 0, opticalParameters(project, context));

    const encoder = this.device.createCommandEncoder({ label: "mfve:transport-step" });
    const pass = encoder.beginComputePass({ label: "mfve:transport-passes" });

    for (const source of activeSources(layer, context.simulationTimeSeconds)) {
      this.encodeInjection(pass, fields, source, context.deltaSeconds);
    }
    this.encodeTransport(pass, fields, layer.pressureIterations);
    this.encodeOptics(pass, fields);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public opticalTarget(): GPUTextureView {
    return this.requireFields().get("optical-target").view;
  }

  public destroy(): void {
    this.fields?.destroy();
    this.fields = undefined;
    this.velocityParams.destroy();
    this.dyeParams.destroy();
    this.opticsParams.destroy();
    for (const buffer of this.injectionParams.values()) buffer.destroy();
    this.injectionParams.clear();
  }

  private encodeInjection(
    pass: GPUComputePassEncoder,
    fields: WebGpuFieldSet,
    source: InjectionSource,
    deltaSeconds: number,
  ): void {
    let buffer = this.injectionParams.get(source.id);
    if (!buffer) {
      buffer = makeUniformBuffer(this.device, `mfve:injection:${source.id}`, 64);
      this.injectionParams.set(source.id, buffer);
    }
    this.device.queue.writeBuffer(buffer, 0, injectionParameters(fields.size, source, deltaSeconds));

    const dye = this.dyeName();
    const velocity = this.velocityName();
    const bindGroup = this.bindGroup(this.programs.inject, [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: fields.get(dye).view },
      { binding: 2, resource: fields.get(velocity).view },
      { binding: 3, resource: fields.get(opposite(dye)).view },
      { binding: 4, resource: fields.get(opposite(velocity)).view },
    ]);
    this.programs.inject.encode(pass, bindGroup, fields.size.width, fields.size.height);
    this.dyePingPong = !this.dyePingPong;
    this.velocityPingPong = !this.velocityPingPong;
  }

  private encodeTransport(
    pass: GPUComputePassEncoder,
    fields: WebGpuFieldSet,
    pressureIterations: number,
  ): void {
    const { width, height } = fields.size;

    let velocity = this.velocityName();
    let bindGroup = this.bindGroup(this.programs.advect, [
      { binding: 0, resource: { buffer: this.velocityParams } },
      { binding: 1, resource: fields.get(velocity).view },
      { binding: 2, resource: fields.get(velocity).view },
      { binding: 3, resource: fields.get(opposite(velocity)).view },
    ]);
    this.programs.advect.encode(pass, bindGroup, width, height);
    this.velocityPingPong = !this.velocityPingPong;
    velocity = this.velocityName();

    const dye = this.dyeName();
    bindGroup = this.bindGroup(this.programs.advect, [
      { binding: 0, resource: { buffer: this.dyeParams } },
      { binding: 1, resource: fields.get(dye).view },
      { binding: 2, resource: fields.get(velocity).view },
      { binding: 3, resource: fields.get(opposite(dye)).view },
    ]);
    this.programs.advect.encode(pass, bindGroup, width, height);
    this.dyePingPong = !this.dyePingPong;

    velocity = this.velocityName();
    bindGroup = this.bindGroup(this.programs.divergence, [
      { binding: 0, resource: { buffer: this.velocityParams } },
      { binding: 1, resource: fields.get(velocity).view },
      { binding: 2, resource: fields.get("divergence").view },
    ]);
    this.programs.divergence.encode(pass, bindGroup, width, height);

    for (let iteration = 0; iteration < pressureIterations; iteration += 1) {
      const pressure = this.pressureName();
      bindGroup = this.bindGroup(this.programs.pressure, [
        { binding: 0, resource: { buffer: this.velocityParams } },
        { binding: 1, resource: fields.get(pressure).view },
        { binding: 2, resource: fields.get("divergence").view },
        { binding: 3, resource: fields.get(opposite(pressure)).view },
      ]);
      this.programs.pressure.encode(pass, bindGroup, width, height);
      this.pressurePingPong = !this.pressurePingPong;
    }

    bindGroup = this.bindGroup(this.programs.project, [
      { binding: 0, resource: { buffer: this.velocityParams } },
      { binding: 1, resource: fields.get(velocity).view },
      { binding: 2, resource: fields.get(this.pressureName()).view },
      { binding: 3, resource: fields.get(opposite(velocity)).view },
    ]);
    this.programs.project.encode(pass, bindGroup, width, height);
    this.velocityPingPong = !this.velocityPingPong;
  }

  private encodeOptics(pass: GPUComputePassEncoder, fields: WebGpuFieldSet): void {
    const bindGroup = this.bindGroup(this.programs.optics, [
      { binding: 0, resource: { buffer: this.opticsParams } },
      { binding: 1, resource: fields.get(this.dyeName()).view },
      { binding: 2, resource: fields.get(this.velocityName()).view },
      { binding: 3, resource: fields.get("height").view },
      { binding: 4, resource: fields.get("optical-target").view },
    ]);
    this.programs.optics.encode(pass, bindGroup, fields.size.width, fields.size.height);
  }

  private bindGroup(
    program: ComputeProgram,
    entries: readonly GPUBindGroupEntry[],
  ): GPUBindGroup {
    return this.device.createBindGroup({
      label: `mfve:${program.name}:bindings`,
      layout: program.bindGroupLayout,
      entries: [...entries],
    });
  }

  private velocityName(): string {
    return this.velocityPingPong ? "velocity-b" : "velocity-a";
  }

  private dyeName(): string {
    return this.dyePingPong ? "dye-b" : "dye-a";
  }

  private pressureName(): string {
    return this.pressurePingPong ? "pressure-b" : "pressure-a";
  }

  private requireFields(): WebGpuFieldSet {
    if (!this.fields) throw new Error("WebGPU backend is not initialized");
    return this.fields;
  }
}

function opposite(name: string): string {
  return name.endsWith("-a") ? `${name.slice(0, -2)}-b` : `${name.slice(0, -2)}-a`;
}

function activeSources(layer: TransportLayer, time: number): readonly InjectionSource[] {
  return layer.sources.filter(
    (source) => time >= source.startSeconds && time < source.startSeconds + source.durationSeconds,
  );
}

function simulationParameters(project: Project, delta: number, dissipation: number): ArrayBuffer {
  const data = new ArrayBuffer(32);
  const view = new DataView(data);
  view.setUint32(0, project.grid.width, true);
  view.setUint32(4, project.grid.height, true);
  view.setFloat32(8, 1 / project.grid.width, true);
  view.setFloat32(12, 1 / project.grid.height, true);
  view.setFloat32(16, delta, true);
  view.setFloat32(20, dissipation, true);
  return data;
}

function injectionParameters(
  grid: { width: number; height: number },
  source: InjectionSource,
  delta: number,
): ArrayBuffer {
  const data = new ArrayBuffer(64);
  const view = new DataView(data);
  view.setUint32(0, grid.width, true);
  view.setUint32(4, grid.height, true);
  view.setFloat32(8, source.position[0], true);
  view.setFloat32(12, source.position[1], true);
  view.setFloat32(16, source.radius, true);
  view.setFloat32(20, delta, true);
  source.color.forEach((value, index) => view.setFloat32(32 + index * 4, value, true));
  source.impulse.forEach((value, index) => view.setFloat32(48 + index * 4, value, true));
  view.setFloat32(56, source.strength, true);
  view.setFloat32(60, 1, true);
  return data;
}

function opticalParameters(project: Project, context: SimulationContext): ArrayBuffer {
  const data = new ArrayBuffer(48);
  const view = new DataView(data);
  view.setUint32(0, project.grid.width, true);
  view.setUint32(4, project.grid.height, true);
  project.optics.absorption.forEach((value, index) => view.setFloat32(16 + index * 4, value, true));
  view.setFloat32(28, project.optics.exposure, true);
  view.setFloat32(32, project.optics.specularStrength, true);
  view.setFloat32(36, project.optics.darkFieldStrength, true);
  view.setFloat32(40, context.simulationTimeSeconds, true);
  return data;
}
