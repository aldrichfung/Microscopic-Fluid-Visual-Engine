import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";

const shaderNames = [
  "inject", "advect", "divergence", "pressure", "project",
  "magnetic-init", "magnetic-step", "droplets", "optics",
];

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

  it.each([
    ["magnetic-init", 64],
    ["magnetic-step", 64],
    ["droplets", 32],
    ["optics", 96],
  ])("%s uses the backend's reflected uniform size", (name, expectedSize) => {
    const shader = readFileSync(resolve("src/shaders", `${name}.wgsl`), "utf8");
    const reflect = new WgslReflect(shader);
    expect(reflect.uniforms[0]?.size).toBe(expectedSize);
    expect(reflect.uniforms[0]?.group).toBe(0);
    expect(reflect.uniforms[0]?.binding).toBe(0);
  });

  it("binds magnetic phase and droplet optical fields independently", () => {
    const shader = readFileSync(resolve("src/shaders/optics.wgsl"), "utf8");
    const reflect = new WgslReflect(shader);
    expect(reflect.textures.map((texture) => [texture.binding, texture.name])).toEqual([
      [1, "dye"], [2, "velocity"], [3, "height"], [4, "phase"], [5, "droplets"],
    ]);
    expect(reflect.storage[0]?.binding).toBe(6);
  });

  it("uses write-only storage textures and explicit ping-pong outputs", () => {
    for (const name of shaderNames) {
      const shader = readFileSync(resolve("src/shaders", `${name}.wgsl`), "utf8");
      expect(shader).toContain("texture_storage_2d");
      expect(shader).toContain("write>");
    }
  });
});
