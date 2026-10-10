/**
 * Shared Export section: PNG (1×/2×/4×, optional transparency) and a
 * real-time video recording, plus any format-specific buttons as children.
 */
import { useState, type ReactNode } from "react";
import { Section } from "./Section";
import { Segmented, Slider, Toggle } from "./fields";
import { downloadBlob } from "@/lib/svg/download";
import { recordCanvas, pickVideoMime, videoSize } from "@/lib/export/record";
import { stamp, type ViewExporter } from "@/lib/export/registry";

const SCALE_OPTS = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "4", label: "4×" },
];

export function ExportPanel({
  name,
  getExporter,
  loopSeconds,
  loopHint,
  children,
}: {
  /** File-name prefix, e.g. "viarna-orbit". */
  name: string;
  getExporter: () => ViewExporter | null;
  /** Length of one seamless loop, if the motion has one. */
  loopSeconds: number | null;
  loopHint?: string;
  children?: ReactNode;
}) {
  const [scale, setScale] = useState("2");
  const [transparent, setTransparent] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canVideo = pickVideoMime() !== null;
  const dur = seconds ?? Math.min(60, loopSeconds ?? 6);

  const run = async (label: string, job: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doPng = () =>
    run("Rendering PNG…", async () => {
      const ex = getExporter();
      if (!ex) throw new Error("View not ready yet.");
      const blob = await ex.png({ scale: Number(scale), transparent });
      downloadBlob(`${name}-${stamp()}.png`, blob);
    });

  const doVideo = () =>
    run("Recording…", async () => {
      const ex = getExporter();
      if (!ex) throw new Error("View not ready yet.");
      const fs = ex.frameSize();
      const { width, height } = videoSize(fs.width, fs.height);
      const { blob, ext } = await recordCanvas({
        width,
        height,
        seconds: dur,
        draw: ex.drawFrame,
        onProgress: (t) => setBusy(`Recording… ${t.toFixed(1)} / ${dur.toFixed(1)}s`),
      });
      downloadBlob(`${name}-${stamp()}.${ext}`, blob);
    });

  return (
    <Section title="Export">
      <Segmented label="PNG size" value={scale} options={SCALE_OPTS} onChange={setScale} />
      <Toggle label="Transparent background" checked={transparent} onChange={setTransparent} />
      <div className="btn-row">
        <button className="btn primary" onClick={doPng} disabled={!!busy}>
          Export PNG
        </button>
      </div>
      {canVideo && (
        <>
          <Slider
            label="Video length"
            value={dur}
            min={1}
            max={60}
            step={0.1}
            suffix="s"
            onChange={setSeconds}
          />
          {loopSeconds !== null && (
            <button className="mini-btn" onClick={() => setSeconds(Math.min(60, loopSeconds))}>
              Snap to one seamless loop ({loopSeconds.toFixed(1)}s)
            </button>
          )}
          <div className="btn-row">
            <button className="btn" onClick={doVideo} disabled={!!busy}>
              Record video
            </button>
          </div>
        </>
      )}
      {children && <div className="btn-row export-extra">{children}</div>}
      {busy && <p className="hint">{busy}</p>}
      {error && <p className="hint export-error">{error}</p>}
      <p className="hint">
        Video records in real time (MP4 where supported, otherwise WebM) — keep this tab in
        front while it runs.{loopHint ? ` ${loopHint}` : ""}
      </p>
    </Section>
  );
}
