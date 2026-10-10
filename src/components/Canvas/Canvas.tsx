/**
 * The editing stage.
 *
 * The fused shape is painted from the same `ArtSpec` the exporter stringifies,
 * guaranteeing what-you-see-is-what-you-copy — but rendered as plain JSX so a
 * drag only updates path attributes instead of re-parsing markup every frame.
 * On top of that sit interactive handles (never exported): drag a body to
 * move, drag the rim knob to resize. Faint dashed lines show where links run.
 */
import { useMemo, useRef, useCallback, useEffect } from "react";
import { useStore } from "@/state/store";
import { computeMetaball } from "@/lib/metaball";
import { buildArtSpec, stageFrame, textureFilterEl } from "@/lib/svg/serialize";
import { dist } from "@/lib/geometry";
import { backdropCss } from "@/lib/backdrop";
import "./Canvas.css";

type DragKind = "move" | "resize";
interface DragSession {
  id: string;
  kind: DragKind;
  offX: number;
  offY: number;
}

export default function Canvas() {
  const scene = useStore((s) => s.scene);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const updateBlob = useStore((s) => s.updateBlob);
  const setStageSize = useStore((s) => s.setStageSize);
  const stageColor = useStore((s) => s.stageColor);
  const stageGradient = useStore((s) => s.stageGradient);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragSession | null>(null);
  const measured = useRef<{ w: number; h: number } | null>(null);

  // Full-bleed stage: the scene's dimensions track the canvas area 1:1, so
  // the whole workspace is editable space and exports match screen pixels.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      measured.current = { w: r.width, h: r.height };
      setStageSize(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setStageSize]);

  // If something else rewrites the scene size (Reset, loading a document),
  // snap it back to the measured canvas so the stage stays full-bleed.
  useEffect(() => {
    const m = measured.current;
    if (m && (Math.round(m.w) !== scene.width || Math.round(m.h) !== scene.height)) {
      setStageSize(m.w, m.h);
    }
  }, [scene.width, scene.height, setStageSize]);

  const { d } = useMemo(() => computeMetaball(scene), [scene]);
  const spec = useMemo(() => buildArtSpec(scene, d, stageFrame(scene)), [scene, d]);

  const blobById = useMemo(
    () => new Map(scene.blobs.map((b) => [b.id, b])),
    [scene.blobs],
  );

  const toStage = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, id: string, kind: DragKind) => {
      e.stopPropagation();
      // Pointer capture keeps events flowing to this element even if the
      // cursor outruns the handle mid-drag. Guarded because synthetic pointers
      // (and some browsers) reject capture.
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* non-fatal */
      }
      select(id);
      const blob = useStore.getState().scene.blobs.find((b) => b.id === id);
      const p = toStage(e.clientX, e.clientY);
      drag.current = {
        id,
        kind,
        offX: blob ? p.x - blob.x : 0,
        offY: blob ? p.y - blob.y : 0,
      };
    },
    [select, toStage],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const session = drag.current;
      if (!session) return;
      const p = toStage(e.clientX, e.clientY);
      if (session.kind === "move") {
        updateBlob(session.id, { x: p.x - session.offX, y: p.y - session.offY });
      } else {
        const blob = useStore.getState().scene.blobs.find((b) => b.id === session.id);
        if (blob) updateBlob(session.id, { r: dist(p, { x: blob.x, y: blob.y }) });
      }
    },
    [toStage, updateBlob],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      {/* A solid or gradient backdrop (Figma-style). When the export background is a solid
          colour it wins so the preview matches the export; otherwise the art
          floats on the editor's stage colour and still exports transparent. */}
      <div
        className="stage"
        style={{
          background: scene.params.background ?? backdropCss({ ...stageGradient, from: stageColor }),
        }}
      >
        <svg
          ref={svgRef}
          className="stage-svg"
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          onPointerDown={(e) => {
            // Only an empty-stage press clears the selection; presses that land
            // on a handle are handled (and stopped) by the handle itself.
            if (e.target === e.currentTarget) select(null);
          }}
        >
          {/* Painted art — same ArtSpec the exporter serialises. */}
          {/* Grain filter defs (static markup shared with the exporter). */}
          {spec.texture && (
            <defs dangerouslySetInnerHTML={{ __html: textureFilterEl(spec.texture) }} />
          )}
          {spec.background && (
            <rect
              x={spec.background.x}
              y={spec.background.y}
              width={spec.background.w}
              height={spec.background.h}
              fill={spec.background.fill}
            />
          )}
          {spec.path && (
            <path
              d={spec.path.d}
              fill={spec.path.fill}
              fillRule={spec.path.fillRule}
              stroke={spec.path.stroke}
              strokeWidth={spec.path.strokeWidth}
              strokeLinejoin={spec.path.strokeLinejoin}
              filter={spec.path.filter}
            />
          )}

          {/* Interactive overlay (never exported). */}
          <g className="handles">
            {scene.links.map((l) => {
              const a = blobById.get(l.from);
              const b = blobById.get(l.to);
              if (!a || !b) return null;
              return (
                <line
                  key={l.id}
                  className="link-guide"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              );
            })}
            {scene.blobs.map((b) => {
              const on = b.id === selectedId;
              return (
                <g key={b.id} className={on ? "handle selected" : "handle"}>
                  <circle
                    className="handle-body"
                    cx={b.x}
                    cy={b.y}
                    r={b.r}
                    onPointerDown={(e) => onPointerDown(e, b.id, "move")}
                  />
                  <circle className="handle-dot" cx={b.x} cy={b.y} r={4} />
                  {on && (
                    <circle
                      className="handle-resize"
                      cx={b.x + b.r}
                      cy={b.y}
                      r={7}
                      onPointerDown={(e) => onPointerDown(e, b.id, "resize")}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
