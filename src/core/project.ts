import { z } from "zod";

export const PROJECT_FORMAT = "mfve.project" as const;
export const PROJECT_VERSION = 1 as const;

const Tuple2Schema = z.tuple([z.number().finite(), z.number().finite()]);
const ColorSchema = z.tuple([
  z.number().finite().min(0),
  z.number().finite().min(0),
  z.number().finite().min(0),
  z.number().finite().min(0).max(1),
]);

export const InjectionSourceSchema = z.object({
  id: z.string().min(1),
  position: Tuple2Schema,
  radius: z.number().finite().positive().max(1),
  color: ColorSchema,
  impulse: Tuple2Schema,
  strength: z.number().finite().min(0).max(10),
  startSeconds: z.number().finite().min(0),
  durationSeconds: z.number().finite().positive(),
}).strict();

export const TransportLayerSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("transport"),
  enabled: z.boolean(),
  pressureIterations: z.number().int().min(0).max(100),
  velocityDissipation: z.number().finite().min(0).max(1),
  dyeDissipation: z.number().finite().min(0).max(1),
  sources: z.array(InjectionSourceSchema).max(32),
}).strict();

export const MagneticLayerSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("magnetic"),
  enabled: z.boolean(),
  initialPattern: z.enum(["bands", "droplet", "noise"]),
  interfaceTension: z.number().finite().min(0).max(2),
  separation: z.number().finite().min(0).max(2),
  coarsening: z.number().finite().min(0).max(2),
  magneticStrength: z.number().finite().min(0).max(10),
  patternScale: z.number().finite().positive().max(0.5),
  mobility: z.number().finite().positive().max(2),
  fieldPosition: Tuple2Schema,
  fieldVelocity: Tuple2Schema,
  darkColor: ColorSchema,
  luminousColor: ColorSchema,
}).strict();

export const DropletSchema = z.object({
  id: z.string().min(1),
  position: Tuple2Schema,
  radius: z.number().finite().positive().max(0.5),
  velocity: Tuple2Schema,
  opticalThickness: z.number().finite().min(0).max(10),
  refractiveIndex: z.number().finite().min(1).max(3),
  mobility: z.number().finite().min(0).max(2),
}).strict();

export const DropletLayerSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("droplets"),
  enabled: z.boolean(),
  coalescence: z.number().finite().min(0).max(1),
  membraneStrength: z.number().finite().min(0).max(10),
  droplets: z.array(DropletSchema).max(64),
}).strict();

export const LayerSchema = z.discriminatedUnion("kind", [
  TransportLayerSchema,
  MagneticLayerSchema,
  DropletLayerSchema,
]);

export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  atSeconds: z.number().finite().min(0),
  durationSeconds: z.number().finite().positive(),
  action: z.enum(["magnetic-pulse", "coalesce"]),
  strength: z.number().finite().min(0).max(10),
}).strict();

export const OpticsSchema = z.object({
  absorption: z.tuple([
    z.number().finite().min(0),
    z.number().finite().min(0),
    z.number().finite().min(0),
  ]),
  exposure: z.number().finite().min(0).max(10),
  specularStrength: z.number().finite().min(0).max(10),
  darkFieldStrength: z.number().finite().min(0).max(10),
  interferenceStrength: z.number().finite().min(0).max(10).default(0),
  interferenceScale: z.number().finite().positive().max(100).default(12),
  rimSharpness: z.number().finite().positive().max(100).default(24),
}).strict();

export const ProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  name: z.string().min(1).max(120),
  seed: z.number().int().min(0).max(0xffffffff),
  grid: z.object({
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
  }).strict().refine((grid) => grid.width === grid.height, {
    message: "The current engine uses a square simulation grid",
  }),
  output: z.object({
    width: z.number().int().min(64).max(7680),
    height: z.number().int().min(64).max(4320),
    framesPerSecond: z.number().int().min(1).max(120),
  }).strict(),
  simulation: z.object({
    fixedDeltaSeconds: z.number().finite().positive().max(0.1),
    maxSubsteps: z.number().int().min(1).max(16),
    durationSeconds: z.number().finite().positive().max(3600),
  }).strict(),
  layers: z.array(LayerSchema).min(1).max(16),
  optics: OpticsSchema,
  timeline: z.array(TimelineEventSchema).max(256).default([]),
}).strict();

