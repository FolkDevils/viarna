import { lazy, Suspense } from "react";
import { useStore } from "@/state/store";
import Canvas from "@/components/Canvas/Canvas";
import Sidebar from "@/components/Sidebar/Sidebar";
import { Segmented } from "@/components/common/fields";
import "@/App.css";

// Three.js is heavy; load the 3D view only when it's first opened so the 2D
// editor stays fast to boot.
const Viewer3D = lazy(() => import("@/components/Viewer3D/Viewer3D"));

const VIEW_OPTS = [
  { value: "2d" as const, label: "2D" },
  { value: "3d" as const, label: "3D" },
];

export default function App() {
  const reset = useStore((s) => s.reset);
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
          <button className="ghost-btn" onClick={reset}>
            Reset
          </button>
        </div>
      </header>
      <main className="workspace">
        {viewMode === "3d" ? (
          <Suspense fallback={<div className="viewer3d-wrap" />}>
            <Viewer3D />
          </Suspense>
        ) : (
          <Canvas />
        )}
        <Sidebar />
      </main>
    </div>
  );
}
