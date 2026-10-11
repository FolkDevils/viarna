/**
 * State for the Glass tab: a bundle of flowing glass ribbons/tubes.
 * Lengths are world units (the ribbon spans ~`length` across the view).
 */
import { create } from "zustand";
import { clamp } from "@/lib/geometry";
import type { Backdrop } from "@/lib/backdrop";
import { BRAND, BRAND_BACKDROPS, BRAND_STOPS } from "@/lib/brand";

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

/** Physical glass parameters (see `lib/glass/material.ts`). */
export interface GlassLook {
  /** Glass colour: what white light becomes after 1/density units of glass. */
  color: string;
  /** How fast colour builds up with thickness — thin faces stay pale. */
  density: number;
  /** Colour added each time light bounces inside — saturates edges and streaks. */
  bounceTint: number;
  /** Index of refraction (glass ≈ 1.5). Higher bends more, traps more light. */
  ior: number;
  /** Red/green/blue refraction split (rainbow fringes), 0..1. */
  dispersion: number;
  /** Surface reflection strength; 1 = physically correct. */
  reflection: number;
  /** Thin-film rainbow on the reflections, 0..1. */
  sheen: number;
  /** How far behind the glass the stage sits — more = stronger bending. */
  distortion: number;
  /** Studio softbox colour. */
  highlight: string;
  /** Softbox brightness. */
  lights: number;
  /** Studio contrast: 0 = evenly lit white room, 1 = dark room + softboxes. */
  studio: number;
  backdrop: Backdrop;
}

export type GlassPreset = "viarna" | "deep" | "energy";

const BG = (): Backdrop => ({ ...BRAND_BACKDROPS.white.backdrop });

export const GLASS_PRESETS: Record<GlassPreset, { shape: Partial<GlassShape>; look: Omit<GlassLook, "backdrop"> }> = {
  // Clear Viarna Blue glass, tuned against the brand reference render.
  viarna: {
    shape: { strands: 3, length: 28.5, amplitude: 0.77, waves: 2.3, depth: 3, spread: 0.52, separation: 0.25, organic: 0.6, swell: 1, twist: 1.3, width: 0.9, thickness: 0.715, roll: 0, variation: 1, seed: 7 },
    look: {
      color: BRAND.blue,
      density: 0.1,
      bounceTint: 0.3,
      ior: 1.5,
      dispersion: 0.35,
      reflection: 1,
      sheen: 0.15,
      distortion: 2,
      highlight: BRAND.white,
      lights: 1,
      studio: 0.75,
    },
  },
  // Thicker Deep Blue glass.
  deep: {
    shape: { strands: 5, length: 20, amplitude: 1.7, waves: 2, depth: 1.5, separation: 1.2, organic: 0.6, swell: 0.55, spread: 0.3, twist: 0.6, width: 0.8, thickness: 0.5, roll: 0.5, variation: 0.6 },
    look: {
      color: BRAND.deepBlue,
      density: 0.12,
      bounceTint: 0.25,
      ior: 1.52,
      dispersion: 0.25,
      reflection: 1,
      sheen: 0.1,
      distortion: 2,
      highlight: BRAND.white,
      lights: 1.1,
      studio: 0.6,
    },
  },
  // Bright aqua bundle in the Energy cyan.
  energy: {
    shape: { strands: 6, length: 20, amplitude: 1.3, waves: 2.8, depth: 0.6, separation: 0.75, organic: 0.5, swell: 0.5, spread: 0.15, twist: 0.3, width: 0.55, thickness: 0.34, roll: 0.3, variation: 0.5 },
    look: {
      color: BRAND_STOPS.energy,
      density: 0.2,
      bounceTint: 0.35,
      ior: 1.48,
      dispersion: 0.5,
      reflection: 1,
      sheen: 0.35,
      distortion: 2,
      highlight: BRAND.white,
      lights: 1,
      studio: 0.5,
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
  ...GLASS_PRESETS.viarna.shape,
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
  look: { ...GLASS_PRESETS.viarna.look, backdrop: BG() },
  preset: "viarna",
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
  setLook: (p) =>
    set((s) => {
      const n = { ...s.look, ...p };
      n.density = clamp(n.density, 0, 2);
      n.bounceTint = clamp(n.bounceTint, 0, 1);
      n.ior = clamp(n.ior, 1, 2.4);
      n.dispersion = clamp(n.dispersion, 0, 1);
      n.reflection = clamp(n.reflection, 0, 3);
      n.sheen = clamp(n.sheen, 0, 1);
      n.distortion = clamp(n.distortion, 0, 8);
      n.lights = clamp(n.lights, 0, 3);
      n.studio = clamp(n.studio, 0, 1);
      return { look: n, preset: null };
    }),
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
      look: { ...GLASS_PRESETS.viarna.look, backdrop: BG() },
      preset: "viarna",
      playing: true,
      flowRpm: 6,
    }),
}));
