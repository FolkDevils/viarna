/**
 * Global application state (zustand).
 *
 * The store holds a single `Scene` plus transient UI state (selection and the
 * editing toggles). Actions are small and intention-revealing so components
 * stay dumb. Because the whole picture is derived from `scene`, undo/redo,
 * persistence, or an animation layer can later be added here without
 * disturbing the UI.
 *
 * Editing toggles (not part of the exported scene):
 *  - `mirror`: dragging a blob moves its opposite-side partner to the mirrored
 *    position across the stage's vertical centreline, so a V pulls apart
 *    symmetrically. Blobs sitting on the centreline stay locked to it.
 *  - `uniformSize`: resizing any blob resizes all of them together.
 *  - `stageColor`: the editor's backdrop colour behind the art. Purely a
 *    viewing preference (like Figma's grey canvas) — it is never exported, so
 *    a shape can still be copied out on a transparent background.
 */
import { create } from "zustand";
import type { Blob, Link, RenderParams, Scene } from "@/model/types";
import { defaultScene, newBlob, nextId } from "@/model/defaults";
import { clamp } from "@/lib/geometry";

/** Which renderer the workspace shows. */
export type ViewMode = "2d" | "3d";

/** Look controls for the 3D (Three.js / R3F) blobular renderer. */
export interface Render3D {
  /** Marching-cubes grid resolution — higher = smoother/heavier. */
  detail: number;
  /** PBR surface roughness, 0 (glossy) … 1 (matte). */
  roughness: number;
  /** PBR metalness, 0 (dielectric) … 1 (metal). */
  metalness: number;
}

interface ViarnaState {
  scene: Scene;
  selectedId: string | null;
  mirror: boolean;
  uniformSize: boolean;
  stageColor: string;
  viewMode: ViewMode;
  render3d: Render3D;

