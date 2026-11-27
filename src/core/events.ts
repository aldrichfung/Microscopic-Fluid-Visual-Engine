export interface TimelineEvent {
  readonly id: string;
  readonly atSeconds: number;
}

/** Half-open windows prevent an event from firing twice on adjacent steps. */
export function eventsInWindow<T extends TimelineEvent>(
  events: readonly T[],
  previousSeconds: number,
  currentSeconds: number,
): readonly T[] {
  if (currentSeconds < previousSeconds) {
    throw new RangeError("Simulation event windows must move forward; reset explicitly to rewind");
  }
  return events
    .filter((event) => event.atSeconds > previousSeconds && event.atSeconds <= currentSeconds)
    .sort((left, right) => left.atSeconds - right.atSeconds || left.id.localeCompare(right.id));
}
