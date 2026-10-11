import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import Canvas from "@/components/Canvas/Canvas";
import Sidebar from "@/components/Sidebar/Sidebar";
import { Segmented } from "@/components/common/fields";
import OrbitView from "@/components/Orbit/OrbitView";
import OrbitSidebar from "@/components/Orbit/OrbitSidebar";
import { useOrbit } from "@/state/orbit";
import { useGlass } from "@/state/glass";
import { openSettingsBlob, openSettingsFile, saveSettingsFile, tabLabel } from "@/lib/settings";
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

  // Short-lived status line next to Save / Open.
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const noteTimer = useRef<number>();
  const flash = (text: string, error = false) => {
    setNote({ text, error });
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 3500);
  };

  const doSave = async () => {
    try {
      const name = await saveSettingsFile(viewMode);
      if (name) flash(`Saved ${tabLabel(viewMode)} settings`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't save.", true);
    }
  };
  const afterOpen = (tab: string | null) => {
    if (!tab) return;
    setViewMode(tab as typeof viewMode);
    flash(`Opened ${tabLabel(tab as typeof viewMode)} settings`);
  };
  const doOpen = () =>
    openSettingsFile().then(afterOpen, (e) => flash(e instanceof Error ? e.message : "Couldn't open.", true));

  // Drop a settings file anywhere on the window to open it.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const hasFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const over = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) openSettingsBlob(f).then(afterOpen, (err) => flash(err instanceof Error ? err.message : "Couldn't open.", true));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {note && <span className={note.error ? "topbar-note error" : "topbar-note"}>{note.text}</span>}
          <button className="ghost-btn" onClick={doOpen} title="Open a saved settings file (or drop one on the window)">
            Open…
          </button>
          <button className="ghost-btn" onClick={doSave} title={`Save this tab's settings to a file`}>
            Save
          </button>
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
      {dragging && <div className="drop-overlay">Drop a Viarna settings file to open it</div>}
    </div>
  );
}
