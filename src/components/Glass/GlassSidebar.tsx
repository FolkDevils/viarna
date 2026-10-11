/** Control rail for the Glass tab. */
import { useGlass, type GlassPreset, type GlassShape } from "@/state/glass";
import { Section } from "@/components/common/Section";
import { Slider, Segmented, ColorField } from "@/components/common/fields";
import { BackdropField } from "@/components/common/BackdropField";
import { ExportPanel } from "@/components/common/ExportPanel";
import { exporters, stamp } from "@/lib/export/registry";
import { downloadBlob } from "@/lib/svg/download";
import "@/components/Sidebar/Sidebar.css";

const PRESET_OPTS: { value: GlassPreset; label: string }[] = [
  { value: "viarna", label: "Viarna" },
  { value: "deep", label: "Deep" },
  { value: "energy", label: "Energy" },
];

type NumKey = { [K in keyof GlassShape]: GlassShape[K] extends number ? K : never }[keyof GlassShape];
const SHAPE_SLIDERS: { key: NumKey; label: string; min: number; max: number; step: number }[] = [
  { key: "strands", label: "Strands", min: 1, max: 12, step: 1 },
  { key: "amplitude", label: "Wave height", min: 0, max: 3, step: 0.01 },
  { key: "waves", label: "Waves", min: 0.25, max: 6, step: 0.05 },
  { key: "depth", label: "Depth swing", min: 0, max: 3, step: 0.01 },
  { key: "separation", label: "Separation", min: 0, max: 4, step: 0.01 },
  { key: "variation", label: "Individuality", min: 0, max: 1, step: 0.01 },
  { key: "organic", label: "Organic", min: 0, max: 1, step: 0.01 },
  { key: "swell", label: "Thickness swell", min: 0, max: 1, step: 0.01 },
  { key: "spread", label: "Bundle wind", min: 0, max: 2, step: 0.01 },
  { key: "twist", label: "Bundle twist", min: -4, max: 4, step: 0.05 },
  { key: "width", label: "Ribbon width", min: 0.02, max: 1.5, step: 0.01 },
  { key: "thickness", label: "Ribbon thickness", min: 0.005, max: 1.5, step: 0.005 },
  { key: "roll", label: "Ribbon roll", min: -4, max: 4, step: 0.05 },
  { key: "length", label: "Length", min: 2, max: 30, step: 0.1 },
];

export default function GlassSidebar() {
  const s = useGlass();
  const { shape, look } = s;

  return (
    <aside className="sidebar">
      <Section title="Motion">
        <div className="btn-row">
          <button className="btn primary" onClick={() => s.setPlaying(!s.playing)}>
            {s.playing ? "Pause" : "Play"}
          </button>
        </div>
        <Slider label="Flow speed" value={s.flowRpm} min={0} max={30} step={0.5} suffix=" /min" onChange={s.setFlowRpm} />
        <p className="hint">Drag the stage to orbit the camera, scroll to zoom.</p>
      </Section>

      <Section
        title="Shape"
        action={
          <button className="mini-btn" onClick={() => s.setShape({ seed: Math.floor(Math.random() * 1e6) })}>
            Shuffle
          </button>
        }
      >
        <Segmented value={s.preset ?? ("" as GlassPreset)} options={PRESET_OPTS} onChange={s.applyPreset} />
        {SHAPE_SLIDERS.map((f) => (
          <Slider
            key={f.key}
            label={f.label}
            value={shape[f.key]}
            min={f.min}
            max={f.max}
            step={f.step}
            onChange={(v) => s.setShape({ [f.key]: v })}
          />
        ))}
      </Section>

      <Section title="Glass">
        <ColorField label="Glass colour" value={look.color} onChange={(color) => s.setLook({ color })} />
        <Slider label="Colour density" value={look.density} min={0} max={1} step={0.005} onChange={(density) => s.setLook({ density })} />
        <Slider label="Bounce colour" value={look.bounceTint} min={0} max={1} step={0.01} onChange={(bounceTint) => s.setLook({ bounceTint })} />
        <Slider label="Refraction (IOR)" value={look.ior} min={1} max={2.4} step={0.01} onChange={(ior) => s.setLook({ ior })} />
        <Slider label="Dispersion" value={look.dispersion} min={0} max={1} step={0.01} onChange={(dispersion) => s.setLook({ dispersion })} />
        <Slider label="Reflections" value={look.reflection} min={0} max={3} step={0.01} onChange={(reflection) => s.setLook({ reflection })} />
        <Slider label="Iridescent sheen" value={look.sheen} min={0} max={1} step={0.01} onChange={(sheen) => s.setLook({ sheen })} />
        <Slider label="Background bend" value={look.distortion} min={0} max={8} step={0.05} onChange={(distortion) => s.setLook({ distortion })} />
        <p className="hint">Light passing straight through stays pale; light that travels further or bounces inside picks up the colour — edges, overlaps, streaks.</p>
      </Section>

      <Section title="Studio lights">
        <ColorField label="Softbox colour" value={look.highlight} onChange={(highlight) => s.setLook({ highlight })} />
        <Slider label="Softbox brightness" value={look.lights} min={0} max={3} step={0.01} onChange={(lights) => s.setLook({ lights })} />
        <Slider label="Studio contrast" value={look.studio} min={0} max={1} step={0.01} onChange={(studio) => s.setLook({ studio })} />
      </Section>

      <Section title="Stage">
        <BackdropField value={look.backdrop} onChange={s.setBackdrop} />
      </Section>

      <ExportPanel
        name="viarna-glass"
        getExporter={() => exporters.glass}
        loopSeconds={s.flowRpm > 0 ? 60 / s.flowRpm : null}
        loopHint="One flow cycle loops seamlessly."
      >
        <button
          className="mini-btn"
          onClick={async () => {
            const ex = exporters.glass;
            if (ex) downloadBlob(`viarna-glass-${stamp()}.glb`, await ex.glb());
          }}
        >
          3D model (.glb)
        </button>
      </ExportPanel>
    </aside>
  );
}
