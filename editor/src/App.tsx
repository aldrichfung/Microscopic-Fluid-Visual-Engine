import { useRef, useState } from "react";
import { Download, Eye, EyeOff, Layers3, Save, SlidersHorizontal, Upload, X } from "lucide-react";
import { parseProject, serializeProject, updateLayer } from "@/lib/engine-boundary";
import type { Project } from "@mfve/engine";
import { LayerInspector } from "@/components/LayerInspector";
import { OpticsInspector } from "@/components/OpticsInspector";
import { TimelinePanel } from "@/components/TimelinePanel";
import { useStudioPreview } from "@/hooks/useStudioPreview";
import { createStudioProject, formatTime, slugify, type StudioPreset } from "@/lib/project";
import "./App.css";

const LOCAL_PROJECT_KEY = "mfve.studio.project.v1";

function loadInitialProject(): Project {
  try {
    const stored = localStorage.getItem(LOCAL_PROJECT_KEY);
    if (stored) return parseProject(stored);
  } catch {
    // An invalid local document should not prevent the studio from opening.
  }
  return createStudioProject();
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<Project>(loadInitialProject);
  const [selectedLayerId, setSelectedLayerId] = useState(project.layers[0]?.id ?? "");
  const [inspectorTab, setInspectorTab] = useState<"layer" | "optics">("layer");
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "inspector" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("Editing resets the simulation to time zero.");
  const preview = useStudioPreview(canvasRef, project);
  const selectedLayer = project.layers.find((layer) => layer.id === selectedLayerId) ?? project.layers[0];

  const changeProject = (next: Project) => {
    setProject(next);
    setDirty(true);
    setNotice("Simulation reset with updated parameters.");
  };

  const loadProject = (next: Project) => {
    setProject(next);
    setSelectedLayerId(next.layers[0]?.id ?? "");
    setDirty(false);
    setNotice(`Loaded ${next.name}.`);
  };

  const saveLocal = () => {
    localStorage.setItem(LOCAL_PROJECT_KEY, serializeProject(project));
    setDirty(false);
    setNotice("Project saved in this browser.");
  };

  const exportProject = () => {
    const url = URL.createObjectURL(new Blob([serializeProject(project)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(project.name)}.mfve.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Project document exported.");
  };

  const importProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      loadProject(parseProject(await file.text()));
    } catch (error) {
      setNotice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <main className="studio-shell">
      <canvas ref={canvasRef} className="optical-canvas" aria-label="Live microscopic fluid simulation" />
      <div className="canvas-vignette" aria-hidden="true" />

      <header className="studio-header">
        <div className="brand-block">
          <span className="brand-index">MFVE</span>
          <div>
            <h1>Microscopic Fluid Studio</h1>
            <p>Field authoring / optical experiment</p>
          </div>
        </div>
        <div className="file-actions">
          <label className="preset-picker">
            <span>Preset</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) return;
                loadProject(createStudioProject(event.target.value as StudioPreset));
              }}
            >
              <option value="" disabled>Load study</option>
              <option value="magnetic">Magnetic membranes</option>
              <option value="transport">Ember transport</option>
            </select>
          </label>
          <button type="button" onClick={() => fileInputRef.current?.click()} title="Import project"><Upload /><span>Import</span></button>
          <button type="button" onClick={exportProject} title="Export project"><Download /><span>Export</span></button>
          <button type="button" onClick={saveLocal} title="Save in this browser"><Save /><span>Save</span>{dirty ? <i className="dirty-dot" /> : null}</button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,.mfve.json,application/json"
            onChange={(event) => {
              void importProject(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        <div className="runtime-status" title={preview.error}>
          <span className={`status-light ${preview.status}`} />
          <div>
            <strong>{preview.status === "ready" ? `${preview.adapter?.architecture || "GPU"} / ${preview.fps} FPS` : preview.status}</strong>
            <span>{project.grid.width}² · {Math.round(1 / project.simulation.fixedDeltaSeconds)} Hz fixed</span>
          </div>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Editor panels">
        <button type="button" onClick={() => setMobilePanel(mobilePanel === "layers" ? null : "layers")}><Layers3 />Layers</button>
        <button type="button" onClick={() => setMobilePanel(mobilePanel === "inspector" ? null : "inspector")}><SlidersHorizontal />Inspect</button>
      </nav>

      <aside className={`scene-panel glass-panel ${mobilePanel === "layers" ? "mobile-open" : ""}`}>
        <div className="panel-heading">
          <span>01 / Project</span>
          <button type="button" className="mobile-close" onClick={() => setMobilePanel(null)} aria-label="Close layers panel"><X /></button>
        </div>
        <div className="project-fields">
          <label className="text-field">
            <span>Study name</span>
            <input value={project.name} onChange={(event) => changeProject({ ...project, name: event.target.value })} />
          </label>
          <div className="project-metadata">
            <label>Seed<input type="number" value={project.seed} min={0} max={0xffffffff} onChange={(event) => {
              if (Number.isFinite(event.target.valueAsNumber)) changeProject({ ...project, seed: Math.floor(event.target.valueAsNumber) });
            }} /></label>
            <label>Duration<input type="number" value={project.simulation.durationSeconds} min={0.1} max={3600} step={0.5} onChange={(event) => {
              if (event.target.valueAsNumber > 0) changeProject({ ...project, simulation: { ...project.simulation, durationSeconds: event.target.valueAsNumber } });
            }} /></label>
          </div>
        </div>
        <div className="panel-heading layer-heading"><span>02 / Layers</span><small>{project.layers.length.toString().padStart(2, "0")}</small></div>
        <div className="layer-list">
          {project.layers.map((layer, index) => (
            <div className={`layer-row ${selectedLayer?.id === layer.id ? "active" : ""}`} key={layer.id}>
              <button type="button" className="layer-select" onClick={() => {
                setSelectedLayerId(layer.id);
                setInspectorTab("layer");
              }}>
                <span>{(index + 1).toString().padStart(2, "0")}</span>
                <div><strong>{layer.id}</strong><small>{layer.kind}</small></div>
              </button>
              <button
                type="button"
                className="visibility-button"
                aria-label={`${layer.enabled ? "Disable" : "Enable"} ${layer.id}`}
                onClick={() => changeProject(updateLayer(project, layer.id, () => ({ ...layer, enabled: !layer.enabled })))}
              >{layer.enabled ? <Eye /> : <EyeOff />}</button>
            </div>
          ))}
        </div>
        <div className="scene-readout">
          <span>Simulation</span><code>{project.grid.width} × {project.grid.height}</code>
          <span>Output</span><code>{project.output.width} × {project.output.height}</code>
          <span>Playhead</span><code>{formatTime(preview.timeSeconds)}</code>
        </div>
      </aside>

      <aside className={`inspector-panel glass-panel ${mobilePanel === "inspector" ? "mobile-open" : ""}`}>
        <div className="inspector-tabs">
          <button type="button" className={inspectorTab === "layer" ? "active" : ""} onClick={() => setInspectorTab("layer")}>Layer</button>
          <button type="button" className={inspectorTab === "optics" ? "active" : ""} onClick={() => setInspectorTab("optics")}>Optics</button>
          <button type="button" className="mobile-close" onClick={() => setMobilePanel(null)} aria-label="Close inspector"><X /></button>
        </div>
        {inspectorTab === "layer" && selectedLayer ? (
          <LayerInspector project={project} layerId={selectedLayer.id} onProjectChange={changeProject} />
        ) : (
          <OpticsInspector project={project} onProjectChange={changeProject} />
        )}
      </aside>

      <TimelinePanel
        project={project}
        timeSeconds={preview.timeSeconds}
        playing={preview.playing}
        ready={preview.status === "ready"}
        collapsed={timelineCollapsed}
        onToggleCollapsed={() => setTimelineCollapsed(!timelineCollapsed)}
        onPlayPause={() => preview.setPlaying(!preview.playing)}
        onReset={preview.reset}
        onStep={preview.step}
        onSeek={preview.seek}
        onProjectChange={changeProject}
      />

      <div className="studio-notice" role="status">
        <span>{preview.status === "error" ? `Preview unavailable: ${preview.error}` : notice}</span>
        <span>{dirty ? "UNSAVED" : "DOCUMENT READY"}</span>
      </div>
    </main>
  );
}
