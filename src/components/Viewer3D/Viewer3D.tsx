/**
 * The 3D "blobular" renderer (Three.js via React Three Fiber).
 *
 * WYSIWYG with the 2D editor: the surface is marching cubes over the *same*
 * normalised Gaussian field the 2D view contours (see `lib/three/blobs3d`),
 * so goo, links, radii and thin necks morph identically — the 2D shape is the
 * z = 0 cross-section of what you see here.
 *
 * Editing works like the 2D stage too: every blob has an (invisible) grab
 * sphere on the z = 0 plane — drag to move it, click to select. Moves go
 * through the store's `updateBlob`, so mirror mode, uniform size and clamping
 * all behave exactly as in 2D. Orbit is suspended while dragging a blob.
 *
 * The field is only re-sampled when the scene actually changes, so orbiting
 * stays at full frame rate. The frameloop is on demand unless the turntable
 * spin is on; the backdrop (solid or gradient) is CSS behind a clear canvas.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  type Group,
  type Material,
  type Object3D,
} from "three";
import { MarchingCubes } from "three-stdlib";
import { useStore } from "@/state/store";
import {
  FIELD_ISO,
  fillField3D,
  stageMap,
  stageToWorld,
  worldToStage,
} from "@/lib/three/blobs3d";
import type { Blob } from "@/model/types";
import { backdropCss, type Backdrop } from "@/lib/backdrop";
import { BRAND, BRAND_STOPS } from "@/lib/brand";
import { exporters } from "@/lib/export/registry";
import { paintBackdrop } from "@/lib/export/paintBackdrop";
import { canvasToPng } from "@/lib/export/record";
import { toGlb, toStl } from "@/lib/export/glb";

/** The backdrop the 3D view shows (export background wins when set). */
const currentBackdrop = (): Backdrop => {
  const st = useStore.getState();
  return st.scene.params.background
    ? { type: "solid", from: st.scene.params.background, to: st.scene.params.background, angle: 0 }
    : { ...st.stageGradient, from: st.stageColor };
};

/** Registers PNG / video / GLB / STL exporters for the live 3D canvas. */
function ExportBridge() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    // Editor-only helpers (selection wireframes) are tagged `noExport`.
    const withoutHelpers = <T,>(fn: () => T): T => {
      const hidden: Object3D[] = [];
      scene.traverse((o) => {
        if (o.userData.noExport && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      });
      try {
        return fn();
      } finally {
        hidden.forEach((o) => (o.visible = true));
      }
    };

    /** Bake the marching-cubes surface into a standalone world-space mesh. */
    const bakeMesh = (): Mesh | null => {
      let mc: MarchingCubes | null = null;
      scene.traverse((o) => {
        if (o instanceof MarchingCubes) mc = o;
      });
      if (!mc) return null;
      const m = mc as MarchingCubes;
      m.updateMatrixWorld(true);
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(m.positionArray.slice(0, m.count * 3), 3));
      g.setAttribute("normal", new BufferAttribute(m.normalArray.slice(0, m.count * 3), 3));
      g.applyMatrix4(m.matrixWorld);
      const st = useStore.getState();
      const mesh = new Mesh(
        g,
        new MeshStandardMaterial({
          color: new Color(st.scene.params.color),
          roughness: st.render3d.roughness,
          metalness: st.render3d.metalness,
        }),
      );
      mesh.name = "viarna-blob";
      return mesh;
    };

    const composite = (ctx: CanvasRenderingContext2D, w: number, h: number, transparent = false) => {
      ctx.clearRect(0, 0, w, h);
      if (!transparent) paintBackdrop(ctx, currentBackdrop(), w, h);
      ctx.drawImage(gl.domElement, 0, 0, w, h);
    };

    exporters.three = {
      frameSize: () => ({ width: gl.domElement.width, height: gl.domElement.height }),
      drawFrame: (ctx, w, h) => composite(ctx, w, h),
      png: ({ scale, transparent }) =>
        withoutHelpers(() => {
          const pr = gl.getPixelRatio();
          const size = gl.getSize(new Vector2());
          gl.setPixelRatio(pr * scale);
          gl.setSize(size.x, size.y, false);
          gl.render(scene, camera);
          const out = document.createElement("canvas");
          out.width = gl.domElement.width;
          out.height = gl.domElement.height;
          composite(out.getContext("2d")!, out.width, out.height, transparent);
          gl.setPixelRatio(pr);
          gl.setSize(size.x, size.y, false);
          invalidate();
          return canvasToPng(out);
        }),
      glb: async () => {
        const mesh = bakeMesh();
        if (!mesh) throw new Error("Nothing to export yet.");
        return toGlb(mesh);
      },
      stl: () => {
        const mesh = bakeMesh();
        if (!mesh) throw new Error("Nothing to export yet.");
        return toStl(mesh);
      },
    };
    return () => {
      exporters.three = null;
    };
  }, [gl, scene, camera, invalidate]);

  return null;
}

/** The spinning group the blobs live in (handles need it to map pointer rays). */
const SpinContext = createContext<React.RefObject<Group> | null>(null);
/** True while a blob is being dragged — the spin holds still meanwhile. */
const dragState = { active: false };

