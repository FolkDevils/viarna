/**
 * Orbit stage: a raw WebGL canvas running the dithered-falloff shader, plus a
 * 2D overlay for orbit guides and selection. Circles orbit the stage centre;
 * drag one to set its orbit radius and position (it keeps its direction), or
 * drag the selected circle's knob to scale it.
 */
import { useEffect, useRef } from "react";
import { useOrbit, type OrbitCircle } from "@/state/orbit";
import { liveAngles, STAGE_REF } from "@/lib/orbit/runtime";
import { FRAG, MAX_BLOBS, VERT } from "@/lib/orbit/shader";
import { BACKDROP_TYPE_ID } from "@/lib/backdrop";
import { exporters } from "@/lib/export/registry";
import { canvasToPng } from "@/lib/export/record";
import "./Orbit.css";

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  }
  return s;
}

const angleOf = (c: OrbitCircle) => liveAngles.get(c.id) ?? c.angle;
const posOf = (c: OrbitCircle) => {
  const a = angleOf(c);
  return { x: Math.cos(a) * c.orbit, y: Math.sin(a) * c.orbit };
};

/** Scale-knob radius in CSS px (hit area is a little larger). */
const KNOB_PX = 6;

export default function OrbitView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: string; kind: "move" | "scale"; dx: number; dy: number } | null>(
    null,
  );
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = glRef.current!;
    const ui = uiRef.current!;
    const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return;
    const ctx = ui.getContext("2d")!;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const U = (name: string) => gl.getUniformLocation(prog, name);
    const u = {
      res: U("uRes"),
      scale: U("uScale"),
      count: U("uCount"),
      blobs: U("uBlobs"),
      k: U("uK"),
      halo: U("uHalo"),
      fade: U("uFade"),
      fall: U("uFall"),
      edge: U("uEdge"),
      coreEdge: U("uCoreEdge"),
      grain: U("uGrain"),
      grainSize: U("uGrainSize"),
      seed: U("uSeed"),
      bg: U("uBg"),
      bg2: U("uBg2"),
      bgType: U("uBgType"),
      bgAngle: U("uBgAngle"),
      haloCol: U("uHaloCol"),
      rim: U("uRim"),
      core: U("uCore"),
      transparent: U("uTransparent"),
    };
    const blobData = new Float32Array(MAX_BLOBS * 3);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: r.width, h: r.height, dpr };
      for (const c of [canvas, ui]) {
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let raf = 0;
    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame++;
      const s = useOrbit.getState();

      // Advance angles (integrated, so direction/speed changes never jump).
      const omega = (s.rpm / 60) * Math.PI * 2;
      for (const c of s.circles) {
        const a = angleOf(c);
        if (s.playing && dragRef.current?.id !== c.id) {
          liveAngles.set(c.id, a + (c.dir === "cw" ? 1 : -1) * omega * c.speed * dt);
        } else if (!liveAngles.has(c.id)) {
          liveAngles.set(c.id, a);
        }
      }

      const { w, h, dpr } = sizeRef.current;
      const scale = (Math.min(w, h) / STAGE_REF) * dpr;
      drawGL(scale, 1, false, frame);

      // Overlay: orbit guides + selection.
      drawGuides(scale, dpr);

      raf = requestAnimationFrame(tick);
    };

    /** Render the blobs into the GL canvas at its current pixel size. */
    const drawGL = (scale: number, grainMul: number, transparent: boolean, frame: number) => {
      const s = useOrbit.getState();
      const { look } = s;
      const n = Math.min(s.circles.length, MAX_BLOBS);
      for (let i = 0; i < n; i++) {
        const c = s.circles[i];
        const p = posOf(c);
        blobData[i * 3] = p.x;
        blobData[i * 3 + 1] = p.y;
        blobData[i * 3 + 2] = c.r;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.scale, scale);
      gl.uniform1i(u.count, n);
      gl.uniform3fv(u.blobs, blobData);
      gl.uniform1f(u.k, look.goo);
      gl.uniform1f(u.halo, look.haloWidth);
      gl.uniform1f(u.fade, look.haloFade);
      gl.uniform1f(u.fall, look.coreFalloff);
      gl.uniform1f(u.edge, look.edge);
      gl.uniform1f(u.coreEdge, look.coreEdge);
      gl.uniform1f(u.grain, look.grain);
      // Grain is in device px: scale it with export resolution so the
      // texture looks the same at 2×/4×.
      gl.uniform1f(u.grainSize, look.grainSize * grainMul);
      gl.uniform1f(u.seed, look.grainBoil ? (frame % 997) * 13.0 : 0);
      gl.uniform1i(u.transparent, transparent ? 1 : 0);
      gl.uniform3fv(u.bg, hexToRgb(look.backdrop.from));
      gl.uniform3fv(u.bg2, hexToRgb(look.backdrop.to));
      gl.uniform1i(u.bgType, BACKDROP_TYPE_ID[look.backdrop.type]);
      gl.uniform1f(u.bgAngle, (look.backdrop.angle * Math.PI) / 180);
      gl.uniform3fv(u.haloCol, hexToRgb(look.halo));
      gl.uniform3fv(u.rim, hexToRgb(look.rim));
      gl.uniform3fv(u.core, hexToRgb(look.core));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const drawGuides = (scale: number, dpr: number) => {
      const s = useOrbit.getState();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ui.width, ui.height);
      if (s.showGuides) {
        ctx.setTransform(scale, 0, 0, scale, ui.width / 2, ui.height / 2);
        const lw = 1 / scale;
        const rings = new Set<number>();
        for (const c of s.circles) rings.add(Math.round(c.orbit));
        ctx.lineWidth = lw * dpr;
        ctx.setLineDash([4 * dpr * lw, 5 * dpr * lw]);
        ctx.strokeStyle = "rgba(91,140,255,0.45)";
        for (const r of rings) {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(91,140,255,0.8)";
        ctx.beginPath();
        ctx.arc(0, 0, 3 * dpr * lw, 0, Math.PI * 2);
        ctx.fill();
        for (const c of s.circles) {
          const p = posOf(c);
          const sel = c.id === s.selectedId;
          ctx.strokeStyle = sel ? "rgba(91,140,255,1)" : "rgba(91,140,255,0.35)";
          ctx.lineWidth = (sel ? 1.5 : 1) * dpr * lw;
          ctx.beginPath();
          ctx.arc(p.x, p.y, c.r, 0, Math.PI * 2);
          ctx.stroke();
          if (sel) {
            // Scale knob on the guide's right edge — drag it to resize.
            ctx.fillStyle = "#ffffff";
            ctx.lineWidth = 2 * dpr * lw;
            ctx.beginPath();
            ctx.arc(p.x + c.r, p.y, KNOB_PX * dpr * lw, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.lineWidth = (sel ? 1.5 : 1) * dpr * lw;
          }
          // Direction arrow at the circle centre, tangent to its orbit.
          const a = angleOf(c);
          const sgn = c.dir === "cw" ? 1 : -1;
          const tx = -Math.sin(a) * sgn;
          const ty = Math.cos(a) * sgn;
          const L = 14 * dpr * lw;
          ctx.beginPath();
          ctx.moveTo(p.x - tx * L, p.y - ty * L);
          ctx.lineTo(p.x + tx * L, p.y + ty * L);
          ctx.lineTo(p.x + tx * L * 0.3 - ty * L * 0.5, p.y + ty * L * 0.3 + tx * L * 0.5);
          ctx.moveTo(p.x + tx * L, p.y + ty * L);
          ctx.lineTo(p.x + tx * L * 0.3 + ty * L * 0.5, p.y + ty * L * 0.3 - tx * L * 0.5);
          ctx.stroke();
        }
      }

    };
    raf = requestAnimationFrame(tick);

    // ---- export bridge
    exporters.orbit = {
      frameSize: () => ({ width: canvas.width, height: canvas.height }),
      drawFrame: (c2, w, h) => c2.drawImage(canvas, 0, 0, w, h),
      png: ({ scale: mult, transparent }) => {
        const { w, h, dpr } = sizeRef.current;
        const ow = canvas.width;
        const oh = canvas.height;
        canvas.width = Math.round(ow * mult);
        canvas.height = Math.round(oh * mult);
        drawGL((Math.min(w, h) / STAGE_REF) * dpr * mult, mult, transparent, frame);
        const out = canvasToPng(canvas);
        return out.finally(() => {
          canvas.width = ow;
          canvas.height = oh;
          drawGL((Math.min(w, h) / STAGE_REF) * dpr, 1, false, frame);
        });
      },
    };

    return () => {
      exporters.orbit = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      // Free GPU objects but keep the context: StrictMode remounts reuse it.
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);

  /** Pointer → logical stage coords (centred, y-down). */
  const toStage = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const k = STAGE_REF / Math.min(r.width, r.height);
    return {
      x: (e.clientX - r.left - r.width / 2) * k,
      y: (e.clientY - r.top - r.height / 2) * k,
      k,
    };
  };

  /** What's under the pointer: the selected circle's scale knob, a circle, or nothing. */
  const hitTest = (p: { x: number; y: number; k: number }) => {
    const { circles, selectedId, showGuides } = useOrbit.getState();
    const sel = circles.find((c) => c.id === selectedId);
    if (sel && showGuides) {
      const q = posOf(sel);
      if (Math.hypot(p.x - (q.x + sel.r), p.y - q.y) <= (KNOB_PX + 5) * p.k) {
        return { circle: sel, kind: "scale" as const };
      }
    }
    // Prefer the smallest containing circle.
    let hit: OrbitCircle | null = null;
    for (const c of circles) {
      const q = posOf(c);
      if (Math.hypot(p.x - q.x, p.y - q.y) <= c.r && (!hit || c.r < hit.r)) hit = c;
    }
    return hit ? { circle: hit, kind: "move" as const } : null;
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toStage(e);
    const { select } = useOrbit.getState();
    const hit = hitTest(p);
    if (!hit) {
      select(null);
      return;
    }
    const q = posOf(hit.circle);
    dragRef.current = { id: hit.circle.id, kind: hit.kind, dx: q.x - p.x, dy: q.y - p.y };
    select(hit.circle.id);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const p = toStage(e);
    if (!d) {
      const h = hitTest(p);
      wrapRef.current!.style.cursor = h ? (h.kind === "scale" ? "ew-resize" : "grab") : "default";
      return;
    }
    if (d.kind === "scale") {
      // The circle holds still while dragged, so its centre is stable.
      const c = useOrbit.getState().circles.find((o) => o.id === d.id);
      if (c) {
        const q = posOf(c);
        useOrbit.getState().updateCircle(d.id, { r: Math.hypot(p.x - q.x, p.y - q.y) });
      }
      return;
    }
    const x = p.x + d.dx;
    const y = p.y + d.dy;
    liveAngles.set(d.id, Math.atan2(y, x));
    useOrbit.getState().updateCircle(d.id, { orbit: Math.hypot(x, y) });
  };

  const onUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      className="orbit-wrap"
      ref={wrapRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <canvas ref={glRef} className="orbit-gl" />
      <canvas ref={uiRef} className="orbit-ui" />
    </div>
  );
}
