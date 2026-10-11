/**
 * State for the Orbit tab: circles that travel around the stage centre,
 * each clockwise or counter-clockwise, rendered with the dithered-falloff
 * look (see `lib/orbit/shader.ts`).
 *
 * Kept separate from the main editor store on purpose — the orbit scene has
 * its own model (orbit radius / angle / direction) and its own look params.
 *
 * Units are "logical" pixels on an 800 × 800 reference stage; the view scales
 * them to fit the shortest side of the canvas, so the composition and the
 * look hold at any window size.
 */
import { create } from "zustand";
import { BRAND, BRAND_BACKDROPS } from "@/lib/brand";
import { clamp } from "@/lib/geometry";
import { liveAngles } from "@/lib/orbit/runtime";
import type { Backdrop } from "@/lib/backdrop";

export type Direction = "cw" | "ccw";

export interface OrbitCircle {
  id: string;
  /** Distance from the stage centre (logical px). */
  orbit: number;
  /** Starting angle in radians (0 = 3 o'clock). Live angle lives in the runtime. */
  angle: number;
  /** Circle radius (logical px). */
  r: number;
  /** Speed multiplier relative to the global RPM. */
  speed: number;
  dir: Direction;
}

/** Everything that controls the rendered look. Lengths are logical px. */
export interface OrbitLook {
  /** Solid or gradient stage behind the blobs (rendered in the shader). */
  backdrop: Backdrop;
  /** Grainy outer ring colour. */
  halo: string;
  /** Core colour right at its edge. */
  rim: string;
  /** Core colour at the deep centre. */
  core: string;
  /** Neck / blend size (smooth-union radius). */
  goo: number;
  /** Width of the grainy halo ring outside the dark core. 0 = no halo. */
  haloWidth: number;
  /** How much the halo thins out toward its outer edge, 0..1. */
  haloFade: number;
  /** Length of the rim→core gradient into the core. */
  coreFalloff: number;
  /** Softness of the outer edge. */
  edge: number;
  /** Softness of the core edge. */
  coreEdge: number;
  /** Stochastic grain strength, 0 (smooth) .. 1 (pure binary dither). */
  grain: number;
  /** Grain clump size in device pixels (soft value noise). */
  grainSize: number;
  /** Re-roll the grain every frame (film boil) instead of a fixed screen. */
  grainBoil: boolean;
}

export type OrbitPreset = "halo" | "tight" | "solid";

/**
 * Presets measured off the reference renders (scaled to an R≈110 circle),
 * in brand colours.
 */
export const PRESETS: Record<OrbitPreset, OrbitLook> = {
  halo: {
    backdrop: { ...BRAND_BACKDROPS.air.backdrop },
    halo: BRAND.blue,
    rim: BRAND.deepBlue,
    core: BRAND.deepBlue,
    goo: 27,
    haloWidth: 21,
    haloFade: 0.58,
    coreFalloff: 24,
    edge: 2,
    coreEdge: 2.7,
    grain: 0.28,
    grainSize: 1.2,
    grainBoil: false,
  },
  tight: {
    backdrop: { ...BRAND_BACKDROPS.white.backdrop },
    halo: BRAND.blue,
    rim: BRAND.deepBlue,
    core: BRAND.deepBlue,
    goo: 18,
    haloWidth: 0,
    haloFade: 0.58,
    coreFalloff: 23,
    edge: 2,
    coreEdge: 3,
    grain: 0.5,
    grainSize: 1.2,
    grainBoil: false,
  },
  solid: {
    backdrop: { ...BRAND_BACKDROPS.white.backdrop },
    halo: BRAND.deepBlue,
    rim: BRAND.deepBlue,
    core: BRAND.deepBlue,
    goo: 30,
    haloWidth: 0,
    haloFade: 0.58,
    coreFalloff: 1,
    edge: 0.6,
    coreEdge: 0.6,
    grain: 0,
    grainSize: 1.2,
    grainBoil: false,
  },
};

export const MAX_CIRCLES = 24;

let counter = 0;
const nextId = () => `orb-${Date.now().toString(36)}-${counter++}`;

const defaultCircles = (): OrbitCircle[] => {
  // Two clockwise, two counter-clockwise on one ring: they pass through each
  // other and goo together four times per lap.
  const base = { orbit: 230, r: 110, speed: 1 };
  return [
    { id: nextId(), ...base, angle: 0, dir: "cw" },
    { id: nextId(), ...base, angle: Math.PI, dir: "cw" },
    { id: nextId(), ...base, angle: Math.PI / 2, dir: "ccw" },
    { id: nextId(), ...base, angle: (3 * Math.PI) / 2, dir: "ccw" },
  ];
};

