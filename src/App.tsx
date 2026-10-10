import { lazy, Suspense } from "react";
import { useStore } from "@/state/store";
import Canvas from "@/components/Canvas/Canvas";
import Sidebar from "@/components/Sidebar/Sidebar";
import { Segmented } from "@/components/common/fields";
import OrbitView from "@/components/Orbit/OrbitView";
import OrbitSidebar from "@/components/Orbit/OrbitSidebar";
import { useOrbit } from "@/state/orbit";
import { useGlass } from "@/state/glass";
import "@/App.css";

// Three.js is heavy; load the 3D view only when it's first opened so the 2D
// editor stays fast to boot.
const Viewer3D = lazy(() => import("@/components/Viewer3D/Viewer3D"));
const GlassView = lazy(() => import("@/components/Glass/GlassView"));
const GlassSidebar = lazy(() => import("@/components/Glass/GlassSidebar"));

const VIEW_OPTS = [
  { value: "2d" as const, label: "2D" },
  { value: "3d" as const, label: "3D" },
  { value: "orbit" as const, label: "Orbit" },
  { value: "glass" as const, label: "Glass" },
];

export default function App() {
  const resetScene = useStore((s) => s.reset);
  const resetOrbit = useOrbit((s) => s.reset);
  const resetGlass = useGlass((s) => s.reset);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Viarna</span>
          <span className="brand-tag">morphing shapes studio</span>
        </div>
        <div className="topbar-actions">
          <div className="view-switch">
            <Segmented value={viewMode} options={VIEW_OPTS} onChange={setViewMode} />
          </div>
          <button className="ghost-btn" onClick={viewMode === "orbit" ? resetOrbit : viewMode === "glass" ? resetGlass : resetScene}>
            Reset
          </button>
        </div>
      </header>
      <main className="workspace">
        {viewMode === "glass" ? (
          <Suspense fallback={<div className="viewer3d-wrap" />}>
            <GlassView />
            <GlassSidebar />
          </Suspense>
        ) : viewMode === "orbit" ? (
          <>
            <OrbitView />
            <OrbitSidebar />
          </>
        ) : (
          <>
            {viewMode === "3d" ? (
              <Suspense fallback={<div className="viewer3d-wrap" />}>
                <Viewer3D />
              </Suspense>
            ) : (
              <Canvas />
            )}
            <Sidebar />
          </>
        )}
      </main>
    </div>
  );
}
