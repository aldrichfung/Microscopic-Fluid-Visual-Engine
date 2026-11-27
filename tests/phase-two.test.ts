import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coalesceDroplets, DropletSystem } from "../src/core/droplets.js";
import { PHASE_TWO_FIELDS, PHASE_TWO_GRAPH, estimateFieldMemoryBytes } from "../src/core/fields.js";
import {
  createDefaultProject,
  createMagneticProject,
  parseProject,
  ProjectSchema,
  serializeProject,
  type Droplet,
  type DropletLayer,
} from "../src/core/project.js";
import { compileRenderGraph } from "../src/core/render-graph.js";
import type { SimulationContext } from "../src/core/scheduler.js";
import { Mulberry32 } from "../src/core/random.js";
import { TimelineController } from "../src/core/timeline.js";

function droplet(id: string, x: number, radius: number): Droplet {
  return {
    id,
    position: [x, 0.5],
    radius,
    velocity: [0, 0],
    opticalThickness: 1,
    refractiveIndex: 1.33,
    mobility: 1,
  };
}

function context(time: number, delta = 0.1): SimulationContext {
  return {
    masterSeed: 7,
    stepIndex: Math.round(time / delta),
    simulationTimeSeconds: time,
    deltaSeconds: delta,
    random: new Mulberry32(7),
  };
}

describe("Phase 2 project compatibility", () => {
  it("round-trips the magnetic and droplet signature project", () => {
    const project = createMagneticProject();
    expect(project.layers.map((layer) => layer.kind)).toEqual(["magnetic", "droplets"]);
    expect(project.timeline.map((event) => event.action)).toEqual(["magnetic-pulse", "coalesce"]);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("fills new optics and timeline defaults in legacy documents", () => {
    const project = createDefaultProject();
    const legacy = {
      ...project,
      optics: {
        absorption: project.optics.absorption,
        exposure: project.optics.exposure,
        specularStrength: project.optics.specularStrength,
        darkFieldStrength: project.optics.darkFieldStrength,
      },
    };
    const parsed = ProjectSchema.parse(legacy);
    expect(parsed.optics.interferenceStrength).toBe(0);
    expect(parsed.optics.interferenceScale).toBe(12);
    expect(parsed.optics.rimSharpness).toBe(24);
    expect(parsed.timeline).toEqual([]);
  });

  it("validates the committed legacy example without migration", () => {
    const source = readFileSync(new URL("../examples/vertical-slice.json", import.meta.url), "utf8");
    const project = parseProject(source);
    expect(project.timeline).toEqual([]);
    expect(project.optics.interferenceScale).toBe(12);
  });
});

describe("deterministic timeline and droplets", () => {
  it("starts time-zero events, expires them, and replays them after reset", () => {
    const controller = new TimelineController([
      { id: "pulse", atSeconds: 0, durationSeconds: 0.2, action: "magnetic-pulse", strength: 2 },
      { id: "merge", atSeconds: 0.1, durationSeconds: 0.2, action: "coalesce", strength: 1 },
    ]);
    expect(controller.step(0.05).magneticPulseStrength).toBe(2);
    expect(controller.step(0.1).started.map((event) => event.id)).toEqual(["merge"]);
    expect(controller.step(0.15).coalescenceStrength).toBe(1);
    expect(controller.step(0.2).magneticPulseStrength).toBe(0);
    expect(controller.step(0.3).coalescenceStrength).toBe(0);
    controller.reset();
    expect(controller.step(0.05).started.map((event) => event.id)).toEqual(["pulse"]);
  });

  it("conserves disk area and area-weights merged optical properties", () => {
    const left = droplet("left", 0.4, 0.1);
    const right = { ...droplet("right", 0.47, 0.05), opticalThickness: 3 };
    const merged = coalesceDroplets([left, right], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.radius).toBeCloseTo(Math.sqrt(0.1 ** 2 + 0.05 ** 2));
    expect(merged[0]?.opticalThickness).toBeCloseTo((1 * 0.01 + 3 * 0.0025) / 0.0125);
  });

  it("coalesces across the periodic boundary", () => {
    const merged = coalesceDroplets([droplet("left", 0.99, 0.04), droplet("right", 0.01, 0.04)], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.position[0]).toBeCloseTo(0, 10);
  });

  it("replays droplet integration identically after reset", () => {
    const layer: DropletLayer = {
      id: "droplets",
      kind: "droplets",
      enabled: true,
      coalescence: 0,
      membraneStrength: 1,
      droplets: [{ ...droplet("moving", 0.99, 0.03), velocity: [0.2, 0] }],
    };
    const system = new DropletSystem();
    system.reset(layer);
    const first = system.step(context(0.1), layer).map((item) => ({ ...item }));
    system.reset(layer);
    const replay = system.step(context(0.1), layer);
    expect(replay).toEqual(first);
    expect(replay[0]?.position[0]).toBeCloseTo(0.01);
  });

  it("uses a timeline coalescence boost even when base coalescence is zero", () => {
    const layer: DropletLayer = {
      id: "droplets",
      kind: "droplets",
      enabled: true,
      coalescence: 0,
      membraneStrength: 1,
      droplets: [droplet("a", 0.4, 0.05), droplet("b", 0.44, 0.05)],
    };
    const system = new DropletSystem();
    system.reset(layer);
    expect(system.step(context(0.1), layer, 1)).toHaveLength(1);
  });
});

describe("Phase 2 resource plan", () => {
  it("compiles magnetic, droplet, and optical dependencies", () => {
    const graph = compileRenderGraph(
      new Set(PHASE_TWO_FIELDS.map((field) => field.name)),
      PHASE_TWO_GRAPH,
    );
    expect(graph.passes.map((pass) => pass.name)).toEqual([
      "inject", "advect-velocity", "advect-dye", "divergence", "pressure", "project",
      "magnetic-step", "droplet-optics", "optics",
    ]);
  });

  it("accounts for phase ping-pong and droplet optical storage", () => {
    expect(estimateFieldMemoryBytes({ width: 64, height: 64 }, PHASE_TWO_FIELDS)).toBe(294_912);
  });
});
