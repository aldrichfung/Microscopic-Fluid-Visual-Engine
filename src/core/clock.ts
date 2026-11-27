export interface ClockAdvance {
  readonly steps: number;
  readonly interpolation: number;
  readonly droppedSeconds: number;
}

/** Fixed-step accumulator; rendering cadence never changes simulation time. */
export class FixedStepClock {
  public readonly fixedDeltaSeconds: number;
  public readonly maxSubsteps: number;

  private accumulator = 0;
  private elapsed = 0;
  private stepIndex = 0;

  public constructor(fixedDeltaSeconds = 1 / 60, maxSubsteps = 4) {
    if (!Number.isFinite(fixedDeltaSeconds) || fixedDeltaSeconds <= 0) {
      throw new RangeError("fixedDeltaSeconds must be finite and positive");
    }
    if (!Number.isInteger(maxSubsteps) || maxSubsteps < 1) {
      throw new RangeError("maxSubsteps must be a positive integer");
    }
    this.fixedDeltaSeconds = fixedDeltaSeconds;
    this.maxSubsteps = maxSubsteps;
  }

  public get simulationTimeSeconds(): number {
    return this.elapsed;
  }

  public get currentStepIndex(): number {
    return this.stepIndex;
  }

  public advance(realDeltaSeconds: number, step: (index: number, time: number) => void): ClockAdvance {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) {
      throw new RangeError("realDeltaSeconds must be finite and non-negative");
    }

    this.accumulator += Math.min(realDeltaSeconds, 0.25);
    let steps = 0;

    while (this.accumulator + Number.EPSILON >= this.fixedDeltaSeconds && steps < this.maxSubsteps) {
      this.accumulator -= this.fixedDeltaSeconds;
      this.elapsed += this.fixedDeltaSeconds;
      step(this.stepIndex, this.elapsed);
      this.stepIndex += 1;
      steps += 1;
    }

    let droppedSeconds = 0;
    if (this.accumulator >= this.fixedDeltaSeconds) {
      const retained = this.accumulator % this.fixedDeltaSeconds;
      droppedSeconds = this.accumulator - retained;
      this.accumulator = retained;
    }

    return {
      steps,
      interpolation: this.accumulator / this.fixedDeltaSeconds,
      droppedSeconds,
    };
  }

  public reset(): void {
    this.accumulator = 0;
    this.elapsed = 0;
    this.stepIndex = 0;
  }
}
