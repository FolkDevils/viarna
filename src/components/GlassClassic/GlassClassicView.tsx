/**
 * Glass stage: raw three.js (no R3F) so the ribbon buffers can be rewritten
 * in place every frame. Drag to orbit the camera, scroll to zoom. The
 * backdrop is CSS behind a transparent canvas — exports composite it back in.
 */
import { useEffect, useRef } from "react";
import {
  Color,
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three-stdlib";
import { useGlassClassic as useGlass } from "@/state/glassClassic";
import {
  bakeRibbonGeometry,
  createRibbonGeometry,
  ribbonUniformValues,
  strandJitter,
  type StrandJitter,
} from "@/lib/glassClassic/ribbons";
import type { GlassShape } from "@/state/glassClassic";
import { applyGlassLook, createGlassMaterial } from "@/lib/glassClassic/material";
import { backdropCss } from "@/lib/backdrop";
import { paintBackdrop } from "@/lib/export/paintBackdrop";
import { canvasToPng } from "@/lib/export/record";
import { exporters } from "@/lib/export/registry";
import { toGlb } from "@/lib/export/glb";
import "../Glass/Glass.css";

/** Live flow phase (radians) — module-level so it survives tab switches. */
let flowPhase = 0;

export default function GlassClassicView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const backdrop = useGlass((s) => s.look.backdrop);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "glass-canvas";
    wrap.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.1, 200);
    camera.position.set(0, 0.4, 15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 40;

    const material = createGlassMaterial();
    let strands = useGlass.getState().shape.strands;
    const mesh = new Mesh(createRibbonGeometry(strands), material);
    // Positions are computed in the vertex shader, so CPU bounds are meaningless.
    mesh.frustumCulled = false;
    scene.add(mesh);
    let jitShape: GlassShape | null = null;
    let jitter: StrandJitter | null = null;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const sync = () => {
      const s = useGlass.getState();
      if (s.shape.strands !== strands) {
        strands = s.shape.strands;
        mesh.geometry.dispose();
        mesh.geometry = createRibbonGeometry(strands);
      }
      if (s.shape !== jitShape) {
        jitShape = s.shape;
        jitter = strandJitter(s.shape);
      }
      const vals = ribbonUniformValues(s.shape, flowPhase, jitter!);
      for (const [k, v] of Object.entries(vals)) material.uniforms[k].value = v;
      applyGlassLook(material, s.look);
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useGlass.getState();
      if (s.playing) flowPhase = (flowPhase + (s.flowRpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
      sync();
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ---- export bridge
    const composite = (ctx: CanvasRenderingContext2D, w: number, h: number, transparent = false) => {
      ctx.clearRect(0, 0, w, h);
      if (!transparent) paintBackdrop(ctx, useGlass.getState().look.backdrop, w, h);
      ctx.drawImage(renderer.domElement, 0, 0, w, h);
    };
    exporters.glass = {
      frameSize: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
      drawFrame: (ctx, w, h) => composite(ctx, w, h),
      png: async ({ scale, transparent }) => {
        const pr = renderer.getPixelRatio();
        renderer.setPixelRatio(pr * scale);
        const r = wrap.getBoundingClientRect();
        renderer.setSize(r.width, r.height, false);
        sync();
        renderer.render(scene, camera);
        const out = document.createElement("canvas");
        out.width = renderer.domElement.width;
        out.height = renderer.domElement.height;
        composite(out.getContext("2d")!, out.width, out.height, transparent);
        resize();
        return canvasToPng(out);
      },
      glb: () => {
        // Bake the current frame into a glTF-friendly physical glass material.
        const l = useGlass.getState().look;
        const m = new MeshPhysicalMaterial({
          color: new Color(l.tint),
          transmission: 1,
          roughness: 0.05,
          thickness: 0.35,
          ior: 1.5,
          attenuationColor: new Color(l.rim),
          attenuationDistance: 0.8,
          iridescence: l.iridescence,
          specularIntensity: 1,
          side: DoubleSide,
        });
        const g = bakeRibbonGeometry(useGlass.getState().shape, flowPhase);
        g.deleteAttribute("uv");
        const out = new Mesh(g, m);
        out.name = "viarna-glass-classic";
        return toGlb(out).finally(() => {
          g.dispose();
          m.dispose();
        });
      },
    };

    return () => {
      exporters.glass = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="glass-wrap" ref={wrapRef} style={{ background: backdropCss(backdrop) }} />;
}
