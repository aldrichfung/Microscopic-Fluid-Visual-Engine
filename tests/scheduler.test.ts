import { describe, expect, it } from "vitest";
import { SimulationScheduler, type SimulationContext } from "../src/core/scheduler.js";

 describe("SimulationScheduler", () => {
  it("executes each fixed step exactly once with deterministic seeds", () => {
    const scheduler = new SimulationScheduler(42, 0.1, 4);
    const contexts: SimulationContext[] = [];
    scheduler.register({ name: "capture", execute: (context) => contexts.push(context) });

    expect(scheduler.advance(0.25)).toBe(2);
    scheduler.step();

    expect(contexts.map((context) => context.stepIndex)).toEqual([0, 1, 2]);
    expect(contexts.map((context) => context.simulationTimeSeconds)).toEqual([
      expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3),
    ]);
    expect(new Set(contexts.map((context) => context.random.snapshot())).size).toBe(3);

  });

  it("replays the same random stream after reset", () => {
    const scheduler = new SimulationScheduler(42, 0.1);
    let first = 0;
    scheduler.register({ name: "random", execute: (context) => { first = context.random.next(); } });
    scheduler.step();
    const initial = first;
    scheduler.step();
    scheduler.reset();
    scheduler.step();
    expect(first).toBe(initial);
  });

  it("annotates pass failures", () => {
    const scheduler = new SimulationScheduler(1);
    scheduler.register({ name: "broken-pass", execute: () => { throw new Error("failure"); } });
    expect(() => scheduler.step()).toThrow(/broken-pass/);
  });
});