export type InjectionSource = z.infer<typeof InjectionSourceSchema>;
export type TransportLayer = z.infer<typeof TransportLayerSchema>;
export type MagneticLayer = z.infer<typeof MagneticLayerSchema>;
export type Droplet = z.infer<typeof DropletSchema>;
export type DropletLayer = z.infer<typeof DropletLayerSchema>;
export type EngineLayer = z.infer<typeof LayerSchema>;
export type EngineTimelineEvent = z.infer<typeof TimelineEventSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export function createDefaultProject(name = "Untitled microscopic study"): Project {
  return ProjectSchema.parse({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    seed: 0x6d696372,
    grid: { width: 512, height: 512 },
    output: { width: 1920, height: 1080, framesPerSecond: 60 },
    simulation: { fixedDeltaSeconds: 1 / 60, maxSubsteps: 4, durationSeconds: 12 },
    layers: [{
      id: "primary-transport",
      kind: "transport",
      enabled: true,
      pressureIterations: 24,
      velocityDissipation: 0.015,
      dyeDissipation: 0.002,
      sources: [{
        id: "central-injection",
        position: [0.5, 0.5],
        radius: 0.12,
        color: [1.0, 0.19, 0.025, 1],
        impulse: [0.12, -0.04],
        strength: 0.8,
        startSeconds: 0,
        durationSeconds: 1.5,
      }],
    }],
    optics: {
      absorption: [0.65, 1.4, 2.1],
      exposure: 1.2,
      specularStrength: 0.35,
      darkFieldStrength: 0.8,
    },
  });
}

/** A combined magnetic/droplet study demonstrating the Phase 2 signature systems. */
export function createMagneticProject(name = "Ferrofluid membrane study"): Project {
  return ProjectSchema.parse({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    seed: 0x66657272,
    grid: { width: 512, height: 512 },
    output: { width: 1920, height: 1080, framesPerSecond: 60 },
    simulation: { fixedDeltaSeconds: 1 / 60, maxSubsteps: 4, durationSeconds: 16 },
    layers: [
      {
        id: "magnetic-interface",
        kind: "magnetic",
        enabled: true,
        initialPattern: "noise",
        interfaceTension: 0.85,
        separation: 0.72,
        coarsening: 0.48,
        magneticStrength: 0.65,
        patternScale: 0.055,
        mobility: 0.9,
        fieldPosition: [0.5, 0.5],
        fieldVelocity: [0.018, 0.011],
        darkColor: [0.002, 0.004, 0.009, 1],
        luminousColor: [0.08, 0.62, 0.78, 1],
      },
      {
        id: "membrane-droplets",
        kind: "droplets",
        enabled: true,
        coalescence: 0.7,
        membraneStrength: 1.4,
        droplets: [
          {
            id: "droplet-a",
            position: [0.34, 0.47],
            radius: 0.09,
            velocity: [0.025, 0.004],
            opticalThickness: 1.3,
            refractiveIndex: 1.36,
            mobility: 1,
          },
          {
            id: "droplet-b",
            position: [0.46, 0.49],
            radius: 0.065,
            velocity: [-0.018, -0.003],
            opticalThickness: 0.9,
            refractiveIndex: 1.42,
            mobility: 0.85,
          },
          {
            id: "droplet-c",
            position: [0.7, 0.62],
            radius: 0.045,
            velocity: [-0.008, -0.014],
            opticalThickness: 1.8,
            refractiveIndex: 1.33,
            mobility: 1.1,
          },
        ],
      },
    ],
    optics: {
      absorption: [0.42, 0.85, 1.35],
      exposure: 1.35,
      specularStrength: 1.1,
      darkFieldStrength: 0.9,
      interferenceStrength: 0.55,
      interferenceScale: 14,
      rimSharpness: 28,
    },
    timeline: [
      {
        id: "magnetic-onset",
        atSeconds: 1.5,
        durationSeconds: 2.5,
        action: "magnetic-pulse",
        strength: 2.2,
      },
      {
        id: "membrane-coalescence",
        atSeconds: 3,
        durationSeconds: 3,
        action: "coalesce",
        strength: 1,
      },
    ],
  });
}

export function parseProject(source: string): Project {
  const json: unknown = JSON.parse(source);
  return ProjectSchema.parse(json);
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(ProjectSchema.parse(project), null, 2)}\n`;
}
