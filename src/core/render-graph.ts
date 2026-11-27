export interface RenderGraphPass {
  readonly name: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly after?: readonly string[];
}

export interface CompiledRenderGraph {
  readonly passes: readonly RenderGraphPass[];
}

/** Validates resource access and topologically orders explicitly dependent passes. */
export function compileRenderGraph(
  resources: ReadonlySet<string>,
  passes: readonly RenderGraphPass[],
): CompiledRenderGraph {
  const byName = new Map<string, RenderGraphPass>();

  for (const pass of passes) {
    if (byName.has(pass.name)) {
      throw new Error(`Duplicate render-graph pass: ${pass.name}`);
    }
    if (pass.reads.some((resource) => pass.writes.includes(resource))) {
      throw new Error(`Pass ${pass.name} reads and writes the same resource; use ping-pong textures`);
    }
    for (const resource of [...pass.reads, ...pass.writes]) {
      if (!resources.has(resource)) {
        throw new Error(`Pass ${pass.name} references unknown resource: ${resource}`);
      }
    }
    byName.set(pass.name, pass);
  }

  const state = new Map<string, "visiting" | "visited">();
  const ordered: RenderGraphPass[] = [];

  const visit = (pass: RenderGraphPass): void => {
    if (state.get(pass.name) === "visited") return;
    if (state.get(pass.name) === "visiting") {
      throw new Error(`Render graph contains a dependency cycle at: ${pass.name}`);
    }
    state.set(pass.name, "visiting");
    for (const dependency of pass.after ?? []) {
      const parent = byName.get(dependency);
      if (!parent) throw new Error(`Pass ${pass.name} depends on unknown pass: ${dependency}`);
      visit(parent);
    }
    state.set(pass.name, "visited");
    ordered.push(pass);
  };

  for (const pass of passes) visit(pass);
  return { passes: ordered };
}
