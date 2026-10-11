/**
 * Save / open settings files.
 *
 * A settings file captures one tab:
 *   { format: "viarna-settings", version: 1, tab, savedAt, data }
 * Opening a file switches to its tab and restores it. Older 2D documents
 * ({ format: "viarna", scene }) from "Save .json" open too.
 *
 * Where the browser supports it (Chrome, Edge) a native Save/Open dialog lets
 * you pick any folder — e.g. your Desktop; elsewhere the file goes to
 * Downloads and opening uses a regular file picker. Loading is defensive:
 * missing or unknown fields fall back to defaults, so files stay readable as
 * the app grows.
 */
import { useStore, type ViewMode } from "@/state/store";
import { useOrbit, PRESETS, MAX_CIRCLES, type OrbitCircle } from "@/state/orbit";
import { useGlass } from "@/state/glass";
import { liveAngles } from "@/lib/orbit/runtime";
import { downloadBlob } from "@/lib/svg/download";
import { stamp } from "@/lib/export/registry";
import type { Scene } from "@/model/types";

export interface SettingsFile {
  format: "viarna-settings";
  version: 1;
  tab: ViewMode;
  savedAt: string;
  data: Record<string, unknown>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
/** Keep only fields whose type matches the reference object's. */
const sameTypes = <T extends object>(src: Obj, ref: T): Partial<T> => {
  const out: Obj = {};
  const r = ref as Obj;
  for (const k of Object.keys(r)) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v === typeof r[k] && (typeof v !== "number" || Number.isFinite(v))) out[k] = v;
  }
  // Enum-valued string fields: drop anything outside the known set.
  const enums: Record<string, string[]> = {
    type: ["solid", "linear", "radial"],
    spin: ["off", "left", "right"],
    mode: ["fill", "outline", "knockout"],
  };
  for (const [k, allowed] of Object.entries(enums)) {
    if (k in out && !allowed.includes(out[k] as string)) delete out[k];
  }
  return out as Partial<T>;
};

const TAB_LABEL: Record<ViewMode, string> = { "2d": "2D", "3d": "3D", orbit: "Orbit", glass: "Glass" };

/** Snapshot the given tab. */
export function collectSettings(tab: ViewMode): SettingsFile {
  let data: Obj;
  if (tab === "orbit") {
    const s = useOrbit.getState();
    data = {
      // Bake live angles in so the file reopens exactly where you saved it.
      circles: s.circles.map((c) => ({ ...c, angle: liveAngles.get(c.id) ?? c.angle })),
      rpm: s.rpm,
      playing: s.playing,
      showGuides: s.showGuides,
      preset: s.preset,
      look: s.look,
    };
  } else if (tab === "glass") {
    const s = useGlass.getState();
    data = { shape: s.shape, look: s.look, preset: s.preset, flowRpm: s.flowRpm, playing: s.playing };
  } else {
    const s = useStore.getState();
    data = {
      scene: s.scene,
      stageColor: s.stageColor,
      stageGradient: s.stageGradient,
      render3d: s.render3d,
      mirror: s.mirror,
      uniformSize: s.uniformSize,
    };
  }
  return { format: "viarna-settings", version: 1, tab, savedAt: new Date().toISOString(), data };
}

