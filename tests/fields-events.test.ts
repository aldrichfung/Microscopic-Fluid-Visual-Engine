import { describe, expect, it } from "vitest";
import { estimateFieldMemoryBytes, worldExtentForOutput } from "../src/core/fields.js";
import { eventsInWindow } from "../src/core/events.js";
import { deriveStepSeed, Mulberry32 } from "../src/core/random.js";

 describe("fields and events", () => {
  it("estimates the Phase 1 field budget", () => {
    expect(estimateFieldMemoryBytes({ width: 64, height: 64 })).toBe(229_376);
  });

  it("preserves world feature scale across aspect ratios", () => {
    expect(worldExtentForOutput(1920, 1080)).toEqual([1920 / 1080, 1]);
    expect(worldExtentForOutput(1080, 1920)).toEqual([1, 1920 / 1080]);
  });

  it("selects each timeline event once in half-open windows", () => {
    const events = [
      { id: "b", atSeconds: 0.2 },
      { id: "a", atSeconds: 0.1 },
      { id: "c", atSeconds: 0.3 },
    ];
    expect(eventsInWindow(events, 0, 0.2).map((event) => event.id)).toEqual(["a", "b"]);
    expect(eventsInWindow(events, 0.2, 0.3).map((event) => event.id)).toEqual(["c"]);
  });

  it("derives deterministic per-step random streams", () => {
    const seed = deriveStepSeed(123, 4);
    expect(seed).toBe(deriveStepSeed(123, 4));
    expect(new Mulberry32(seed).next()).toBe(new Mulberry32(seed).next());
  });
});
