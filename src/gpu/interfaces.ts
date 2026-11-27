import type { SimulationContext } from "../core/scheduler.js";
import type { Project } from "../core/project.js";

export interface EngineBackend {
  readonly kind: "webgpu";
  initialize(project: Project): Promise<void>;
  reset(project: Project): void;
  step(context: SimulationContext, project: Project): void;
  resize(gridWidth: number, gridHeight: number): void;
  destroy(): void;
}

export interface ShaderLibrary {
  readonly inject: string;
  readonly advect: string;
  readonly divergence: string;
  readonly pressure: string;
  readonly project: string;
  readonly magneticInit: string;
  readonly magneticStep: string;
  readonly droplets: string;
  readonly optics: string;
}

export async function loadShaderLibrary(baseUrl: URL): Promise<ShaderLibrary> {
  const load = async (name: string): Promise<string> => {
    const response = await fetch(new URL(`${name}.wgsl`, baseUrl));
    if (!response.ok) throw new Error(`Unable to load shader ${name}: HTTP ${response.status}`);
    return response.text();
  };

  const [
    inject, advect, divergence, pressure, project,
    magneticInit, magneticStep, droplets, optics,
  ] = await Promise.all([
    load("inject"), load("advect"), load("divergence"),
    load("pressure"), load("project"), load("magnetic-init"),
    load("magnetic-step"), load("droplets"), load("optics"),
  ]);
  return {
    inject, advect, divergence, pressure, project,
    magneticInit, magneticStep, droplets, optics,
  };
}
