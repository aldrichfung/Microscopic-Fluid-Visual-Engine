import type { EngineBackend, ShaderLibrary } from "../interfaces.js";
import type {
  Droplet,
  DropletLayer,
  InjectionSource,
  MagneticLayer,
  Project,
  TransportLayer,
} from "../../core/project.js";
import type { SimulationContext } from "../../core/scheduler.js";
import { DropletSystem } from "../../core/droplets.js";
import { Mulberry32 } from "../../core/random.js";
import { TimelineController } from "../../core/timeline.js";
import { ComputeProgram, makeUniformBuffer } from "./compute.js";
import { WebGpuFieldSet } from "./fields.js";

/** WebGPU backend for transport, magnetic phase fields, droplet membranes, and optical rendering. */
export class WebGpuTransportBackend implements EngineBackend {
  public readonly kind = "webgpu" as const;

  private readonly programs: Record<keyof ShaderLibrary, ComputeProgram>;
  private readonly velocityParams: GPUBuffer;
  private readonly dyeParams: GPUBuffer;
  private readonly magneticParams: GPUBuffer;
  private readonly dropletParams: GPUBuffer;
  private readonly dropletState: GPUBuffer;
  private readonly opticsParams: GPUBuffer;
  private readonly injectionParams = new Map<string, GPUBuffer>();
  private readonly dropletSystem = new DropletSystem();
  private timeline = new TimelineController([]);
  private fields: WebGpuFieldSet | undefined;
  private currentProject: Project | undefined;
  private activeDroplets: readonly Droplet[] = [];
  private velocityPingPong = false;
  private dyePingPong = false;
  private pressurePingPong = false;
  private phasePingPong = false;

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
      magneticInit: new ComputeProgram(device, "magnetic-init", shaders.magneticInit),
      magneticStep: new ComputeProgram(device, "magnetic-step", shaders.magneticStep),
      droplets: new ComputeProgram(device, "droplets", shaders.droplets),
      optics: new ComputeProgram(device, "optics", shaders.optics),
    };
    this.velocityParams = makeUniformBuffer(device, "mfve:velocity-params", 32);
    this.dyeParams = makeUniformBuffer(device, "mfve:dye-params", 32);
    this.magneticParams = makeUniformBuffer(device, "mfve:magnetic-params", 64);
    this.dropletParams = makeUniformBuffer(device, "mfve:droplet-params", 32);
    this.dropletState = device.createBuffer({
      label: "mfve:droplet-state",
      size: 64 * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.opticsParams = makeUniformBuffer(device, "mfve:optics-params", 96);
  }

  public initialize(project: Project): Promise<void> {
    this.fields?.destroy();
    this.fields = new WebGpuFieldSet(this.device, project.grid);
    this.reset(project);
    return Promise.resolve();
  }

  public reset(project: Project): void {
    this.currentProject = project;
    this.requireFields().clear();
    this.velocityPingPong = false;
    this.dyePingPong = false;
    this.pressurePingPong = false;
    this.phasePingPong = false;
    this.timeline = new TimelineController(project.timeline);
    this.dropletSystem.reset(enabledDropletLayer(project));
    this.activeDroplets = this.dropletSystem.snapshot();

    const magnetic = enabledMagneticLayer(project);
    const dropletLayer = enabledDropletLayer(project);
    const initialContext: SimulationContext = {
      masterSeed: project.seed,
      stepIndex: 0,
      simulationTimeSeconds: 0,
      deltaSeconds: project.simulation.fixedDeltaSeconds,
      random: new Mulberry32(project.seed),
    };
    if (magnetic) {
      this.device.queue.writeBuffer(
        this.magneticParams,
        0,
        magneticParameters(project.grid, magnetic, project.seed, project.simulation.fixedDeltaSeconds, 0, 0),
      );
    }
    this.device.queue.writeBuffer(
      this.dropletParams,
      0,
      dropletParameters(project, initialContext, this.activeDroplets.length, dropletLayer),
    );
    if (this.activeDroplets.length > 0) {
      this.device.queue.writeBuffer(this.dropletState, 0, dropletStateParameters(this.activeDroplets));
    }
    this.device.queue.writeBuffer(this.opticsParams, 0, opticalParameters(project, initialContext, magnetic));

    const encoder = this.device.createCommandEncoder({ label: "mfve:reset" });
    const pass = encoder.beginComputePass({ label: "mfve:initialize-fields" });
    const fields = this.requireFields();
    if (magnetic) {
      const bindGroup = this.bindGroup(this.programs.magneticInit, [
        { binding: 0, resource: { buffer: this.magneticParams } },
        { binding: 1, resource: fields.get(this.phaseName()).view },
      ]);
      this.programs.magneticInit.encode(pass, bindGroup, fields.size.width, fields.size.height);
    }
    this.encodeDroplets(pass, fields);
    this.encodeOptics(pass, fields);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public resize(gridWidth: number, gridHeight: number): void {
    const fields = this.requireFields();
    fields.resize({ width: gridWidth, height: gridHeight });
    if (this.currentProject) {
      this.reset({
        ...this.currentProject,
        grid: { width: gridWidth, height: gridHeight },
      });
    } else {
      fields.clear();
    }
  }

  public step(context: SimulationContext, project: Project): void {
    const fields = this.requireFields();
    this.currentProject = project;
    const transport = enabledTransportLayer(project);
    const magnetic = enabledMagneticLayer(project);
    const dropletLayer = enabledDropletLayer(project);
    const timeline = this.timeline.step(context.simulationTimeSeconds);

    if (transport) {
      this.device.queue.writeBuffer(
        this.velocityParams,
        0,
        simulationParameters(project, context.deltaSeconds, transport.velocityDissipation),
      );
      this.device.queue.writeBuffer(
        this.dyeParams,
        0,
        simulationParameters(project, context.deltaSeconds, transport.dyeDissipation),
      );
    }
    if (magnetic) {
      this.device.queue.writeBuffer(
        this.magneticParams,
        0,
        magneticParameters(
          project.grid,
          magnetic,
          project.seed,
          context.deltaSeconds,
          context.simulationTimeSeconds,
          timeline.magneticPulseStrength,
        ),
      );
    }

    this.activeDroplets = dropletLayer
      ? this.dropletSystem.step(context, dropletLayer, timeline.coalescenceStrength)
      : [];
    this.device.queue.writeBuffer(
      this.dropletParams,
      0,
      dropletParameters(project, context, this.activeDroplets.length, dropletLayer),
    );
    if (this.activeDroplets.length > 0) {
      this.device.queue.writeBuffer(this.dropletState, 0, dropletStateParameters(this.activeDroplets));
    }
    this.device.queue.writeBuffer(this.opticsParams, 0, opticalParameters(project, context, magnetic));

    const encoder = this.device.createCommandEncoder({ label: "mfve:signature-step" });
    const pass = encoder.beginComputePass({ label: "mfve:signature-passes" });

    if (transport) {
      for (const source of activeSources(transport, context.simulationTimeSeconds)) {
        this.encodeInjection(pass, fields, source, context.deltaSeconds);
      }
      this.encodeTransport(pass, fields, transport.pressureIterations);
    }
    if (magnetic) this.encodeMagnetic(pass, fields);
    this.encodeDroplets(pass, fields);
    this.encodeOptics(pass, fields);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  public opticalTarget(): GPUTextureView {
    return this.requireFields().get("optical-target").view;
  }

  /** Exposes a field texture for capture, diagnostics, and GPU smoke-test readback. */
  public fieldTexture(name: string): GPUTexture {
    return this.requireFields().get(name).texture;
  }

  public droplets(): readonly Droplet[] {
    return this.dropletSystem.snapshot();
  }

  public destroy(): void {
    this.fields?.destroy();
    this.fields = undefined;
    this.currentProject = undefined;
    this.velocityParams.destroy();
    this.dyeParams.destroy();
    this.magneticParams.destroy();
    this.dropletParams.destroy();
    this.dropletState.destroy();
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

  private encodeMagnetic(pass: GPUComputePassEncoder, fields: WebGpuFieldSet): void {
    const phase = this.phaseName();
    const bindGroup = this.bindGroup(this.programs.magneticStep, [
      { binding: 0, resource: { buffer: this.magneticParams } },
      { binding: 1, resource: fields.get(phase).view },
      { binding: 2, resource: fields.get(opposite(phase)).view },
    ]);
    this.programs.magneticStep.encode(pass, bindGroup, fields.size.width, fields.size.height);
    this.phasePingPong = !this.phasePingPong;
  }

  private encodeDroplets(pass: GPUComputePassEncoder, fields: WebGpuFieldSet): void {
    const bindGroup = this.bindGroup(this.programs.droplets, [
      { binding: 0, resource: { buffer: this.dropletParams } },
      { binding: 1, resource: { buffer: this.dropletState } },
      { binding: 2, resource: fields.get("droplet-field").view },
    ]);
    this.programs.droplets.encode(pass, bindGroup, fields.size.width, fields.size.height);
  }

  private encodeOptics(pass: GPUComputePassEncoder, fields: WebGpuFieldSet): void {
    const bindGroup = this.bindGroup(this.programs.optics, [
      { binding: 0, resource: { buffer: this.opticsParams } },
      { binding: 1, resource: fields.get(this.dyeName()).view },
      { binding: 2, resource: fields.get(this.velocityName()).view },
      { binding: 3, resource: fields.get("height").view },
      { binding: 4, resource: fields.get(this.phaseName()).view },
      { binding: 5, resource: fields.get("droplet-field").view },
      { binding: 6, resource: fields.get("optical-target").view },
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

  private phaseName(): string {
    return this.phasePingPong ? "phase-b" : "phase-a";
  }

  private requireFields(): WebGpuFieldSet {
    if (!this.fields) throw new Error("WebGPU backend is not initialized");
    return this.fields;
  }
}

function enabledTransportLayer(project: Project): TransportLayer | undefined {
  return project.layers.find(
    (layer): layer is TransportLayer => layer.kind === "transport" && layer.enabled,
  );
}

function enabledMagneticLayer(project: Project): MagneticLayer | undefined {
  return project.layers.find(
    (layer): layer is MagneticLayer => layer.kind === "magnetic" && layer.enabled,
  );
}

function enabledDropletLayer(project: Project): DropletLayer | undefined {
  return project.layers.find(
    (layer): layer is DropletLayer => layer.kind === "droplets" && layer.enabled,
  );
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

function magneticParameters(
  grid: { width: number; height: number },
  layer: MagneticLayer,
  seed: number,
  delta: number,
  time: number,
  pulseStrength: number,
): ArrayBuffer {
  const data = new ArrayBuffer(64);
  const view = new DataView(data);
  view.setUint32(0, grid.width, true);
  view.setUint32(4, grid.height, true);
  view.setFloat32(8, 1 / grid.width, true);
  view.setFloat32(12, 1 / grid.height, true);
  view.setFloat32(16, wrapUnit(layer.fieldPosition[0] + layer.fieldVelocity[0] * time), true);
  view.setFloat32(20, wrapUnit(layer.fieldPosition[1] + layer.fieldVelocity[1] * time), true);
  view.setFloat32(24, delta, true);
  view.setFloat32(28, layer.interfaceTension, true);
  view.setFloat32(32, layer.separation, true);
  view.setFloat32(36, layer.coarsening, true);
  view.setFloat32(40, layer.magneticStrength + pulseStrength, true);
  view.setFloat32(44, layer.patternScale, true);
  view.setFloat32(48, layer.mobility, true);
  view.setUint32(52, seed, true);
  view.setUint32(56, ["bands", "droplet", "noise"].indexOf(layer.initialPattern), true);
  view.setFloat32(60, time, true);
  return data;
}

function dropletParameters(
  project: Project,
  context: SimulationContext,
  count: number,
  layer: DropletLayer | undefined,
): ArrayBuffer {
  const data = new ArrayBuffer(32);
  const view = new DataView(data);
  view.setUint32(0, project.grid.width, true);
  view.setUint32(4, project.grid.height, true);
  view.setUint32(8, count, true);
  view.setFloat32(12, layer?.membraneStrength ?? 0, true);
  view.setFloat32(16, project.optics.rimSharpness, true);
  view.setFloat32(20, context.deltaSeconds, true);
  view.setFloat32(24, context.simulationTimeSeconds, true);
  return data;
}

function dropletStateParameters(droplets: readonly Droplet[]): ArrayBuffer {
  const data = new ArrayBuffer(droplets.length * 32);
  const view = new DataView(data);
  droplets.forEach((droplet, index) => {
    const offset = index * 32;
    view.setFloat32(offset, droplet.position[0], true);
    view.setFloat32(offset + 4, droplet.position[1], true);
    view.setFloat32(offset + 8, droplet.velocity[0], true);
    view.setFloat32(offset + 12, droplet.velocity[1], true);
    view.setFloat32(offset + 16, droplet.radius, true);
    view.setFloat32(offset + 20, droplet.opticalThickness, true);
    view.setFloat32(offset + 24, droplet.refractiveIndex, true);
    view.setFloat32(offset + 28, droplet.mobility, true);
  });
  return data;
}

function opticalParameters(
  project: Project,
  context: SimulationContext,
  magnetic: MagneticLayer | undefined,
): ArrayBuffer {
  const data = new ArrayBuffer(96);
  const view = new DataView(data);
  view.setUint32(0, project.grid.width, true);
  view.setUint32(4, project.grid.height, true);
  project.optics.absorption.forEach((value, index) => view.setFloat32(16 + index * 4, value, true));
  view.setFloat32(28, project.optics.exposure, true);
  view.setFloat32(32, project.optics.specularStrength, true);
  view.setFloat32(36, project.optics.darkFieldStrength, true);
  view.setFloat32(40, context.simulationTimeSeconds, true);
  view.setFloat32(44, project.optics.interferenceStrength, true);
  view.setFloat32(48, project.optics.interferenceScale, true);
  view.setFloat32(52, project.optics.rimSharpness, true);
  view.setFloat32(56, magnetic ? 1 : 0, true);
  const darkColor = magnetic?.darkColor ?? [0, 0, 0, 1] as const;
  const luminousColor = magnetic?.luminousColor ?? [0, 0, 0, 1] as const;
  darkColor.forEach((value, index) => view.setFloat32(64 + index * 4, value, true));
  luminousColor.forEach((value, index) => view.setFloat32(80 + index * 4, value, true));
  return data;
}

function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}
