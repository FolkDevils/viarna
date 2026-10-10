/** Control rail for the Orbit tab. Reuses the main sidebar's styles. */
import { useOrbit, MAX_CIRCLES, type Direction, type OrbitPreset } from "@/state/orbit";
import { Section } from "@/components/common/Section";
import { Slider, Segmented, ColorField, Toggle } from "@/components/common/fields";
import { BackdropField } from "@/components/common/BackdropField";
import { ExportPanel } from "@/components/common/ExportPanel";
import { exporters, stamp } from "@/lib/export/registry";
import { orbitAnimatedSvg } from "@/lib/orbit/svg";
import { downloadSVG } from "@/lib/svg/download";
import "@/components/Sidebar/Sidebar.css";
import "./Orbit.css";

const DIR_OPTS: { value: Direction; label: string }[] = [
  { value: "cw", label: "Clockwise ↻" },
  { value: "ccw", label: "Counter ↺" },
];

const PRESET_OPTS: { value: OrbitPreset; label: string }[] = [
  { value: "halo", label: "Halo" },
  { value: "tight", label: "Tight" },
  { value: "solid", label: "Solid" },
];

export default function OrbitSidebar() {
  const s = useOrbit();
  const { circles, selectedId, look } = s;
  const selected = circles.find((c) => c.id === selectedId) ?? null;
  // One lap of the slowest moving circle at the current RPM.
  const minSpeed = Math.min(...circles.filter((c) => c.speed > 0).map((c) => c.speed), Infinity);
  const loopSeconds = s.rpm > 0 && Number.isFinite(minSpeed) ? 60 / (s.rpm * minSpeed) : null;

  return (
    <aside className="sidebar">
      <Section title="Motion">
        <div className="btn-row">
          <button className="btn primary" onClick={() => s.setPlaying(!s.playing)}>
            {s.playing ? "Pause" : "Play"}
          </button>
        </div>
        <Slider label="Speed" value={s.rpm} min={0} max={30} step={0.5} suffix=" rpm" onChange={s.setRpm} />
        <div className="field">
          <span className="field-label">Set all</span>
          <div className="btn-row">
            <button className="mini-btn" onClick={() => s.setAllDirections("cw")}>↻ CW</button>
            <button className="mini-btn" onClick={() => s.setAllDirections("ccw")}>↺ CCW</button>
            <button className="mini-btn" onClick={() => s.setAllDirections("alternate")}>Alternate</button>
          </div>
        </div>
        <Toggle label="Show guides" checked={s.showGuides} onChange={s.setShowGuides} />
      </Section>

      <Section
        title="Circles"
        action={
          <button className="mini-btn" onClick={s.addCircle} disabled={circles.length >= MAX_CIRCLES}>
            + Add
          </button>
        }
      >
        <ul className="blob-list">
          {circles.map((c, i) => (
            <li
              key={c.id}
              className={c.id === selectedId ? "blob-row selected" : "blob-row"}
              onClick={() => s.select(c.id)}
            >
              <span className="blob-dot" />
              <span className="blob-name">Circle {i + 1}</span>
              <button
                className="dir-chip"
                title="Flip direction"
                onClick={(e) => {
                  e.stopPropagation();
                  s.updateCircle(c.id, { dir: c.dir === "cw" ? "ccw" : "cw" });
                }}
              >
                {c.dir === "cw" ? "↻ CW" : "↺ CCW"}
              </button>
              <button
                className="blob-del"
                aria-label="Remove circle"
                onClick={(e) => {
                  e.stopPropagation();
                  s.removeCircle(c.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {selected ? (
          <>
            <Segmented
              label="Direction"
              value={selected.dir}
              options={DIR_OPTS}
              onChange={(dir) => s.updateCircle(selected.id, { dir })}
            />
            <Slider label="Size" value={selected.r} min={4} max={300} onChange={(r) => s.updateCircle(selected.id, { r })} />
            <Slider
              label="Orbit radius"
              value={selected.orbit}
              min={0}
              max={400}
              onChange={(orbit) => s.updateCircle(selected.id, { orbit })}
            />
            <Slider
              label="Speed ×"
              value={selected.speed}
              min={0}
              max={4}
              step={0.05}
              onChange={(speed) => s.updateCircle(selected.id, { speed })}
            />
          </>
        ) : (
          <p className="hint">Select a circle to edit it. Drag a circle to set its orbit; drag its white knob to scale it.</p>
        )}
      </Section>

      <Section title="Look">
        <Segmented
          value={s.preset ?? ("" as OrbitPreset)}
          options={PRESET_OPTS}
          onChange={s.applyPreset}
        />
        <Slider label="Goo" value={look.goo} min={0} max={80} step={0.5} onChange={(goo) => s.setLook({ goo })} />
        <Slider
          label="Halo width"
          value={look.haloWidth}
          min={0}
          max={80}
          step={0.5}
          onChange={(haloWidth) => s.setLook({ haloWidth })}
        />
        <Slider
          label="Halo fade"
          value={look.haloFade}
          min={0}
          max={1}
          step={0.01}
          onChange={(haloFade) => s.setLook({ haloFade })}
        />
        <Slider
          label="Core falloff"
          value={look.coreFalloff}
          min={0.5}
          max={120}
          step={0.5}
          onChange={(coreFalloff) => s.setLook({ coreFalloff })}
        />
        <Slider label="Edge softness" value={look.edge} min={0} max={20} step={0.1} onChange={(edge) => s.setLook({ edge })} />
        <Slider
          label="Core edge"
          value={look.coreEdge}
          min={0}
          max={20}
          step={0.1}
          onChange={(coreEdge) => s.setLook({ coreEdge })}
        />
        <Slider label="Grain" value={look.grain} min={0} max={1} step={0.01} onChange={(grain) => s.setLook({ grain })} />
        <Slider
          label="Grain size"
          value={look.grainSize}
          min={0.5}
          max={8}
          step={0.1}
          suffix="px"
          onChange={(grainSize) => s.setLook({ grainSize })}
        />
        <Toggle label="Boil grain" checked={look.grainBoil} onChange={(grainBoil) => s.setLook({ grainBoil })} />
      </Section>

      <Section title="Color">
        <ColorField label="Halo" value={look.halo} onChange={(halo) => s.setLook({ halo })} />
        <ColorField label="Rim" value={look.rim} onChange={(rim) => s.setLook({ rim })} />
        <ColorField label="Core" value={look.core} onChange={(core) => s.setLook({ core })} />
      </Section>

      <Section title="Stage">
        <BackdropField value={look.backdrop} onChange={s.setBackdrop} />
      </Section>

      <ExportPanel
        name="viarna-orbit"
        getExporter={() => exporters.orbit}
        loopSeconds={loopSeconds}
        loopHint="Seamless when every circle's speed × is a whole number."
      >
        <button
          className="mini-btn"
          onClick={() => {
            const el = document.querySelector(".orbit-wrap");
            const r = el?.getBoundingClientRect() ?? { width: 800, height: 800 };
            downloadSVG(`viarna-orbit-${stamp()}`, orbitAnimatedSvg(r.width, r.height, false));
          }}
        >
          Animated SVG
        </button>
      </ExportPanel>
      <p className="hint sidebar-foot">
        Animated SVG is a vector approximation (goo filter + turbulence grain) that loops in any
        browser; the PNG and video are pixel-exact.
      </p>
    </aside>
  );
}
