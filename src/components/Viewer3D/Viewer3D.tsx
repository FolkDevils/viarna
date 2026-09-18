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
 * The field is only re-sampled when the scene actually changes (frameloop is
 * on demand), so orbiting stays at full frame rate.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Material } from "three";
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

  const [hover, setHover] = useState(false);
  const dragging = useRef(false);

  const m = stageMap(scene);
  const [wx, wy] = stageToWorld(m, blob.x, blob.y);
  const r = Math.max(blob.r * m.s, 0.02);

  /** Intersect the pointer ray with the z = 0 editing plane. */
  const planePoint = (e: ThreeEvent<PointerEvent>): { wx: number; wy: number } | null => {
    const { origin, direction } = e.ray;
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
        <mesh>
          <sphereGeometry args={[r * 1.02, 24, 24]} />
          <meshBasicMaterial
            wireframe
            transparent
            opacity={selected ? 0.3 : 0.12}
            color="#5b8cff"
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
  const background = scene.params.background ?? stageColor;

  return (
    <div className="viewer3d-wrap">
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 0, 3.2], fov: 45, near: 0.1, far: 100 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={[background]} />

        {/* Key + fill + cool rim for a soft, glossy read. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 4, 5]} intensity={1.15} />
        <directionalLight position={[-4, -2, -3]} intensity={0.4} color="#8fb0ff" />
        <pointLight position={[0, 0, 4]} intensity={0.5} />

        <BlobSurface />
        {scene.blobs.map((b) => (
          <BlobHandle key={b.id} blob={b} />
        ))}

        <OrbitControls makeDefault enablePan={false} minDistance={1.5} maxDistance={8} />
      </Canvas>
    </div>
  );
}
