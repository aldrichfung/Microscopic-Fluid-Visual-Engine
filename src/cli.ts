#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDefaultProject, parseProject, serializeProject } from "./core/project.js";
import {
  estimateFieldMemoryBytes,
  PHASE_ONE_FIELDS,
  PHASE_ONE_GRAPH,
  worldExtentForOutput,
} from "./core/fields.js";
import { compileRenderGraph } from "./core/render-graph.js";

const [command, argument] = process.argv.slice(2);

try {
  switch (command) {
    case "create": {
      if (!argument) throw new Error("Usage: mfve create <project.json>");
      const path = resolve(argument);
      if (existsSync(path)) throw new Error(`Refusing to overwrite existing project: ${path}`);
      writeFileSync(path, serializeProject(createDefaultProject()), { flag: "wx" });
      console.log(`Created ${path}`);
      break;
    }
    case "validate": {
      if (!argument) throw new Error("Usage: mfve validate <project.json>");
      const project = parseProject(readFileSync(resolve(argument), "utf8"));
      console.log(`Valid ${project.format} v${project.version}: ${project.name}`);
      console.log(`Grid ${project.grid.width}² · ${project.layers.length} layer(s) · seed ${project.seed}`);
      break;
    }
    case "plan": {
      if (!argument) throw new Error("Usage: mfve plan <project.json>");
      const project = parseProject(readFileSync(resolve(argument), "utf8"));
      const resources = new Set(PHASE_ONE_FIELDS.map((field) => field.name));
      const graph = compileRenderGraph(resources, PHASE_ONE_GRAPH);
      const memory = estimateFieldMemoryBytes(project.grid) / (1024 * 1024);
      const extent = worldExtentForOutput(project.output.width, project.output.height);
      console.log(`Execution plan for ${project.name}`);
      console.log(graph.passes.map((pass, index) => `${index + 1}. ${pass.name}`).join("\n"));
      console.log(`Fields: ${memory.toFixed(1)} MiB · world extent: ${extent[0].toFixed(3)} × ${extent[1].toFixed(3)}`);
      break;
    }
    default:
      console.log("MFVE engine CLI\n\nCommands:\n  mfve create <project.json>\n  mfve validate <project.json>\n  mfve plan <project.json>");
      if (command) throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