/** Turntable: rotates its children about the vertical axis, continuously. */
function Spinner({ children }: { children: React.ReactNode }) {
  const ref = useRef<Group>(null);
  const spin = useStore((s) => s.render3d.spin);
  const rpm = useStore((s) => s.render3d.spinRpm);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g || spin === "off" || dragState.active) return;
    // Right = front face travels to the right (+Y rotation); left = reverse.
    g.rotation.y += (spin === "right" ? 1 : -1) * (rpm / 60) * Math.PI * 2 * Math.min(dt, 0.1);
  });
  return (
    <SpinContext.Provider value={ref}>
      <group ref={ref}>{children}</group>
    </SpinContext.Provider>
  );
}
import "./Viewer3D.css";

/** The fused metaball surface, sampled from the shared field math. */
function BlobSurface() {
  const scene = useStore((s) => s.scene);
  const render3d = useStore((s) => s.render3d);
  const invalidate = useThree((s) => s.invalidate);

  const mc = useMemo(() => {
    const m = new MarchingCubes(
      render3d.detail,
      null as unknown as Material, // material is attached as a JSX child
      false,
      false,
      120000,
    );
    m.isolation = FIELD_ISO;
    return m;
  }, [render3d.detail]);

  useEffect(() => () => mc.geometry.dispose(), [mc]);

  // Re-sample the field only when the composition changes.
  useEffect(() => {
    mc.reset();
    fillField3D(mc.field, mc.size, scene);
    mc.update();
    invalidate();
  }, [mc, scene, invalidate]);

  return (
    <primitive object={mc}>
      <meshStandardMaterial
        attach="material"
        color={scene.params.color}
        roughness={render3d.roughness}
        metalness={render3d.metalness}
      />
    </primitive>
  );
}

/** Invisible grab sphere on the z = 0 plane; drag to move, click to select. */
function BlobHandle({ blob }: { blob: Blob }) {
  const scene = useStore((s) => s.scene);
  const selected = useStore((s) => s.selectedId === blob.id);
  const select = useStore((s) => s.select);
  const updateBlob = useStore((s) => s.updateBlob);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const spinRef = useContext(SpinContext);

  const [hover, setHover] = useState(false);
  const dragging = useRef(false);

  const m = stageMap(scene);
  const [wx, wy] = stageToWorld(m, blob.x, blob.y);
  const r = Math.max(blob.r * m.s, 0.02);

  /** Intersect the pointer ray with the z = 0 editing plane. */
  const planePoint = (e: ThreeEvent<PointerEvent>): { wx: number; wy: number } | null => {
    // Work in the spinning group's local space so dragging stays on the
    // blobs' own z = 0 plane at any turntable angle.
    const origin = e.ray.origin.clone();
    const direction = e.ray.direction.clone();
    const g = spinRef?.current;
    if (g) {
      const inv = new Matrix4().copy(g.matrixWorld).invert();
      origin.applyMatrix4(inv);
      direction.transformDirection(inv);
    }
    if (Math.abs(direction.z) < 1e-6) return null; // edge-on view
    const t = -origin.z / direction.z;
    return { wx: origin.x + direction.x * t, wy: origin.y + direction.y * t };
  };

  return (
    <group position={[wx, wy, 0]}>
      <mesh
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          select(blob.id);
          dragging.current = true;
          dragState.active = true;
          if (controls) controls.enabled = false;
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const p = planePoint(e);
          if (!p) return;
          const st = worldToStage(m, p.wx, p.wy);
          updateBlob(blob.id, { x: st.x, y: st.y });
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          dragState.active = false;
          if (controls) controls.enabled = true;
          (e.target as Element).releasePointerCapture(e.pointerId);
        }}
        onPointerOver={() => {
          setHover(true);
          document.body.style.cursor = "grab";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        <sphereGeometry args={[r, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {(hover || selected) && (
        <mesh userData={{ noExport: true }}>
          <sphereGeometry args={[r * 1.02, 24, 24]} />
          <meshBasicMaterial
            wireframe
            transparent
            opacity={selected ? 0.3 : 0.12}
            color={BRAND.blue}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

export default function Viewer3D() {
  const scene = useStore((s) => s.scene);
  const stageColor = useStore((s) => s.stageColor);
  const stageGradient = useStore((s) => s.stageGradient);
  const spinning = useStore((s) => s.render3d.spin !== "off");
  const background =
    scene.params.background ?? backdropCss({ ...stageGradient, from: stageColor });

  return (
    // The backdrop (solid or gradient) is CSS behind a transparent canvas.
    <div className="viewer3d-wrap" style={{ background }}>
      <Canvas
        frameloop={spinning ? "always" : "demand"}
        gl={{ alpha: true, preserveDrawingBuffer: true }}
        camera={{ position: [0, 0, 3.2], fov: 45, near: 0.1, far: 100 }}
        dpr={[1, 2]}
      >

        {/* Key + fill + cool rim for a soft, glossy read. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 4, 5]} intensity={1.15} />
        <directionalLight position={[-4, -2, -3]} intensity={0.4} color={BRAND_STOPS.energy} />
        <pointLight position={[0, 0, 4]} intensity={0.5} />

        <Spinner>
          <BlobSurface />
          {scene.blobs.map((b) => (
            <BlobHandle key={b.id} blob={b} />
          ))}
        </Spinner>

        <ExportBridge />
        <OrbitControls makeDefault enablePan={false} minDistance={1.5} maxDistance={8} />
      </Canvas>
    </div>
  );
}
