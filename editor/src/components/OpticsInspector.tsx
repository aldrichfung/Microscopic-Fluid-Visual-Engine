import type { Project } from "@mfve/engine";
import { InspectorSection, ParameterField } from "./controls";

export function OpticsInspector({ project, onProjectChange }: {
  readonly project: Project;
  readonly onProjectChange: (project: Project) => void;
}) {
  const patch = (values: Partial<Project["optics"]>) => {
    onProjectChange({ ...project, optics: { ...project.optics, ...values } });
  };
  return (
    <div className="inspector-content">
      <InspectorSection title="Transmission">
        <ParameterField label="Exposure" value={project.optics.exposure} min={0} max={10} step={0.05} onChange={(exposure) => patch({ exposure })} />
        <ParameterField label="Absorption R" value={project.optics.absorption[0]} min={0} max={5} step={0.01} onChange={(value) => patch({ absorption: [value, project.optics.absorption[1], project.optics.absorption[2]] })} />
        <ParameterField label="Absorption G" value={project.optics.absorption[1]} min={0} max={5} step={0.01} onChange={(value) => patch({ absorption: [project.optics.absorption[0], value, project.optics.absorption[2]] })} />
        <ParameterField label="Absorption B" value={project.optics.absorption[2]} min={0} max={5} step={0.01} onChange={(value) => patch({ absorption: [project.optics.absorption[0], project.optics.absorption[1], value] })} />
      </InspectorSection>
      <InspectorSection title="Interface lighting">
        <ParameterField label="Specular" value={project.optics.specularStrength} min={0} max={10} step={0.05} onChange={(specularStrength) => patch({ specularStrength })} />
        <ParameterField label="Dark field" value={project.optics.darkFieldStrength} min={0} max={10} step={0.05} onChange={(darkFieldStrength) => patch({ darkFieldStrength })} />
        <ParameterField label="Rim sharpness" value={project.optics.rimSharpness} min={0.1} max={100} step={0.1} onChange={(rimSharpness) => patch({ rimSharpness })} />
      </InspectorSection>
      <InspectorSection title="Thickness interference">
        <ParameterField label="Interference" value={project.optics.interferenceStrength} min={0} max={10} step={0.05} onChange={(interferenceStrength) => patch({ interferenceStrength })} />
        <ParameterField label="Optical frequency" value={project.optics.interferenceScale} min={0.1} max={100} step={0.1} onChange={(interferenceScale) => patch({ interferenceScale })} />
      </InspectorSection>
    </div>
  );
}