  select: (id: string | null) => void;
  setMirror: (on: boolean) => void;
  setUniformSize: (on: boolean) => void;
  setStageColor: (color: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setRender3d: (patch: Partial<Render3D>) => void;

  addBlob: () => void;
  /** Removes the blob and every link attached to it. */
  removeBlob: (id: string) => void;
  /** Patch a blob's position/radius. Applies clamping, mirror and uniform-size rules. */
  updateBlob: (id: string, patch: Partial<Omit<Blob, "id">>) => void;

  addLink: (from: string, to: string) => void;
  updateLink: (id: string, patch: { t?: number }) => void;
  removeLink: (id: string) => void;

  setParams: (patch: Partial<RenderParams>) => void;

  /**
   * Resize the stage to the measured canvas area (full-bleed editing).
   * Blobs are translated so the composition stays centred, then clamped.
   */
  setStageSize: (width: number, height: number) => void;

  loadScene: (scene: Scene) => void;
  reset: () => void;
}

const MIN_RADIUS = 8;
/** Necks can go hair-thin; the sampler auto-refines so they still render. */
const MIN_LINK_T = 0.5;
const MAX_LINK_T = 120;
const DEFAULT_LINK_T = 16;
/** Within this many px of the centreline a blob is treated as "on the spine". */
const AXIS_SNAP = 10;
/** Figma's default canvas grey — the editor backdrop out of the box. */
export const DEFAULT_STAGE_COLOR = "#F5F5F5";

export const useStore = create<ViarnaState>((set) => ({
  scene: defaultScene(),
  selectedId: null,
  mirror: false,
  uniformSize: false,
  stageColor: DEFAULT_STAGE_COLOR,
  viewMode: "2d",
  render3d: { detail: 64, roughness: 0.3, metalness: 0.1 },

  select: (id) => set({ selectedId: id }),
  setMirror: (on) => set({ mirror: on }),
  setUniformSize: (on) => set({ uniformSize: on }),
  setStageColor: (color) => set({ stageColor: color }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setRender3d: (patch) =>
    set((s) => {
      const next = { ...s.render3d, ...patch };
      next.detail = clamp(Math.round(next.detail), 24, 160);
      next.roughness = clamp(next.roughness, 0, 1);
      next.metalness = clamp(next.metalness, 0, 1);
      return { render3d: next };
    }),

  addBlob: () =>
    set((s) => {
      const b = newBlob();
      const existing = s.scene.blobs;
      const links = [...s.scene.links];
      // Join the new blob into the shape by linking it to the nearest blob, so
      // adding never drops a disconnected island.
      if (existing.length > 0) {
        let nearest = existing[0];
        let best = Infinity;
        for (const e of existing) {
          const d2 = (e.x - b.x) ** 2 + (e.y - b.y) ** 2;
          if (d2 < best) {
            best = d2;
            nearest = e;
          }
        }
        links.push({ id: nextId("link"), from: nearest.id, to: b.id, t: DEFAULT_LINK_T });
      }
      return { scene: { ...s.scene, blobs: [...existing, b], links }, selectedId: b.id };
    }),

  removeBlob: (id) =>
    set((s) => {
      const { scene } = s;
      // Collect the removed blob's neighbours (and the average neck thickness of
      // its links) so we can heal the connection instead of severing it.
      const neighbours: string[] = [];
      const seen = new Set<string>();
      let tSum = 0;
      let tCount = 0;
      for (const l of scene.links) {
        const other = l.from === id ? l.to : l.to === id ? l.from : null;
        if (other === null || other === id) continue;
        tSum += l.t;
        tCount += 1;
        if (!seen.has(other)) {
          seen.add(other);
          neighbours.push(other);
        }
      }

      const links = scene.links.filter((l) => l.from !== id && l.to !== id);
      const bridgeT = tCount > 0 ? tSum / tCount : DEFAULT_LINK_T;
      const linked = (a: string, b: string) =>
        links.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));

      // Reconnect the neighbours in a chain (n0–n1–n2…). For the common case of
      // a middle blob (two neighbours) this bridges them directly (A–C).
      for (let i = 0; i + 1 < neighbours.length; i++) {
        const a = neighbours[i];
        const b = neighbours[i + 1];
        if (!linked(a, b)) {
          links.push({ id: nextId("link"), from: a, to: b, t: bridgeT });
        }
      }

      return {
        scene: {
          ...scene,
          blobs: scene.blobs.filter((b) => b.id !== id),
          links,
        },
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    }),

  updateBlob: (id, patch) =>
    set((s) => {
      const { scene, mirror, uniformSize } = s;
      const src = scene.blobs.find((b) => b.id === id);
      if (!src) return {};

      const axis = scene.width / 2;
      const next: Blob = { ...src, ...patch };
      next.r = Math.max(MIN_RADIUS, next.r);
      next.x = clamp(next.x, 0, scene.width);
      next.y = clamp(next.y, 0, scene.height);
      // In mirror mode a blob dragged onto the spine stays exactly on it.
      if (mirror && Math.abs(next.x - axis) < AXIS_SNAP) next.x = axis;

      const updates = new Map<string, Blob>([[id, next]]);

      if (mirror && Math.abs(next.x - axis) >= AXIS_SNAP) {
        // Partner = the nearest-in-y blob on the opposite side of the axis
        // (spine blobs excluded). It gets the exact mirrored position, and the
        // same radius when this was a resize.
        const side = Math.sign(next.x - axis);
        let partner: Blob | undefined;
        let best = Infinity;
        for (const b of scene.blobs) {
          if (b.id === id) continue;
          if (Math.abs(b.x - axis) < AXIS_SNAP) continue;
          if (Math.sign(b.x - axis) === side) continue;
          const dy = Math.abs(b.y - next.y);
          if (dy < best) {
            best = dy;
            partner = b;
          }
        }
        if (partner) {
          updates.set(partner.id, {
            ...partner,
            x: clamp(2 * axis - next.x, 0, scene.width),
            y: next.y,
            r: patch.r !== undefined ? next.r : partner.r,
          });
        }
      }

      if (uniformSize && patch.r !== undefined) {
        for (const b of scene.blobs) {
          const cur = updates.get(b.id) ?? b;
          updates.set(b.id, { ...cur, r: next.r });
        }
      }

      return {
        scene: { ...scene, blobs: scene.blobs.map((b) => updates.get(b.id) ?? b) },
      };
    }),

  addLink: (from, to) =>
    set((s) => {
      if (from === to) return {};
      const ids = new Set(s.scene.blobs.map((b) => b.id));
      if (!ids.has(from) || !ids.has(to)) return {};
      const dup = s.scene.links.some(
        (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from),
      );
      if (dup) return {};
      const link: Link = { id: nextId("link"), from, to, t: DEFAULT_LINK_T };
      return { scene: { ...s.scene, links: [...s.scene.links, link] } };
    }),

  updateLink: (id, patch) =>
    set((s) => ({
      scene: {
        ...s.scene,
        links: s.scene.links.map((l) =>
          l.id === id
            ? { ...l, t: patch.t !== undefined ? clamp(patch.t, MIN_LINK_T, MAX_LINK_T) : l.t }
            : l,
        ),
      },
    })),

  removeLink: (id) =>
    set((s) => ({
      scene: { ...s.scene, links: s.scene.links.filter((l) => l.id !== id) },
    })),

  setParams: (patch) =>
    set((s) => {
      const next = { ...s.scene.params, ...patch };
      next.goo = clamp(next.goo, 0, 1);
      next.smoothing = clamp(next.smoothing, 0, 1);
      next.resolution = clamp(Math.round(next.resolution), 40, 320);
      next.strokeWidth = clamp(next.strokeWidth, 0.5, 80);
      next.textureAmount = clamp(next.textureAmount, 0, 1);
      next.textureScale = clamp(next.textureScale, 0, 1);
      return { scene: { ...s.scene, params: next } };
    }),

  setStageSize: (width, height) =>
    set((s) => {
      const w = Math.max(200, Math.round(width));
      const h = Math.max(200, Math.round(height));
      if (w === s.scene.width && h === s.scene.height) return {};
      const dx = (w - s.scene.width) / 2;
      const dy = (h - s.scene.height) / 2;
      return {
        scene: {
          ...s.scene,
          width: w,
          height: h,
          blobs: s.scene.blobs.map((b) => ({
            ...b,
            x: clamp(b.x + dx, 0, w),
            y: clamp(b.y + dy, 0, h),
          })),
        },
      };
    }),

  // Tolerate older documents: backfill links and any params added since.
  loadScene: (scene) =>
    set({
      scene: {
        ...scene,
        links: scene.links ?? [],
        params: {
          ...scene.params,
          texture: scene.params.texture ?? false,
          textureAmount: scene.params.textureAmount ?? 0.5,
          textureScale: scene.params.textureScale ?? 0.4,
        },
      },
      selectedId: null,
    }),

  reset: () => set({ scene: defaultScene(), selectedId: null }),
}));
