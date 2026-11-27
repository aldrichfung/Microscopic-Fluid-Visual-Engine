import { describe, expect, it } from "vitest";
import { compileRenderGraph } from "../src/core/render-graph.js";
import { PHASE_ONE_FIELDS, PHASE_ONE_GRAPH } from "../src/core/fields.js";

 describe("render graph", () => {
  it("compiles the Phase 1 execution plan", () => {
    const graph = compileRenderGraph(
      new Set(PHASE_ONE_FIELDS.map((field) => field.name)),
      PHASE_ONE_GRAPH,
    );
    expect(graph.passes.map((pass) => pass.name)).toEqual([
      "inject", "advect-velocity", "advect-dye", "divergence", "pressure", "project", "optics",
    ]);
  });

  it("rejects in-place field writes", () => {
    expect(() => compileRenderGraph(new Set(["a"]), [{
      name: "unsafe", reads: ["a"], writes: ["a"],
    }])).toThrow(/ping-pong/);
  });

  it("rejects dependency cycles", () => {
    expect(() => compileRenderGraph(new Set(["a", "b"]), [
      { name: "first", reads: [], writes: ["a"], after: ["second"] },
      { name: "second", reads: ["a"], writes: ["b"], after: ["first"] },
    ])).toThrow(/cycle/);
  });
});
