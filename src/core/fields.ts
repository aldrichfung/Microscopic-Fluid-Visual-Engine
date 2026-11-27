export type FieldFormat = "rgba16float" | "r32float";

export interface FieldDescriptor {
  readonly name: string;
  readonly format: FieldFormat;
  readonly role: "velocity" | "dye" | "pressure" | "divergence" | "height" | "phase" | "droplets" | "optics";
}

export interface GridSize {
  readonly width: number;
  readonly height: number;
}

export const PHASE_ONE_FIELDS: readonly FieldDescriptor[] = [
  { name: "velocity-a", format: "rgba16float", role: "velocity" },
  { name: "velocity-b", format: "rgba16float", role: "velocity" },
  { name: "dye-a", format: "rgba16float", role: "dye" },
  { name: "dye-b", format: "rgba16float", role: "dye" },
  { name: "pressure-a", format: "r32float", role: "pressure" },
  { name: "pressure-b", format: "r32float", role: "pressure" },
  { name: "divergence", format: "r32float", role: "divergence" },
  { name: "height", format: "r32float", role: "height" },
  { name: "optical-target", format: "rgba16float", role: "optics" },
];

export const PHASE_TWO_FIELDS: readonly FieldDescriptor[] = [
  ...PHASE_ONE_FIELDS,
  { name: "phase-a", format: "r32float", role: "phase" },
  { name: "phase-b", format: "r32float", role: "phase" },
  { name: "droplet-field", format: "rgba16float", role: "droplets" },
];

export function bytesPerTexel(format: FieldFormat): number {
  return format === "rgba16float" ? 8 : 4;
}

export function estimateFieldMemoryBytes(
  grid: GridSize,
  fields: readonly FieldDescriptor[] = PHASE_ONE_FIELDS,
): number {
  return fields.reduce(
    (total, field) => total + grid.width * grid.height * bytesPerTexel(field.format),
    0,
  );
}

/** Longest world side is one unit, preserving feature scale across aspect ratios. */
export function worldExtentForOutput(width: number, height: number): readonly [number, number] {
  if (width <= 0 || height <= 0) throw new RangeError("Output dimensions must be positive");
  return width >= height ? [width / height, 1] : [1, height / width];
}

export const PHASE_ONE_GRAPH = [
  { name: "inject", reads: ["dye-a", "velocity-a"], writes: ["dye-b", "velocity-b"] },
  { name: "advect-velocity", reads: ["velocity-b"], writes: ["velocity-a"], after: ["inject"] },
  { name: "advect-dye", reads: ["dye-b", "velocity-a"], writes: ["dye-a"], after: ["advect-velocity"] },
  { name: "divergence", reads: ["velocity-a"], writes: ["divergence"], after: ["advect-dye"] },
  { name: "pressure", reads: ["pressure-a", "divergence"], writes: ["pressure-b"], after: ["divergence"] },
  { name: "project", reads: ["velocity-a", "pressure-b"], writes: ["velocity-b"], after: ["pressure"] },
  { name: "optics", reads: ["dye-a", "velocity-b", "height"], writes: ["optical-target"], after: ["project"] },
] as const;

/** Full signature-system graph; the backend skips passes for disabled layer kinds. */
export const PHASE_TWO_GRAPH = [
  { name: "inject", reads: ["dye-a", "velocity-a"], writes: ["dye-b", "velocity-b"] },
  { name: "advect-velocity", reads: ["velocity-b"], writes: ["velocity-a"], after: ["inject"] },
  { name: "advect-dye", reads: ["dye-b", "velocity-a"], writes: ["dye-a"], after: ["advect-velocity"] },
  { name: "divergence", reads: ["velocity-a"], writes: ["divergence"], after: ["advect-dye"] },
  { name: "pressure", reads: ["pressure-a", "divergence"], writes: ["pressure-b"], after: ["divergence"] },
  { name: "project", reads: ["velocity-a", "pressure-b"], writes: ["velocity-b"], after: ["pressure"] },
  { name: "magnetic-step", reads: ["phase-a"], writes: ["phase-b"], after: ["project"] },
  { name: "droplet-optics", reads: [], writes: ["droplet-field"], after: ["magnetic-step"] },
  {
    name: "optics",
    reads: ["dye-a", "velocity-b", "height", "phase-b", "droplet-field"],
    writes: ["optical-target"],
    after: ["droplet-optics"],
  },
] as const;
