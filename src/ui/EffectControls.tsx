import { Field } from './RibbonControls';

export type EffectType = 'none' | 'fade';

/** Shared transition selector so ribbon and inspector use the same options. */
export function TransitionSelect({
  value,
  onChange,
  className = 'field',
  ariaLabel,
}: {
  value: EffectType;
  onChange: (value: EffectType) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <label className={className}>
      <span>效果</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value as EffectType)}
      >
        <option value="none">无</option>
        <option value="fade">交叉淡化</option>
      </select>
    </label>
  );
}

/** Shared layer animation selector. */
export function LayerEffectSelect({
  value,
  onChange,
  className = 'field',
  ariaLabel,
}: {
  value: EffectType;
  onChange: (value: EffectType) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <label className={className}>
      <span>动作</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value as EffectType)}
      >
        <option value="none">无</option>
        <option value="fade">淡入</option>
      </select>
    </label>
  );
}

export function DurationField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <Field
      label="时长（秒）"
      type="number"
      min={0.1}
      max={3}
      step={0.1}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
