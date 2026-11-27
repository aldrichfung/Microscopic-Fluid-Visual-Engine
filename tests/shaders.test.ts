import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";

const shaderNames = ["inject", "advect", "divergence", "pressure", "project", "optics"];

 describe("WGSL shader contracts", () => {
  it.each(shaderNames)("%s has a compute entry point and bounded workgroups", (name) => {
    const shader = readFileSync(resolve("src/shaders", `${name}.wgsl`), "utf8");
    expect(shader).toContain("@compute @workgroup_size(8, 8, 1)");
    expect(shader).toContain("fn main(@builtin(global_invocation_id)");
    expect(shader).toContain("if (id.x >= params.grid.x || id.y >= params.grid.y)");
    expect(shader).not.toContain("read_write");
  });

  it.each(shaderNames)("%s parses as WGSL", (name) => {
    const shader = readFileSync(resolve("src/shaders", `${name}.wgsl`), "utf8");
    const reflect = new WgslReflect(shader);
    expect(reflect.entry.compute).toHaveLength(1);
    expect(reflect.entry.compute[0]?.name).toBe("main");
  });

  it("uses write-only storage textures and explicit ping-pong outputs", () => {
    for (const name of shaderNames) {
      const shader = readFileSync(resolve("src/shaders", `${name}.wgsl`), "utf8");
      expect(shader).toContain("texture_storage_2d");
      expect(shader).toContain("write>");
    }
  });
});
