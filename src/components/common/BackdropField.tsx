/** Solid / linear / radial backdrop editor, used by every tab's sidebar. */
import type { Backdrop, BackdropType } from "@/lib/backdrop";
import { ColorField, Segmented, Slider } from "./fields";

const TYPE_OPTS: { value: BackdropType; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
];

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
