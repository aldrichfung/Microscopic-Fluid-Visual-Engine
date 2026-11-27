import type { Droplet, DropletLayer } from "./project.js";
import type { SimulationContext } from "./scheduler.js";

/** CPU-authoritative droplets make coalescence inspectable and independent of GPU readback. */
export class DropletSystem {
  private state: Droplet[] = [];

  public reset(layer: DropletLayer | undefined): void {
    this.state = layer?.enabled ? layer.droplets.map(cloneDroplet) : [];
  }

  public step(
    context: SimulationContext,
    layer: DropletLayer,
    coalescenceBoost = 0,
  ): readonly Droplet[] {
    if (!layer.enabled) {
      this.state = [];
      return this.state;
    }

    this.state = this.state.map((droplet) => ({
      ...droplet,
      position: [
        wrapUnit(droplet.position[0] + droplet.velocity[0] * droplet.mobility * context.deltaSeconds),
        wrapUnit(droplet.position[1] + droplet.velocity[1] * droplet.mobility * context.deltaSeconds),
      ],
    }));

    const coalescence = Math.max(layer.coalescence, Math.min(1, Math.max(0, coalescenceBoost)));
    if (coalescence > 0) this.state = coalesceDroplets(this.state, coalescence);
    return this.state;
  }

  public snapshot(): readonly Droplet[] {
    return this.state.map(cloneDroplet);
  }
}

/** Merge overlapping pairs in stable order; combined radius exactly conserves disk area. */
export function coalesceDroplets(
  droplets: readonly Droplet[],
  amount: number,
): Droplet[] {
  const result = droplets.map(cloneDroplet);
  const thresholdScale = 0.75 + 0.25 * Math.min(1, Math.max(0, amount));
  let leftIndex = 0;

  while (leftIndex < result.length) {
    let rightIndex = leftIndex + 1;
    while (rightIndex < result.length) {
      const left = result[leftIndex];
      const right = result[rightIndex];
      if (!left || !right) break;
      const offset = periodicOffset(left.position, right.position);
      const contactDistance = (left.radius + right.radius) * thresholdScale;
      if (Math.hypot(offset[0], offset[1]) > contactDistance) {
        rightIndex += 1;
        continue;
      }

      const leftArea = left.radius * left.radius;
      const rightArea = right.radius * right.radius;
      const totalArea = leftArea + rightArea;
      const rightWeight = rightArea / totalArea;
      result[leftIndex] = {
        ...left,
        position: [
          wrapUnit(left.position[0] + offset[0] * rightWeight),
          wrapUnit(left.position[1] + offset[1] * rightWeight),
        ],
        radius: Math.sqrt(totalArea),
        velocity: [
          (left.velocity[0] * leftArea + right.velocity[0] * rightArea) / totalArea,
          (left.velocity[1] * leftArea + right.velocity[1] * rightArea) / totalArea,
        ],
        opticalThickness: (
          left.opticalThickness * leftArea + right.opticalThickness * rightArea
        ) / totalArea,
        refractiveIndex: (
          left.refractiveIndex * leftArea + right.refractiveIndex * rightArea
        ) / totalArea,
        mobility: (left.mobility * leftArea + right.mobility * rightArea) / totalArea,
      };
      result.splice(rightIndex, 1);
    }
    leftIndex += 1;
  }
  return result;
}

function cloneDroplet(droplet: Droplet): Droplet {
  return {
    ...droplet,
    position: [...droplet.position],
    velocity: [...droplet.velocity],
  };
}

function periodicOffset(from: readonly [number, number], to: readonly [number, number]): [number, number] {
  return [wrapSigned(to[0] - from[0]), wrapSigned(to[1] - from[1])];
}

function wrapSigned(value: number): number {
  return value - Math.round(value);
}

function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}
