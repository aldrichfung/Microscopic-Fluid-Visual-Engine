import { describe, expect, it } from "vitest";
import {
  createDefaultProject,
  parseProject,
  ProjectSchema,
  serializeProject,
} from "../src/core/project.js";

 describe("project document", () => {
  it("creates a valid Phase 1 project", () => {
    const project = createDefaultProject();
    expect(project.format).toBe("mfve.project");
    expect(project.version).toBe(1);
    expect(project.layers[0]?.kind).toBe("transport");
  });

  it("round-trips without data changes", () => {
    const project = createDefaultProject("Round trip");
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("rejects non-square simulation grids", () => {
    const project = createDefaultProject();
    expect(() => ProjectSchema.parse({
      ...project,
      grid: { width: 512, height: 256 },
    })).toThrow(/square simulation grid/);
  });

  it("rejects unknown document versions", () => {
    const project = createDefaultProject();
    expect(() => ProjectSchema.parse({ ...project, version: 2 })).toThrow();
  });
});
