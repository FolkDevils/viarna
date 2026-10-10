/**
 * Gradient backdrops shared by every tab.
 *
 * A backdrop is a start colour (`from`) plus an optional gradient to `to`:
 *  - linear: CSS angle convention (0° = bottom→top, 90° = left→right)
 *  - radial: centre → farthest corner
 * The 2D and 3D views paint it with CSS; the Orbit shader evaluates the same
 * maths per pixel, so all three look identical for identical settings.
 */
export type BackdropType = "solid" | "linear" | "radial";

export interface Backdrop {
  type: BackdropType;
  from: string;
  to: string;
  /** Degrees, linear only. */
  angle: number;
}

export const backdropCss = (b: Backdrop): string => {
  switch (b.type) {
    case "linear":
      return `linear-gradient(${b.angle}deg, ${b.from}, ${b.to})`;
    case "radial":
      return `radial-gradient(circle farthest-corner at center, ${b.from}, ${b.to})`;
    default:
      return b.from;
  }
};

export const BACKDROP_TYPE_ID: Record<BackdropType, number> = { solid: 0, linear: 1, radial: 2 };
