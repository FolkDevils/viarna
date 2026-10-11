/**
 * Viarna brand palette — every default colour in the app comes from here.
 *
 * Gradients follow the brand spec; `angle` uses the CSS convention of the
 * backdrop model (0° = bottom→top, 90° = left→right, `from` → `to`).
 */
import type { Backdrop } from "./backdrop";

export const BRAND = {
  blue: "#0070D4",
  deepBlue: "#054B88",
  air: "#F2FFEF",
  white: "#FFFFFF",
} as const;

/** Extra stops that only appear inside the brand gradients. */
export const BRAND_STOPS = {
  airLow: "#E6FFF1",
  energy: "#52EEFF",
} as const;

export const BRAND_SWATCHES: { name: string; value: string }[] = [
  { name: "Viarna Blue", value: BRAND.blue },
  { name: "Viarna Deep Blue", value: BRAND.deepBlue },
  { name: "Viarna Air", value: BRAND.air },
  { name: "White", value: BRAND.white },
];

export type BrandBackdrop = "white" | "air" | "depth" | "energy";

export const BRAND_BACKDROPS: Record<BrandBackdrop, { label: string; backdrop: Backdrop }> = {
  white: { label: "White", backdrop: { type: "solid", from: BRAND.white, to: BRAND.air, angle: 0 } },
  /** Restrained surface, bottom → top. */
  air: { label: "Air", backdrop: { type: "linear", from: BRAND_STOPS.airLow, to: BRAND.air, angle: 0 } },
  /** Primary blue, left → right. */
  depth: { label: "Depth", backdrop: { type: "linear", from: BRAND.deepBlue, to: BRAND.blue, angle: 90 } },
  /** Expressive treatment, left → right. */
  energy: { label: "Energy", backdrop: { type: "linear", from: BRAND.blue, to: BRAND_STOPS.energy, angle: 90 } },
};
