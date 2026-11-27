import {
  createDefaultProject,
  createMagneticProject,
  ProjectSchema,
  type EngineLayer,
  type Project,
} from "@mfve/engine";

export type StudioPreset = "magnetic" | "transport";

export function createStudioProject(preset: StudioPreset = "magnetic"): Project {
  const project = preset === "magnetic"
    ? createMagneticProject("Aurelia / magnetic study")
    : createDefaultProject("Ember / transport study");
  project.grid = { width: 128, height: 128 };
  return ProjectSchema.parse(project);
}

export function updateLayer(
  project: Project,
  layerId: string,
  update: (layer: EngineLayer) => EngineLayer,
): Project {
  return {
    ...project,
    layers: project.layers.map((layer) => layer.id === layerId ? update(layer) : layer),
  };
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mfve-study";
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}
