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

export const LayerSchema = z.discriminatedUnion("kind", [TransportLayerSchema]);

export const ProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  name: z.string().min(1).max(120),
  seed: z.number().int().min(0).max(0xffffffff),
  grid: z.object({
    width: z.number().int().min(64).max(4096),
    height: z.number().int().min(64).max(4096),
  }).strict().refine((grid) => grid.width === grid.height, {
    message: "Phase 1 uses a square simulation grid",
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
  optics: z.object({
    absorption: z.tuple([
      z.number().finite().min(0),
      z.number().finite().min(0),
      z.number().finite().min(0),
    ]),
    exposure: z.number().finite().min(0).max(10),
    specularStrength: z.number().finite().min(0).max(10),
    darkFieldStrength: z.number().finite().min(0).max(10),
  }).strict(),
}).strict();

export type InjectionSource = z.infer<typeof InjectionSourceSchema>;
export type TransportLayer = z.infer<typeof TransportLayerSchema>;
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

export function parseProject(source: string): Project {
  const json: unknown = JSON.parse(source);
  return ProjectSchema.parse(json);
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(ProjectSchema.parse(project), null, 2)}\n`;
}
