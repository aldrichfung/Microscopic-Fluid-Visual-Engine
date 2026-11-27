import { ProjectSchema, type Project } from "./core/project.js";
import { SimulationScheduler } from "./core/scheduler.js";
import type { EngineBackend } from "./gpu/interfaces.js";

/** Coordinates the versioned project, deterministic scheduler, and selected GPU backend. */
export class MicroscopicEngine {
  private readonly scheduler: SimulationScheduler;
  private readonly project: Project;

  public constructor(project: Project, public readonly backend: EngineBackend) {
    this.project = ProjectSchema.parse(project);
    this.scheduler = new SimulationScheduler(
      this.project.seed,
      this.project.simulation.fixedDeltaSeconds,
      this.project.simulation.maxSubsteps,
    );
    this.scheduler.register({
      name: "gpu-backend",
      execute: (context) => this.backend.step(context, this.project),
      reset: () => this.backend.reset(this.project),
    });
  }

  public get simulationTimeSeconds(): number {
    return this.scheduler.simulationTimeSeconds;
  }

  public get currentStepIndex(): number {
    return this.scheduler.currentStepIndex;
  }

  public async initialize(): Promise<void> {
    await this.backend.initialize(this.project);
  }

  public advance(realDeltaSeconds: number): number {
    return this.scheduler.advance(realDeltaSeconds);
  }

  public step(): void {
    this.scheduler.step();
  }

  public reset(): void {
    this.scheduler.reset();
  }

  public destroy(): void {
    this.backend.destroy();
  }
}
