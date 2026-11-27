import { useState } from "react";
import type {
  Droplet,
  DropletLayer,
  InjectionSource,
  MagneticLayer,
  Project,
  TransportLayer,
} from "@mfve/engine";
import { updateLayer } from "@/lib/project";
import { ColorField, InspectorSection, ParameterField, SelectField, ToggleField } from "./controls";

interface LayerInspectorProps {
  readonly project: Project;
  readonly layerId: string;
  readonly onProjectChange: (project: Project) => void;
}

export function LayerInspector({ project, layerId, onProjectChange }: LayerInspectorProps) {
  const layer = project.layers.find((candidate) => candidate.id === layerId) ?? project.layers[0];
  if (!layer) return null;

  return (
    <div className="inspector-content">
      <InspectorSection title="Layer identity">
        <div className="text-field">
          <span>Identifier</span>
          <code>{layer.id}</code>
        </div>
        <ToggleField
          label="Enabled"
          checked={layer.enabled}
          onChange={(enabled) => onProjectChange(updateLayer(project, layer.id, () => ({ ...layer, enabled })))}
        />
      </InspectorSection>
      {layer.kind === "magnetic" ? (
        <MagneticInspector project={project} layer={layer} onProjectChange={onProjectChange} />
      ) : null}
      {layer.kind === "droplets" ? (
        <DropletInspector project={project} layer={layer} onProjectChange={onProjectChange} />
      ) : null}
      {layer.kind === "transport" ? (
        <TransportInspector project={project} layer={layer} onProjectChange={onProjectChange} />
      ) : null}
    </div>
  );
}

function MagneticInspector({ project, layer, onProjectChange }: {
  readonly project: Project;
  readonly layer: MagneticLayer;
  readonly onProjectChange: (project: Project) => void;
}) {
  const patch = (values: Partial<MagneticLayer>) => {
    onProjectChange(updateLayer(project, layer.id, () => ({ ...layer, ...values })));
  };
  return (
    <>
      <InspectorSection title="Initial condition">
        <SelectField
          label="Pattern"
          value={layer.initialPattern}
          options={[
            { value: "noise", label: "Seeded noise" },
            { value: "bands", label: "Perturbed bands" },
            { value: "droplet", label: "Circular domain" },
          ]}
          onChange={(initialPattern) => patch({ initialPattern: initialPattern as MagneticLayer["initialPattern"] })}
        />
        <ParameterField label="Pattern scale" value={layer.patternScale} min={0.005} max={0.5} step={0.005} onChange={(patternScale) => patch({ patternScale })} />
      </InspectorSection>
      <InspectorSection title="Phase dynamics">
        <ParameterField label="Interface tension" value={layer.interfaceTension} min={0} max={2} step={0.01} onChange={(interfaceTension) => patch({ interfaceTension })} />
        <ParameterField label="Separation" value={layer.separation} min={0} max={2} step={0.01} onChange={(separation) => patch({ separation })} />
        <ParameterField label="Coarsening" value={layer.coarsening} min={0} max={2} step={0.01} onChange={(coarsening) => patch({ coarsening })} />
        <ParameterField label="Mobility" value={layer.mobility} min={0.01} max={2} step={0.01} onChange={(mobility) => patch({ mobility })} />
      </InspectorSection>
      <InspectorSection title="Magnetic control">
        <ParameterField label="Field strength" value={layer.magneticStrength} min={0} max={10} step={0.05} onChange={(magneticStrength) => patch({ magneticStrength })} />
        <ParameterField label="Position X" value={layer.fieldPosition[0]} min={0} max={1} step={0.001} onChange={(x) => patch({ fieldPosition: [x, layer.fieldPosition[1]] })} />
        <ParameterField label="Position Y" value={layer.fieldPosition[1]} min={0} max={1} step={0.001} onChange={(y) => patch({ fieldPosition: [layer.fieldPosition[0], y] })} />
        <ParameterField label="Velocity X" value={layer.fieldVelocity[0]} min={-0.5} max={0.5} step={0.001} onChange={(x) => patch({ fieldVelocity: [x, layer.fieldVelocity[1]] })} />
        <ParameterField label="Velocity Y" value={layer.fieldVelocity[1]} min={-0.5} max={0.5} step={0.001} onChange={(y) => patch({ fieldVelocity: [layer.fieldVelocity[0], y] })} />
      </InspectorSection>
      <InspectorSection title="Material colors">
        <ColorField label="Dark domain" value={layer.darkColor} onChange={(darkColor) => patch({ darkColor })} />
        <ColorField label="Luminous domain" value={layer.luminousColor} onChange={(luminousColor) => patch({ luminousColor })} />
      </InspectorSection>
    </>
  );
}

