import { describe, expect, it } from "vitest";
import { FixedStepClock } from "../src/core/clock.js";

 describe("FixedStepClock", () => {
  it("uses fixed simulation steps regardless of render cadence", () => {
    const clock = new FixedStepClock(1 / 60, 4);
    const times: number[] = [];
    const result = clock.advance(0.05, (_index, time) => times.push(time));

    expect(result.steps).toBe(3);
    expect(times).toEqual([
      expect.closeTo(1 / 60), expect.closeTo(2 / 60), expect.closeTo(3 / 60),
    ]);
    expect(result.interpolation).toBeCloseTo(0);
    expect(clock.currentStepIndex).toBe(3);
  });

  it("drops excess accumulated time after the substep budget", () => {
    const clock = new FixedStepClock(0.1, 1);
    const result = clock.advance(0.25, () => undefined);
    expect(result.steps).toBe(1);
    expect(result.droppedSeconds).toBeGreaterThan(0);
  });

  it("resets time and step index", () => {
    const clock = new FixedStepClock(0.1);
    clock.advance(0.2, () => undefined);
    clock.reset();
    expect(clock.simulationTimeSeconds).toBe(0);
    expect(clock.currentStepIndex).toBe(0);
  });
});
