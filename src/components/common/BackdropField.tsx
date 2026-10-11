/** Solid / linear / radial backdrop editor, used by every tab's sidebar. */
import { backdropCss, type Backdrop, type BackdropType } from "@/lib/backdrop";
import { BRAND, BRAND_BACKDROPS, type BrandBackdrop } from "@/lib/brand";
import { ColorField, Segmented, Slider } from "./fields";

const TYPE_OPTS: { value: BackdropType; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
];

const same = (a: Backdrop, b: Backdrop) =>
  a.type === b.type &&
  a.from.toLowerCase() === b.from.toLowerCase() &&
  (a.type === "solid" || (a.to.toLowerCase() === b.to.toLowerCase() && (a.type !== "linear" || a.angle === b.angle)));

export function BackdropField({
  value,
  onChange,
}: {
  value: Backdrop;
  onChange: (patch: Partial<Backdrop>) => void;
}) {
  const grad = value.type !== "solid";
  return (
    <>
      <Segmented label="Background" value={value.type} options={TYPE_OPTS} onChange={(type) => onChange({ type })} />
      <div className="brand-chips">
        {(Object.keys(BRAND_BACKDROPS) as BrandBackdrop[]).map((k) => {
          const { label, backdrop } = BRAND_BACKDROPS[k];
          return (
            <button
              key={k}
              type="button"
              className={same(value, backdrop) ? "brand-chip active" : "brand-chip"}
              style={{
                background: backdropCss(backdrop),
                color: k === "depth" || k === "energy" ? BRAND.white : BRAND.deepBlue,
              }}
              onClick={() => onChange({ ...backdrop })}
            >
              {label}
            </button>
          );
        })}
      </div>
      <ColorField
        label={grad ? (value.type === "radial" ? "Center" : "Start") : "Color"}
        value={value.from}
        onChange={(from) => onChange({ from })}
      />
      {grad && (
        <ColorField
          label={value.type === "radial" ? "Edge" : "End"}
          value={value.to}
          onChange={(to) => onChange({ to })}
        />
      )}
      {value.type === "linear" && (
        <Slider label="Angle" value={value.angle} min={0} max={360} suffix="°" onChange={(angle) => onChange({ angle })} />
      )}
    </>
  );
}
