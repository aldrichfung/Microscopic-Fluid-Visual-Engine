import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, StepForward, Trash2 } from "lucide-react";
import type { EngineTimelineEvent, Project } from "@mfve/engine";
import { formatTime } from "@/lib/project";
import { ParameterField, SelectField } from "./controls";

interface TimelinePanelProps {
  readonly project: Project;
  readonly timeSeconds: number;
  readonly playing: boolean;
  readonly ready: boolean;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onPlayPause: () => void;
  readonly onReset: () => void;
  readonly onStep: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onProjectChange: (project: Project) => void;
}

export function TimelinePanel(props: TimelinePanelProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(props.project.timeline[0]?.id);
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  useEffect(() => setScrubSeconds(null), [props.timeSeconds]);
  const displayedSeconds = scrubSeconds ?? props.timeSeconds;
  const commitSeek = () => {
    if (scrubSeconds === null) return;
    props.onSeek(scrubSeconds);
    setScrubSeconds(null);
  };
  const selectedEvent = props.project.timeline.find((event) => event.id === selectedEventId) ?? props.project.timeline[0];
  const duration = props.project.simulation.durationSeconds;
  const patchTimeline = (timeline: EngineTimelineEvent[]) => props.onProjectChange({ ...props.project, timeline });
  const patchEvent = (values: Partial<EngineTimelineEvent>) => {
    if (!selectedEvent) return;
    patchTimeline(props.project.timeline.map((event) => event.id === selectedEvent.id ? { ...event, ...values } : event));
  };
  const addEvent = (action: EngineTimelineEvent["action"]) => {
    let index = props.project.timeline.length + 1;
    while (props.project.timeline.some((event) => event.id === `${action}-${index}`)) index += 1;
    const event: EngineTimelineEvent = {
      id: `${action}-${index}`,
      atSeconds: Math.min(props.timeSeconds, Math.max(0, duration - 0.1)),
      durationSeconds: Math.min(1, duration),
      action,
      strength: action === "magnetic-pulse" ? 2 : 1,
    };
    patchTimeline([...props.project.timeline, event]);
    setSelectedEventId(event.id);
  };

  return (
    <section className={`timeline-panel glass-panel ${props.collapsed ? "collapsed" : ""}`} aria-label="Timeline">
      <header className="timeline-header">
        <div className="transport-controls">
          <button type="button" className="icon-button" onClick={props.onReset} title="Reset to time zero" aria-label="Reset timeline"><RotateCcw /></button>
          <button type="button" className="play-button" onClick={props.onPlayPause} disabled={!props.ready} aria-label={props.playing ? "Pause simulation" : "Play simulation"}>
            {props.playing ? <Pause /> : <Play />}
          </button>
          <button type="button" className="icon-button" onClick={props.onStep} disabled={!props.ready} title="Advance one fixed step" aria-label="Step simulation"><StepForward /></button>
          <code className="timecode">{formatTime(props.timeSeconds)}</code>
          <span className="time-total">/ {formatTime(duration)}</span>
        </div>
        <div className="timeline-actions">
          {!props.collapsed ? (
            <>
              <button type="button" onClick={() => addEvent("magnetic-pulse")}>+ Pulse</button>
              <button type="button" onClick={() => addEvent("coalesce")}>+ Merge</button>
            </>
          ) : null}
          <button type="button" className="icon-button" onClick={props.onToggleCollapsed} aria-label={props.collapsed ? "Expand timeline" : "Collapse timeline"}>
            {props.collapsed ? <ChevronUp /> : <ChevronDown />}
          </button>
        </div>
      </header>
      {!props.collapsed ? (
        <div className="timeline-body">
          <div className="timeline-track-wrap">
            <div className="timeline-ruler" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <span key={fraction}>{(duration * fraction).toFixed(0)}s</span>)}
            </div>
            <div className="timeline-track">
              <div className="playhead" style={{ left: `${Math.min(100, displayedSeconds / duration * 100)}%` }} />
              {props.project.timeline.map((event) => (
                <button
                  type="button"
                  key={event.id}
                  className={`event-block ${event.action} ${selectedEvent?.id === event.id ? "selected" : ""}`}
                  style={{ left: `${event.atSeconds / duration * 100}%`, width: `${Math.max(1.5, event.durationSeconds / duration * 100)}%` }}
                  onClick={() => setSelectedEventId(event.id)}
                  title={`${event.id}: ${event.atSeconds}s for ${event.durationSeconds}s`}
                >{event.action === "magnetic-pulse" ? "PULSE" : "MERGE"}</button>
              ))}
              <input
                aria-label="Simulation playhead"
                type="range"
                min={0}
                max={duration}
                step={props.project.simulation.fixedDeltaSeconds}
                value={Math.min(displayedSeconds, duration)}
                onChange={(event) => setScrubSeconds(event.target.valueAsNumber)}
                onPointerUp={commitSeek}
                onPointerCancel={() => setScrubSeconds(null)}
                onKeyUp={commitSeek}
                onBlur={commitSeek}
              />
            </div>
          </div>
          {selectedEvent ? (
            <div className="event-editor">
              <div className="event-editor-title">
                <code>{selectedEvent.id}</code>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label="Delete selected event"
                  onClick={() => {
                    patchTimeline(props.project.timeline.filter((event) => event.id !== selectedEvent.id));
                    setSelectedEventId(undefined);
                  }}
                ><Trash2 /></button>
              </div>
              <SelectField
                label="Action"
                value={selectedEvent.action}
                options={[{ value: "magnetic-pulse", label: "Magnetic pulse" }, { value: "coalesce", label: "Coalescence" }]}
                onChange={(action) => patchEvent({ action: action as EngineTimelineEvent["action"] })}
              />
              <div className="event-parameter-grid">
                <ParameterField label="Start" value={selectedEvent.atSeconds} min={0} max={duration} step={0.05} unit="s" onChange={(atSeconds) => patchEvent({ atSeconds })} />
                <ParameterField label="Duration" value={selectedEvent.durationSeconds} min={0.01} max={duration} step={0.05} unit="s" onChange={(durationSeconds) => patchEvent({ durationSeconds })} />
                <ParameterField label="Strength" value={selectedEvent.strength} min={0} max={10} step={0.05} onChange={(strength) => patchEvent({ strength })} />
              </div>
            </div>
          ) : <p className="empty-note">No timeline events. Add a pulse or merge at the playhead.</p>}
        </div>
      ) : null}
    </section>
  );
}
