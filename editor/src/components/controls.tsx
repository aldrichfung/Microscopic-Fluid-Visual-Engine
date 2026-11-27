import type { ReactNode } from "react";

interface ParameterFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
}

export function ParameterField({ label, value, min, max, step, unit, onChange }: ParameterFieldProps) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="parameter-field">
      <div className="parameter-heading">
        <label htmlFor={id}>{label}</label>
        <span className="numeric-value">
          <input
            id={id}
            aria-label={`${label} value`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(5))}
            onChange={(event) => {
              const next = event.target.valueAsNumber;
              if (Number.isFinite(next)) onChange(next);
            }}
          />
          {unit ? <span>{unit}</span> : null}
        </span>
      </div>
      <input
        className="parameter-range"
        aria-label={`${label} slider`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </div>
  );
}

interface ToggleFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function ToggleField({ label, checked, onChange }: ToggleFieldProps) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}

interface SelectFieldProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { value: string; label: string }[];
  readonly onChange: (value: string) => void;
}

export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function ColorField({ label, value, onChange }: {
  readonly label: string;
  readonly value: readonly [number, number, number, number];
  readonly onChange: (value: [number, number, number, number]) => void;
}) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-control">
        <input
          type="color"
          value={rgbToHex(value)}
          onChange={(event) => onChange([...hexToRgb(event.target.value), value[3]])}
        />
        <code>{rgbToHex(value)}</code>
      </span>
    </label>
  );
}

export function InspectorSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function rgbToHex(color: readonly [number, number, number, number]): string {
  return `#${color.slice(0, 3).map((channel) => (
    Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0")
  )).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}
