import { eventsInWindow } from "./events.js";
import type { EngineTimelineEvent } from "./project.js";

export interface TimelineFrame {
  readonly started: readonly EngineTimelineEvent[];
  readonly active: readonly EngineTimelineEvent[];
  readonly magneticPulseStrength: number;
  readonly coalescenceStrength: number;
}

/** Starts events once, keeps them for their authored duration, and resets deterministically. */
export class TimelineController {
  private readonly events: readonly EngineTimelineEvent[];
  private previousSeconds: number | undefined;
  private activeEvents: EngineTimelineEvent[] = [];

  public constructor(events: readonly EngineTimelineEvent[]) {
    this.events = [...events];
  }

  public step(currentSeconds: number): TimelineFrame {
    const started = eventsInWindow(
      this.events,
      this.previousSeconds ?? Number.NEGATIVE_INFINITY,
      currentSeconds,
    );
    this.previousSeconds = currentSeconds;
    this.activeEvents = [...this.activeEvents, ...started].filter(
      (event) => eventIsActive(event, currentSeconds),
    );
    const active = [...this.activeEvents].sort((left, right) => left.id.localeCompare(right.id));

    return {
      started,
      active,
      magneticPulseStrength: active
        .filter((event) => event.action === "magnetic-pulse")
        .reduce((sum, event) => sum + event.strength, 0),
      coalescenceStrength: active
        .filter((event) => event.action === "coalesce")
        .reduce((maximum, event) => Math.max(maximum, event.strength), 0),
    };
  }

  public reset(): void {
    this.previousSeconds = undefined;
    this.activeEvents = [];
  }
}

function eventIsActive(event: EngineTimelineEvent, currentSeconds: number): boolean {
  const endSeconds = event.atSeconds + event.durationSeconds;
  const tolerance = Number.EPSILON * 4 * Math.max(1, Math.abs(endSeconds));
  return currentSeconds < endSeconds && Math.abs(currentSeconds - endSeconds) > tolerance;
}
