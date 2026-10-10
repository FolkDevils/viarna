/**
 * State for the Glass tab: a bundle of flowing glass ribbons/tubes.
 * Lengths are world units (the ribbon spans ~`length` across the view).
 */
import { create } from "zustand";
import { clamp } from "@/lib/geometry";
import type { Backdrop } from "@/lib/backdrop";

export interface GlassShape {
  strands: number;
  /** Span of the ribbon along x. */
  length: number;
  /** Wave height. */
  amplitude: number;
  /** Number of wave crests across the span. */
  waves: number;
  /** How far the wave swings toward/away from camera (0 = flat wave). */
  depth: number;
  /** Radius the strands are bundled around the main wave. */
  spread: number;
  /** Turns the bundle twists along its length. */
  twist: number;
  /** Ribbon half-width. */
  width: number;
  /** Ribbon half-thickness (≈ width → round tube, small → flat band). */
  thickness: number;
  /** Turns each ribbon rolls about its own axis along the length. */
  roll: number;
  /** Per-strand randomness, 0..1. */
  variation: number;
  seed: number;
}

export interface GlassLook {
  /** Colour seen face-on through the glass. */
  tint: string;
  /** Colour at grazing angles / the edges. */
  rim: string;
  highlight: string;
  /** Face-on opacity (how clear the glass is). */
  clarity: number;
  /** Opacity at the edges. */
  rimStrength: number;
  /** Fresnel falloff exponent — higher = thinner rims. */
  fresnel: number;
  /** Crisp outline at the silhouette, 0..1. */
  edgeLine: number;
  /** Thin-film rainbow sheen, 0..1. */
  iridescence: number;
  /** Specular streaks from the virtual softboxes, 0..1. */
  specular: number;
  /** Internal reflection streaks running along the tubes, 0..1. */
  inner: number;
  backdrop: Backdrop;
}

export type GlassPreset = "clear" | "azure" | "aqua";

const BG: Backdrop = { type: "solid", from: "#fbfcfe", to: "#e6edf7", angle: 180 };

export const GLASS_PRESETS: Record<GlassPreset, { shape: Partial<GlassShape>; look: Omit<GlassLook, "backdrop"> }> = {
  // Pale, iridescent, mostly clear (reference 1).
  clear: {
    shape: { strands: 3, amplitude: 1.9, waves: 2.5, depth: 1.1, spread: 0.6, twist: 0.9, width: 0.75, thickness: 0.45, roll: 0.6, variation: 0.4 },
    look: {
      tint: "#eef3ff",
      rim: "#4f7fe0",
      highlight: "#ffffff",
      clarity: 0.1,
      rimStrength: 0.95,
      fresnel: 1.7,
      edgeLine: 0.95,
      iridescence: 0.5,
      specular: 0.9,
      inner: 0.5,
    },
  },
  // Saturated cobalt, thicker glass (reference 2).
  azure: {
    shape: { strands: 5, amplitude: 2, waves: 2.2, depth: 1.6, spread: 0.8, twist: 1.1, width: 0.85, thickness: 0.55, roll: 0.6, variation: 0.5 },
    look: {
      tint: "#c2dcff",
      rim: "#1d62e6",
      highlight: "#ffffff",
      clarity: 0.22,
      rimStrength: 1,
      fresnel: 1.4,
      edgeLine: 1,
      iridescence: 0.3,
      specular: 1,
      inner: 0.75,
    },
  },
  // Cool aqua-blue bundle (references 3 & 4).
  aqua: {
    shape: { strands: 7, amplitude: 1.6, waves: 3, depth: 0.5, spread: 0.45, twist: 0.4, width: 0.6, thickness: 0.38, roll: 0.3, variation: 0.35 },
    look: {
      tint: "#dff1fa",
      rim: "#2f7fb8",
      highlight: "#ffffff",
      clarity: 0.16,
      rimStrength: 1,
      fresnel: 1.6,
      edgeLine: 0.9,
      iridescence: 0.15,
      specular: 0.9,
      inner: 0.8,
    },
  },
};

const defaultShape = (): GlassShape => ({
  strands: 4,
  length: 20,
  amplitude: 0.85,
  waves: 1.6,
  depth: 0.9,
  spread: 0.32,
  twist: 0.6,
  width: 0.34,
  thickness: 0.12,
  roll: 0.5,
  variation: 0.4,
  seed: 7,
  ...GLASS_PRESETS.clear.shape,
});

interface GlassState {
  shape: GlassShape;
  look: GlassLook;
  preset: GlassPreset | null;
  playing: boolean;
  /** Flow cycles per minute (one cycle = the wave travels one wavelength). */
  flowRpm: number;
  setShape: (p: Partial<GlassShape>) => void;
  setLook: (p: Partial<GlassLook>) => void;
  setBackdrop: (p: Partial<Backdrop>) => void;
  applyPreset: (p: GlassPreset) => void;
  setPlaying: (on: boolean) => void;
  setFlowRpm: (v: number) => void;
  reset: () => void;
}

export const useGlass = create<GlassState>((set) => ({
  shape: defaultShape(),
  look: { ...GLASS_PRESETS.clear.look, backdrop: { ...BG } },
  preset: "clear",
  playing: true,
  flowRpm: 6,

  setShape: (p) =>
    set((s) => {
      const n = { ...s.shape, ...p };
      n.strands = clamp(Math.round(n.strands), 1, 12);
      n.length = clamp(n.length, 2, 30);
      n.amplitude = clamp(n.amplitude, 0, 3);
      n.waves = clamp(n.waves, 0.25, 6);
      n.depth = clamp(n.depth, 0, 3);
      n.spread = clamp(n.spread, 0, 2);
      n.twist = clamp(n.twist, -4, 4);
      n.width = clamp(n.width, 0.02, 1.5);
      n.thickness = clamp(n.thickness, 0.005, 1.5);
      n.roll = clamp(n.roll, -4, 4);
      n.variation = clamp(n.variation, 0, 1);
      return { shape: n, preset: null };
    }),
  setLook: (p) => set((s) => ({ look: { ...s.look, ...p }, preset: null })),
  setBackdrop: (p) => set((s) => ({ look: { ...s.look, backdrop: { ...s.look.backdrop, ...p } } })),
  applyPreset: (p) =>
    set((s) => ({
      preset: p,
      shape: { ...s.shape, ...GLASS_PRESETS[p].shape },
      look: { ...GLASS_PRESETS[p].look, backdrop: s.look.backdrop },
    })),
  setPlaying: (on) => set({ playing: on }),
  setFlowRpm: (v) => set({ flowRpm: clamp(v, 0, 60) }),
  reset: () =>
    set({
      shape: defaultShape(),
      look: { ...GLASS_PRESETS.clear.look, backdrop: { ...BG } },
      preset: "clear",
      playing: true,
      flowRpm: 6,
    }),
}));