function DropletInspector({ project, layer, onProjectChange }: {
  readonly project: Project;
  readonly layer: DropletLayer;
  readonly onProjectChange: (project: Project) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeIndex = Math.min(selectedIndex, Math.max(0, layer.droplets.length - 1));
  const selected = layer.droplets[activeIndex];
  const patch = (values: Partial<DropletLayer>) => {
    onProjectChange(updateLayer(project, layer.id, () => ({ ...layer, ...values })));
  };
  const patchDroplet = (values: Partial<Droplet>) => {
    if (!selected) return;
    patch({
      droplets: layer.droplets.map((droplet, index) => index === activeIndex ? { ...droplet, ...values } : droplet),
    });
  };
  const addDroplet = () => {
    const index = layer.droplets.length + 1;
    patch({
      droplets: [...layer.droplets, {
        id: `droplet-${index}`,
        position: [0.5, 0.5],
        radius: 0.055,
        velocity: [0.01, -0.006],
        opticalThickness: 1,
        refractiveIndex: 1.36,
        mobility: 1,
      }],
    });
    setSelectedIndex(layer.droplets.length);
  };
  return (
    <>
      <InspectorSection title="Membrane behavior">
        <ParameterField label="Coalescence" value={layer.coalescence} min={0} max={1} step={0.01} onChange={(coalescence) => patch({ coalescence })} />
        <ParameterField label="Membrane strength" value={layer.membraneStrength} min={0} max={10} step={0.05} onChange={(membraneStrength) => patch({ membraneStrength })} />
      </InspectorSection>
      <InspectorSection title={`Droplets / ${layer.droplets.length}`}>
        <div className="inline-actions">
          <button type="button" onClick={addDroplet} disabled={layer.droplets.length >= 64}>Add droplet</button>
          <button
            type="button"
            onClick={() => patch({ droplets: layer.droplets.filter((_, index) => index !== activeIndex) })}
            disabled={!selected}
          >Remove</button>
        </div>
        {selected ? (
          <>
            <SelectField
              label="Selected"
              value={String(activeIndex)}
              options={layer.droplets.map((droplet, index) => ({ value: String(index), label: droplet.id }))}
              onChange={(value) => setSelectedIndex(Number(value))}
            />
            <ParameterField label="Position X" value={selected.position[0]} min={0} max={1} step={0.001} onChange={(x) => patchDroplet({ position: [x, selected.position[1]] })} />
            <ParameterField label="Position Y" value={selected.position[1]} min={0} max={1} step={0.001} onChange={(y) => patchDroplet({ position: [selected.position[0], y] })} />
            <ParameterField label="Radius" value={selected.radius} min={0.005} max={0.5} step={0.005} onChange={(radius) => patchDroplet({ radius })} />
            <ParameterField label="Velocity X" value={selected.velocity[0]} min={-0.5} max={0.5} step={0.001} onChange={(x) => patchDroplet({ velocity: [x, selected.velocity[1]] })} />
            <ParameterField label="Velocity Y" value={selected.velocity[1]} min={-0.5} max={0.5} step={0.001} onChange={(y) => patchDroplet({ velocity: [selected.velocity[0], y] })} />
            <ParameterField label="Optical thickness" value={selected.opticalThickness} min={0} max={10} step={0.05} onChange={(opticalThickness) => patchDroplet({ opticalThickness })} />
            <ParameterField label="Refractive index" value={selected.refractiveIndex} min={1} max={3} step={0.01} onChange={(refractiveIndex) => patchDroplet({ refractiveIndex })} />
            <ParameterField label="Mobility" value={selected.mobility} min={0} max={2} step={0.01} onChange={(mobility) => patchDroplet({ mobility })} />
          </>
        ) : <p className="empty-note">No droplets. Add one to begin.</p>}
      </InspectorSection>
    </>
  );
}

function TransportInspector({ project, layer, onProjectChange }: {
  readonly project: Project;
  readonly layer: TransportLayer;
  readonly onProjectChange: (project: Project) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = layer.sources[Math.min(selectedIndex, Math.max(0, layer.sources.length - 1))];
  const activeIndex = Math.min(selectedIndex, Math.max(0, layer.sources.length - 1));
  const patch = (values: Partial<TransportLayer>) => {
    onProjectChange(updateLayer(project, layer.id, () => ({ ...layer, ...values })));
  };
  const patchSource = (values: Partial<InjectionSource>) => {
    if (!selected) return;
    patch({ sources: layer.sources.map((source, index) => index === activeIndex ? { ...source, ...values } : source) });
  };
  return (
    <>
      <InspectorSection title="Incompressible transport">
        <ParameterField label="Pressure iterations" value={layer.pressureIterations} min={0} max={100} step={1} onChange={(pressureIterations) => patch({ pressureIterations })} />
        <ParameterField label="Velocity dissipation" value={layer.velocityDissipation} min={0} max={1} step={0.001} onChange={(velocityDissipation) => patch({ velocityDissipation })} />
        <ParameterField label="Dye dissipation" value={layer.dyeDissipation} min={0} max={1} step={0.001} onChange={(dyeDissipation) => patch({ dyeDissipation })} />
      </InspectorSection>
      {selected ? (
        <InspectorSection title="Injection source">
          <SelectField
            label="Selected"
            value={String(activeIndex)}
            options={layer.sources.map((source, index) => ({ value: String(index), label: source.id }))}
            onChange={(value) => setSelectedIndex(Number(value))}
          />
          <ParameterField label="Position X" value={selected.position[0]} min={0} max={1} step={0.001} onChange={(x) => patchSource({ position: [x, selected.position[1]] })} />
          <ParameterField label="Position Y" value={selected.position[1]} min={0} max={1} step={0.001} onChange={(y) => patchSource({ position: [selected.position[0], y] })} />
          <ParameterField label="Radius" value={selected.radius} min={0.005} max={1} step={0.005} onChange={(radius) => patchSource({ radius })} />
          <ParameterField label="Strength" value={selected.strength} min={0} max={10} step={0.05} onChange={(strength) => patchSource({ strength })} />
          <ParameterField label="Impulse X" value={selected.impulse[0]} min={-2} max={2} step={0.01} onChange={(x) => patchSource({ impulse: [x, selected.impulse[1]] })} />
          <ParameterField label="Impulse Y" value={selected.impulse[1]} min={-2} max={2} step={0.01} onChange={(y) => patchSource({ impulse: [selected.impulse[0], y] })} />
          <ParameterField label="Start time" value={selected.startSeconds} min={0} max={project.simulation.durationSeconds} step={0.1} unit="s" onChange={(startSeconds) => patchSource({ startSeconds })} />
          <ParameterField label="Duration" value={selected.durationSeconds} min={0.01} max={project.simulation.durationSeconds} step={0.1} unit="s" onChange={(durationSeconds) => patchSource({ durationSeconds })} />
          <ColorField label="Pigment" value={selected.color} onChange={(color) => patchSource({ color })} />
        </InspectorSection>
      ) : null}
    </>
  );
}
