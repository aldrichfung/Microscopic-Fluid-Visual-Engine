import { describe, expect, it } from "vitest";
import { MicroscopicEngine } from "../src/engine.js";
import { createDefaultProject } from "../src/core/project.js";
import type { EngineBackend } from "../src/gpu/interfaces.js";

function recordingBackend() {
  const steps: number[] = [];
  let resets = 0;
  let destroys = 0;
  const backend: EngineBackend = {
    kind: "webgpu",
    initialize: () => Promise.resolve(),
    reset: () => { resets += 1; },
    step: (context) => { steps.push(context.stepIndex); },
    resize: () => undefined,
    destroy: () => { destroys += 1; },
  };
  return { backend, steps, resets: () => resets, destroys: () => destroys };
}

describe("MicroscopicEngine", () => {
  it("drives the backend through the fixed-step scheduler", async () => {
    const project = createDefaultProject();
    project.simulation.fixedDeltaSeconds = 0.1;
    const { backend, steps, resets, destroys } = recordingBackend();
    const engine = new MicroscopicEngine(project, backend);
    await engine.initialize();

    expect(engine.advance(0.25)).toBe(2);
    engine.step();
    engine.reset();
    engine.destroy();

    expect(steps).toEqual([0, 1, 2]);
    expect(resets()).toBe(1);
    expect(destroys()).toBe(1);
  });
});
