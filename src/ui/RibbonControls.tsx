import React from 'react';

/** Text/number field that commits on blur (and Enter), preserving edit semantics. */
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (v: any) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        key={String(value)}
        type={type}
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onBlur={(e) => {
          const v = type === 'number' ? Number(e.target.value) : e.target.value;
          if (v !== value) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function RibbonGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={title}>
      <div className="ribbon-group-controls">{children}</div>
      <span className="ribbon-group-title">{title}</span>
    </div>
  );
}
