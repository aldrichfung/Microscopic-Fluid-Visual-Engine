import { FixedStepClock } from "./clock.js";
import { deriveStepSeed, Mulberry32 } from "./random.js";

export interface SimulationContext {
  readonly masterSeed: number;
  readonly stepIndex: number;
  readonly simulationTimeSeconds: number;
  readonly deltaSeconds: number;
  readonly random: Mulberry32;
}

export interface SimulationPass {
  readonly name: string;
  readonly enabled?: boolean;
  reset?(): void;
  execute(context: SimulationContext): void;
}

export class SimulationScheduler {
  private readonly passes: SimulationPass[] = [];
  private readonly clock: FixedStepClock;
  private readonly masterSeed: number;

  public constructor(masterSeed: number, fixedDeltaSeconds = 1 / 60, maxSubsteps = 4) {
    this.masterSeed = masterSeed >>> 0;
    this.clock = new FixedStepClock(fixedDeltaSeconds, maxSubsteps);
  }

  public register(pass: SimulationPass): void {
    if (this.passes.some((candidate) => candidate.name === pass.name)) {
      throw new Error(`Duplicate simulation pass: ${pass.name}`);
    }
    this.passes.push(pass);
  }

  public step(): SimulationContext {
    let context: SimulationContext | undefined;
    this.clock.advance(this.clock.fixedDeltaSeconds, (index, time) => {
      context = this.executeStep(index, time);
    });
    if (!context) throw new Error("Fixed-step clock failed to advance a manual step");
    return context;
  }

  public advance(realDeltaSeconds: number): number {
    const result = this.clock.advance(realDeltaSeconds, (index, time) => {
      this.executeStep(index, time);
    });
    return result.steps;
  }

  public reset(): void {
    this.clock.reset();
    for (const pass of this.passes) pass.reset?.();
  }

  private executeStep(stepIndex: number, time: number): SimulationContext {
    const context: SimulationContext = {
      masterSeed: this.masterSeed,
      stepIndex,
      simulationTimeSeconds: time,
      deltaSeconds: this.clock.fixedDeltaSeconds,
      random: new Mulberry32(deriveStepSeed(this.masterSeed, stepIndex)),
    };

    for (const pass of this.passes) {
      if (pass.enabled === false) continue;
      try {
        pass.execute(context);
      } catch (error) {
        throw new Error(`Simulation pass failed: ${pass.name}`, { cause: error });
      }
    }
    return context;
  }
}
