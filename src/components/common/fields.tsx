/** Small, styled form controls shared across the panels. */
import "./fields.css";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: SliderProps) {
  return (
    <label className="field field-slider">
      <span className="field-label">
        {label}
        <span className="field-value">
          {Number.isInteger(step) ? Math.round(value) : Math.round(value * 100) / 100}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="segmented" role="tablist">
        {options.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={o.value === value}
            className={o.value === value ? "seg active" : "seg"}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="field-toggle">
      <span className="field-label">{label}</span>
      <span className={checked ? "switch on" : "switch"}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={label}
        />
      </span>
    </label>
  );
}

interface ColorProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

export function ColorField({ label, value, onChange }: ColorProps) {
  return (
    <label className="field field-color">
      <span className="field-label">{label}</span>
      <div className="color-row">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          className="color-hex"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}