interface OrbitState {
  circles: OrbitCircle[];
  selectedId: string | null;
  playing: boolean;
  /** Revolutions per minute at speed multiplier 1. */
  rpm: number;
  showGuides: boolean;
  preset: OrbitPreset | null;
  look: OrbitLook;

  select: (id: string | null) => void;
  setPlaying: (on: boolean) => void;
  setRpm: (rpm: number) => void;
  setShowGuides: (on: boolean) => void;
  addCircle: () => void;
  removeCircle: (id: string) => void;
  updateCircle: (id: string, patch: Partial<Omit<OrbitCircle, "id">>) => void;
  setAllDirections: (mode: Direction | "alternate") => void;
  applyPreset: (p: OrbitPreset) => void;
  setLook: (patch: Partial<OrbitLook>) => void;
  setBackdrop: (patch: Partial<Backdrop>) => void;
  reset: () => void;
}

export const useOrbit = create<OrbitState>((set) => ({
  circles: defaultCircles(),
  selectedId: null,
  playing: true,
  rpm: 6,
  showGuides: true,
  preset: "halo",
  look: { ...PRESETS.halo },

  select: (id) => set({ selectedId: id }),
  setPlaying: (on) => set({ playing: on }),
  setRpm: (rpm) => set({ rpm: clamp(rpm, 0, 60) }),
  setShowGuides: (on) => set({ showGuides: on }),

  addCircle: () =>
    set((s) => {
      if (s.circles.length >= MAX_CIRCLES) return {};
      // Drop the new circle opposite the most recent one, travelling the
      // other way, so it immediately has something to meet.
      const last = s.circles[s.circles.length - 1];
      const lastAngle = last ? liveAngles.get(last.id) ?? last.angle : 0;
      const c: OrbitCircle = {
        id: nextId(),
        orbit: last?.orbit ?? 230,
        angle: lastAngle + Math.PI,
        r: last?.r ?? 110,
        speed: 1,
        dir: last?.dir === "cw" ? "ccw" : "cw",
      };
      return { circles: [...s.circles, c], selectedId: c.id };
    }),

  removeCircle: (id) =>
    set((s) => {
      liveAngles.delete(id);
      return {
        circles: s.circles.filter((c) => c.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    }),

  updateCircle: (id, patch) =>
    set((s) => ({
      circles: s.circles.map((c) => {
        if (c.id !== id) return c;
        const n = { ...c, ...patch };
        n.r = clamp(n.r, 4, 400);
        n.orbit = clamp(n.orbit, 0, 600);
        n.speed = clamp(n.speed, 0, 5);
        return n;
      }),
    })),

  setAllDirections: (mode) =>
    set((s) => ({
      circles: s.circles.map((c, i) => ({
        ...c,
        dir: mode === "alternate" ? (i % 2 === 0 ? "cw" : "ccw") : mode,
      })),
    })),

  applyPreset: (p) =>
    set((s) => ({
      preset: p,
      // Presets set the colours but keep the gradient style you chose.
      look: {
        ...PRESETS[p],
        backdrop: { ...s.look.backdrop, from: PRESETS[p].backdrop.from, to: PRESETS[p].backdrop.to },
      },
    })),

  setBackdrop: (patch) =>
    set((s) => ({ look: { ...s.look, backdrop: { ...s.look.backdrop, ...patch } } })),

  setLook: (patch) =>
    set((s) => {
      const n = { ...s.look, ...patch };
      n.goo = clamp(n.goo, 0, 120);
      n.haloWidth = clamp(n.haloWidth, 0, 120);
      n.haloFade = clamp(n.haloFade, 0, 1);
      n.coreFalloff = clamp(n.coreFalloff, 0.5, 200);
      n.edge = clamp(n.edge, 0, 30);
      n.coreEdge = clamp(n.coreEdge, 0, 30);
      n.grain = clamp(n.grain, 0, 1);
      n.grainSize = clamp(n.grainSize, 0.5, 8);
      return { look: n, preset: null };
    }),

  reset: () => {
    liveAngles.clear();
    set({
      circles: defaultCircles(),
      selectedId: null,
      playing: true,
      rpm: 6,
      preset: "halo",
      look: { ...PRESETS.halo },
    });
  },
}));
