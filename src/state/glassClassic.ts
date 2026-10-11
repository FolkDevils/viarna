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
  /** How far strands fan apart (vertically, and a little in depth). */
  separation: number;
  /** Extra harmonic + length warp, 0 = pure sine, 1 = very organic. */
  organic: number;
  /** How much width/thickness swell and pinch along each strand, 0..1. */
  swell: number;
  /** Radius the strands are wound around each other (bundle). */
  spread: number;
  /** Turns the bundle twists along its length. */
  twist: number;
  /** Ribbon half-width. */
  width: number;
  /** Ribbon half-thickness (≈ width → round tube, small → flat band). */
  thickness: number;
  /** Turns each ribbon rolls about its own axis along the length. */
  roll: number;
  /** How different each strand is (waves, height, speed, size), 0..1. */
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
    shape: { strands: 3, amplitude: 1.5, waves: 2.3, depth: 1.1, separation: 1.3, organic: 0.6, swell: 0.55, spread: 0.15, twist: 0.4, width: 0.7, thickness: 0.4, roll: 0.5, variation: 0.75 },
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
    shape: { strands: 5, amplitude: 1.7, waves: 2, depth: 1.5, separation: 1.2, organic: 0.6, swell: 0.55, spread: 0.3, twist: 0.6, width: 0.8, thickness: 0.5, roll: 0.5, variation: 0.6 },
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
    shape: { strands: 6, amplitude: 1.3, waves: 2.8, depth: 0.6, separation: 0.75, organic: 0.5, swell: 0.5, spread: 0.15, twist: 0.3, width: 0.55, thickness: 0.34, roll: 0.3, variation: 0.5 },
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
  separation: 1.2,
  organic: 0.6,
  swell: 0.5,
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

export const useGlassClassic = create<GlassState>((set) => ({
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
      n.separation = clamp(n.separation, 0, 4);
      n.organic = clamp(n.organic, 0, 1);
      n.swell = clamp(n.swell, 0, 1);
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