/** Apply a parsed file. Returns the tab it belongs to. Throws on bad input. */
export function applySettings(raw: unknown): ViewMode {
  if (!isObj(raw)) throw new Error("That file isn't Viarna settings.");

  // Legacy 2D document from "Save .json".
  if (raw.format === "viarna" && isObj(raw.scene)) {
    useStore.getState().loadScene(raw.scene as unknown as Scene);
    return "2d";
  }
  if (raw.format !== "viarna-settings" || !isObj(raw.data)) {
    throw new Error("That file isn't Viarna settings.");
  }
  const tab = raw.tab as ViewMode;
  const d = raw.data;

  if (tab === "orbit") {
    const base = PRESETS.halo;
    const look = isObj(d.look) ? d.look : {};
    const backdrop = isObj(look.backdrop) ? look.backdrop : {};
    const circles: OrbitCircle[] = (Array.isArray(d.circles) ? d.circles : [])
      .filter(isObj)
      .slice(0, MAX_CIRCLES)
      .map((c, i) => ({
        id: `orb-load-${Date.now().toString(36)}-${i}`,
        orbit: num(c.orbit, 230),
        angle: num(c.angle, 0),
        r: num(c.r, 110),
        speed: num(c.speed, 1),
        dir: c.dir === "ccw" ? "ccw" : "cw",
      }));
    liveAngles.clear();
    useOrbit.setState({
      circles,
      selectedId: null,
      rpm: num(d.rpm, 6),
      playing: d.playing !== false,
      showGuides: d.showGuides !== false,
      preset: (["halo", "tight", "solid"] as const).find((p) => p === d.preset) ?? null,
      look: {
        ...base,
        ...sameTypes(look, base),
        backdrop: { ...base.backdrop, ...sameTypes(backdrop, base.backdrop) },
      },
    });
    return "orbit";
  }

  if (tab === "glass") {
    const g = useGlass.getState();
    g.reset();
    const ref = useGlass.getState();
    if (isObj(d.shape)) g.setShape(sameTypes(d.shape, ref.shape));
    if (isObj(d.look)) {
      const { backdrop, ...rest } = d.look;
      const { backdrop: refBg, ...refLook } = ref.look;
      g.setLook(sameTypes(rest, refLook));
      if (isObj(backdrop)) g.setBackdrop(sameTypes(backdrop, refBg));
    }
    g.setFlowRpm(num(d.flowRpm, 6));
    g.setPlaying(d.playing !== false);
    useGlass.setState({
      preset: (["clear", "azure", "aqua"] as const).find((p) => p === d.preset) ?? null,
    });
    return "glass";
  }

  if (tab === "2d" || tab === "3d") {
    const st = useStore.getState();
    if (isObj(d.scene)) st.loadScene(d.scene as unknown as Scene);
    st.setStageColor(str(d.stageColor, st.stageColor));
    if (isObj(d.stageGradient)) st.setStageBackdrop(sameTypes(d.stageGradient, st.stageGradient));
    if (isObj(d.render3d)) st.setRender3d(sameTypes(d.render3d, st.render3d));
    st.setMirror(d.mirror === true);
    st.setUniformSize(d.uniformSize === true);
    return tab;
  }

  throw new Error("Unknown tab in settings file.");
}

// ---- file dialogs -------------------------------------------------------

interface FilePickerWindow {
  showSaveFilePicker?: (o: unknown) => Promise<{
    createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile: () => Promise<File> }[]>;
}
const fsWin = () => window as unknown as FilePickerWindow;
const JSON_TYPES = [{ description: "Viarna settings", accept: { "application/json": [".json"] } }];

/** Save the tab's settings. Resolves to the saved file name, or null if cancelled. */
export async function saveSettingsFile(tab: ViewMode): Promise<string | null> {
  const file = collectSettings(tab);
  const name = `viarna-${tab}-${stamp()}.json`;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const w = fsWin();
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name, startIn: "desktop", types: JSON_TYPES });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return name;
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      // Fall through to a plain download if the picker is blocked.
    }
  }
  downloadBlob(name, blob);
  return name;
}

/** Read + apply a File (from a picker or drag-and-drop). */
export async function openSettingsBlob(f: File): Promise<ViewMode> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await f.text());
  } catch {
    throw new Error(`${f.name} isn't a valid settings file.`);
  }
  return applySettings(parsed);
}

/** Ask for a file and apply it. Resolves to its tab, or null if cancelled. */
export async function openSettingsFile(): Promise<ViewMode | null> {
  const w = fsWin();
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ startIn: "desktop", types: JSON_TYPES, multiple: false });
      return openSettingsBlob(await h.getFile());
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      openSettingsBlob(f).then(resolve, reject);
    };
    input.click();
  });
}

export const tabLabel = (t: ViewMode) => TAB_LABEL[t];
