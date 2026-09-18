/**
 * The right-hand control rail. Composed of small sections so new capabilities
 * (gradients, animation, saved setups…) slot in as extra sections without
 * churn.
 */
import { useState } from "react";
import { useStore } from "@/state/store";
import type { RenderMode, ViarnaDoc } from "@/model/types";
import { Section } from "@/components/common/Section";
import { Slider, Segmented, ColorField, Toggle } from "@/components/common/fields";
import { renderSvg } from "@/lib/svg/serialize";
import { copySvg, downloadSVG, downloadJSON, slugify } from "@/lib/svg/download";
import "./Sidebar.css";

const MODE_OPTS: { value: RenderMode; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "outline", label: "Outline" },
  { value: "knockout", label: "Knockout" },
];

export default function Sidebar() {
  const scene = useStore((s) => s.scene);
  const selectedId = useStore((s) => s.selectedId);
  const mirror = useStore((s) => s.mirror);
  const uniformSize = useStore((s) => s.uniformSize);
  const stageColor = useStore((s) => s.stageColor);
  const viewMode = useStore((s) => s.viewMode);
  const render3d = useStore((s) => s.render3d);
  const setMirror = useStore((s) => s.setMirror);
  const setUniformSize = useStore((s) => s.setUniformSize);
  const setStageColor = useStore((s) => s.setStageColor);
  const setRender3d = useStore((s) => s.setRender3d);
  const setParams = useStore((s) => s.setParams);
  const addBlob = useStore((s) => s.addBlob);
  const removeBlob = useStore((s) => s.removeBlob);
  const updateBlob = useStore((s) => s.updateBlob);
  const addLink = useStore((s) => s.addLink);
  const updateLink = useStore((s) => s.updateLink);
  const removeLink = useStore((s) => s.removeLink);
  const select = useStore((s) => s.select);

  const { params, blobs, links } = scene;
  const [copied, setCopied] = useState(false);
  const [fit, setFit] = useState(true);
  const [linkFrom, setLinkFrom] = useState("");
  const [linkTo, setLinkTo] = useState("");

  const blobName = (id: string): string => {
    const i = blobs.findIndex((b) => b.id === id);
    return i === -1 ? "?" : `Blob ${i + 1}`;
  };

  const canAddLink =
    linkFrom !== "" &&
    linkTo !== "" &&
    linkFrom !== linkTo &&
    !links.some(
      (l) =>
        (l.from === linkFrom && l.to === linkTo) || (l.from === linkTo && l.to === linkFrom),
    );

  const doAddLink = () => {
    addLink(linkFrom, linkTo);
    setLinkFrom("");
    setLinkTo("");
  };

  const doCopy = async () => {
    const ok = await copySvg(renderSvg(scene, { declaration: false, fit }));
    setCopied(ok);
    setTimeout(() => setCopied(false), 1400);
  };

  const doDownloadSvg = () =>
    downloadSVG(slugify("viarna-shape"), renderSvg(scene, { declaration: true, fit }));

  const doDownloadDoc = () => {
    const doc: ViarnaDoc = { format: "viarna", version: 1, scene };
    downloadJSON(slugify("viarna-shape"), JSON.stringify(doc, null, 2));
  };

  const bgOn = params.background !== null;
  const isKnockout = params.mode === "knockout";
  const is3d = viewMode === "3d";
  const selected = blobs.find((b) => b.id === selectedId) ?? null;

  return (
    <aside className="sidebar">
      <Section title="Shape">
        {/* Paint mode, contour smoothing/quality and stroke are 2D concepts;
            Goo drives the merge in BOTH views (same field). */}
        {!is3d && (
          <Segmented
            value={params.mode}
            options={MODE_OPTS}
            onChange={(mode) => setParams({ mode })}
          />
        )}
        <Slider
          label="Goo"
          value={params.goo}
          min={0}
          max={1}
          step={0.01}
          onChange={(goo) => setParams({ goo })}
        />
        {!is3d && (
          <>
            <Slider
              label="Smoothing"
              value={params.smoothing}
              min={0}
              max={1}
              step={0.01}
              onChange={(smoothing) => setParams({ smoothing })}
            />
            <Slider
              label="Quality"
              value={params.resolution}
              min={40}
              max={320}
              step={2}
              onChange={(resolution) => setParams({ resolution })}
            />
            {params.mode === "outline" && (
              <Slider
                label="Stroke"
                value={params.strokeWidth}
                min={0.5}
                max={40}
                step={0.5}
                suffix="px"
                onChange={(strokeWidth) => setParams({ strokeWidth })}
              />
            )}
          </>
        )}
      </Section>

      {viewMode === "3d" && (
        <Section title="3D">
          <ColorField
            label="Foreground"
            value={params.color}
            onChange={(color) => setParams({ color })}
          />
          <ColorField label="Background" value={stageColor} onChange={setStageColor} />
          <Slider
            label="Detail"
            value={render3d.detail}
            min={24}
            max={160}
            step={2}
            onChange={(detail) => setRender3d({ detail })}
          />
          <Slider
            label="Roughness"
            value={render3d.roughness}
            min={0}
            max={1}
            step={0.01}
            onChange={(roughness) => setRender3d({ roughness })}
          />
          <Slider
            label="Metalness"
            value={render3d.metalness}
            min={0}
            max={1}
            step={0.01}
            onChange={(metalness) => setRender3d({ metalness })}
          />
          <p className="hint">
            Same shape, same morphing: drag a blob to move it (mirror &amp; links apply), drag
            empty space to orbit, scroll to zoom. Goo melts exactly like 2D. Switch to 2D to
            export SVG.
          </p>
        </Section>
      )}

      <Section title="Editing">
        <Toggle label="Mirror across center" checked={mirror} onChange={setMirror} />
        <Toggle label="Uniform size" checked={uniformSize} onChange={setUniformSize} />
        <ColorField label="Stage color" value={stageColor} onChange={setStageColor} />
      </Section>

      {!is3d && (
        <Section title="Color">
          <ColorField
            label={
              params.mode === "outline"
                ? "Stroke color"
                : isKnockout
                  ? "Knockout color"
                  : "Fill color"
            }
            value={params.color}
            onChange={(color) => setParams({ color })}
          />
          {/* Knockout paints its own solid plate, so the background controls
              would do nothing there — hide them to avoid dead knobs. */}
          {!isKnockout && (
            <Segmented
              label="Background"
              value={bgOn ? "color" : "transparent"}
              options={[
                { value: "transparent", label: "Transparent" },
                { value: "color", label: "Solid" },
              ]}
              onChange={(v) => setParams({ background: v === "color" ? "#ffffff" : null })}
            />
          )}
          {!isKnockout && bgOn && (
            <ColorField
              label="Background color"
              value={params.background ?? "#ffffff"}
              onChange={(background) => setParams({ background })}
            />
          )}
        </Section>
      )}

      {!is3d && (
        <Section title="Texture">
        <Toggle
          label="Grain"
          checked={params.texture}
          onChange={(texture) => setParams({ texture })}
        />
        {params.texture && (
          <>
            <Slider
              label="Amount"
              value={params.textureAmount}
              min={0}
              max={1}
              step={0.01}
              onChange={(textureAmount) => setParams({ textureAmount })}
            />
            <Slider
              label="Grain size"
              value={params.textureScale}
              min={0}
              max={1}
              step={0.01}
              onChange={(textureScale) => setParams({ textureScale })}
            />
            <p className="hint">
              Film-like grain with a soft, dusty edge. It shows in the app and in a downloaded
              .svg; Figma drops SVG filters on paste, so the shape lands clean there.
            </p>
          </>
        )}
        </Section>
      )}

      <Section
        title="Blobs"
        action={
          <button className="mini-btn" onClick={addBlob} title="Add a blob">
            + Add
          </button>
        }
      >
        <ul className="blob-list">
          {blobs.map((b, i) => (
            <li
              key={b.id}
              className={b.id === selectedId ? "blob-row selected" : "blob-row"}
              onClick={() => select(b.id)}
            >
              <span className="blob-dot" />
              <span className="blob-name">Blob {i + 1}</span>
              <span className="blob-meta">r{Math.round(b.r)}</span>
              <button
                className="blob-del"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBlob(b.id);
                }}
                disabled={blobs.length <= 1}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {selected && (
          <Slider
            label="Size"
            value={selected.r}
            min={8}
            max={240}
            step={1}
            suffix="px"
            onChange={(r) => updateBlob(selected.id, { r })}
          />
        )}
      </Section>

      <Section title="Links">
        {links.length > 0 && (
          <ul className="link-list">
            {links.map((l) => (
              <li key={l.id} className="link-row">
                <span className="link-name">
                  {blobName(l.from)} ↔ {blobName(l.to)}
                </span>
                <input
                  type="range"
                  className="link-range"
                  min={0.5}
                  max={80}
                  step={0.5}
                  value={l.t}
                  title={`Neck thickness: ${Math.round(l.t)}`}
                  onChange={(e) => updateLink(l.id, { t: parseFloat(e.target.value) })}
                />
                <button className="blob-del" title="Remove link" onClick={() => removeLink(l.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="link-add">
          <select
            className="select"
            value={linkFrom}
            onChange={(e) => setLinkFrom(e.target.value)}
          >
            <option value="">From…</option>
            {blobs.map((b) => (
              <option key={b.id} value={b.id}>
                {blobName(b.id)}
              </option>
            ))}
          </select>
          <select className="select" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
            <option value="">To…</option>
            {blobs.map((b) => (
              <option key={b.id} value={b.id}>
                {blobName(b.id)}
              </option>
            ))}
          </select>
          <button className="mini-btn" onClick={doAddLink} disabled={!canAddLink}>
            Link
          </button>
        </div>
        <p className="hint">
          A link pours goo along the line between two blobs, so their neck never breaks — drag
          the slider to set its thickness.
        </p>
      </Section>

      {!is3d && (
        <Section title="Export">
          <Segmented
            label="Crop"
            value={fit ? "fit" : "stage"}
            options={[
              { value: "fit", label: "Fit shape" },
              { value: "stage", label: "Full stage" },
            ]}
            onChange={(v) => setFit(v === "fit")}
          />
          <button className="btn primary" onClick={doCopy}>
            {copied ? "Copied ✓" : "Copy SVG"}
          </button>
          <div className="btn-row">
            <button className="btn" onClick={doDownloadSvg}>
              Download SVG
            </button>
            <button className="btn" onClick={doDownloadDoc}>
              Save .json
            </button>
          </div>
          <p className="hint">Paste straight into Figma as a vector, or open the file back up later.</p>
        </Section>
      )}
    </aside>
  );
}
