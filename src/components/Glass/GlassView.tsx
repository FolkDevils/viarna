/**
 * Glass stage: raw three.js (no R3F) so the ribbon buffers can be rewritten
 * in place every frame and the multi-pass glass renderer can drive the
 * passes itself (`lib/glass/pipeline.ts`). Drag to orbit, scroll to zoom.
 * The backdrop is rendered into the canvas so the glass can refract it.
 */
import { useEffect, useRef } from "react";
import { Color, DoubleSide, Mesh, MeshPhysicalMaterial, PerspectiveCamera, WebGLRenderer } from "three";
import { OrbitControls } from "three-stdlib";
import { useGlass } from "@/state/glass";
import { bakeRibbonGeometry, ribbonUniformValues, strandJitter, type StrandJitter } from "@/lib/glass/ribbons";
import type { GlassShape } from "@/state/glass";
import { GlassPipeline } from "@/lib/glass/pipeline";
import { backdropCss, type Backdrop } from "@/lib/backdrop";
import { canvasToPng } from "@/lib/export/record";
import { exporters } from "@/lib/export/registry";
import { toGlb } from "@/lib/export/glb";
import "./Glass.css";

/** Live flow phase (radians) — module-level so it survives tab switches. */
let flowPhase = 0;

const solid = (hex: string): Backdrop => ({ type: "solid", from: hex, to: hex, angle: 0 });

export default function GlassView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const backdrop = useGlass((s) => s.look.backdrop);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "glass-canvas";
    wrap.appendChild(renderer.domElement);

    const camera = new PerspectiveCamera(30, 1, 0.5, 200);
    camera.position.set(0, 0.4, 15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 40;

    const pipeline = new GlassPipeline(renderer, useGlass.getState().shape.strands);
    let jitShape: GlassShape | null = null;
    let jitter: StrandJitter | null = null;

    // The glass is ray traced per pixel; full retina density is reserved for
    // exports so the live view doesn't cook the GPU.
    const livePixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5);
    let dirty = true;
    let refined = false;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      renderer.setPixelRatio(livePixelRatio());
      renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
      pipeline.setSize(renderer.domElement.width, renderer.domElement.height);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const sync = () => {
      const s = useGlass.getState();
      pipeline.setStrands(s.shape.strands);
      if (s.shape !== jitShape) {
        jitShape = s.shape;
        jitter = strandJitter(s.shape);
      }
      const vals = ribbonUniformValues(s.shape, flowPhase, jitter!);
      for (const [k, v] of Object.entries(vals)) pipeline.ribbon[k].value = v;
      pipeline.setLook(s.look);
    };
    const draw = (bg = useGlass.getState().look.backdrop, refine = true) => {
      sync();
      pipeline.render(camera, bg, refine);
    };

    const unsub = useGlass.subscribe(() => {
      dirty = true;
    });
    let orbited = false;
    controls.addEventListener("change", () => {
      orbited = true;
    });

    // Only render when something changed: cheap frames while moving, one
    // refined frame once everything settles, then idle.
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useGlass.getState();
      const flowing = s.playing && s.flowRpm > 0;
      if (flowing) flowPhase = (flowPhase + (s.flowRpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
      controls.update();
      const moving = flowing || orbited;
      orbited = false;
      if (moving || dirty || !refined) {
        draw(undefined, !moving);
        refined = !moving;
        dirty = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ---- export bridge
    const snapshot = (bg?: Backdrop) => {
      draw(bg);
      const c = document.createElement("canvas");
      c.width = renderer.domElement.width;
      c.height = renderer.domElement.height;
      c.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
      return c;
    };
    /**
     * Glass over "nothing" via difference matting: render over black and
     * over white. Alpha follows the most opaque channel so the tint survives,
     * and colour is solved so the PNG over white matches the white render.
     */
    const transparentFrame = () => {
      const black = snapshot(solid("#000000"));
      const white = snapshot(solid("#FFFFFF"));
      const w = black.width;
      const h = black.height;
      const B = black.getContext("2d")!.getImageData(0, 0, w, h);
      const W = white.getContext("2d")!.getImageData(0, 0, w, h);
      const out = B;
      const b = B.data;
      const wh = W.data;
      for (let i = 0; i < b.length; i += 4) {
        const t = Math.min(wh[i] - b[i], wh[i + 1] - b[i + 1], wh[i + 2] - b[i + 2]);
        const a = Math.max(0, Math.min(255, 255 - t));
        if (a === 0) {
          out.data[i] = out.data[i + 1] = out.data[i + 2] = out.data[i + 3] = 0;
          continue;
        }
        const k = 255 / a;
        const bgPart = 255 - a;
        out.data[i] = Math.max(0, Math.min(255, (wh[i] - bgPart) * k));
        out.data[i + 1] = Math.max(0, Math.min(255, (wh[i + 1] - bgPart) * k));
        out.data[i + 2] = Math.max(0, Math.min(255, (wh[i + 2] - bgPart) * k));
        out.data[i + 3] = a;
      }
      black.getContext("2d")!.putImageData(out, 0, 0);
      return black;
    };

    exporters.glass = {
      frameSize: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
      drawFrame: (ctx, w, h) => ctx.drawImage(renderer.domElement, 0, 0, w, h),
      png: async ({ scale, transparent }) => {
        renderer.setPixelRatio((window.devicePixelRatio || 1) * scale);
        const r = wrap.getBoundingClientRect();
        renderer.setSize(r.width, r.height, false);
        pipeline.setSize(renderer.domElement.width, renderer.domElement.height);
        const out = transparent ? transparentFrame() : snapshot();
        resize();
        return canvasToPng(out);
      },
      glb: () => {
        // Bake the current frame into a glTF-friendly physical glass material.
        const l = useGlass.getState().look;
        // glTF's attenuation is the same Beer–Lambert model: `color` is
        // reached after `1 / density` units.
        const m = new MeshPhysicalMaterial({
          color: 0xffffff,
          transmission: 1,
          roughness: 0.02,
          thickness: 0.6,
          ior: l.ior,
          attenuationColor: new Color(l.color),
          attenuationDistance: 1 / Math.max(0.01, l.density),
          specularIntensity: 1,
          side: DoubleSide,
        });
        const g = bakeRibbonGeometry(useGlass.getState().shape, flowPhase);
        g.deleteAttribute("uv");
        const out = new Mesh(g, m);
        out.name = "viarna-glass";
        return toGlb(out).finally(() => {
          g.dispose();
          m.dispose();
        });
      },
    };

    return () => {
      exporters.glass = null;
      unsub();
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pipeline.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="glass-wrap" ref={wrapRef} style={{ background: backdropCss(backdrop) }} />;
}
