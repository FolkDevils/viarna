/**
 * The Viarna document model.
 *
 * A `Scene` is the single source of truth: a fixed-size stage, a list of
 * `Blob`s (circles), and the render `params` that decide how those circles are
 * fused into one organic shape and painted. Everything else in the app — the
 * canvas, the exporter, the smoke test — is a pure function of a `Scene`, so
 * the picture on screen and the SVG you paste into Figma are guaranteed to
 * match.
 *
 * Keep this file small and boring on purpose: new features (gradients, extra
 * shape kinds, animation tracks) should extend these types rather than reach
 * around them.
 */

/** A point in stage coordinates. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * One metaball. `r` is the *visible* radius the circle has when it is on its
 * own — the field math (see `lib/field.ts`) is normalised so a lone blob draws
 * at exactly this radius regardless of the goo setting.
 */
export interface Blob {
  id: string;
  x: number;
  y: number;
  r: number;
}

/**
 * A connector between two blobs — a "bone" in implicit-surface terms.
 *
 * A link contributes goo along the whole line segment between its two blobs
 * (a capsule), so the neck it carries **never breaks**, no matter how far the
 * blobs are pulled apart. `t` is the neck's thickness: the radius the capsule
 * would draw at if it stood alone. Endpoints follow the blobs automatically
 * because the segment is resolved from blob ids at render time.
 */
export interface Link {
  id: string;
  /** Blob id at one end. */
  from: string;
  /** Blob id at the other end. */
  to: string;
  /** Neck thickness (isolated capsule radius, stage units). */
  t: number;
}

/** How the fused shape is painted. */
export type RenderMode =
  /** Solid filled shape — the classic black blob. */
  | "fill"
  /** Stroked outline only, no fill. */
  | "outline"
  /** The shape punched out of a solid rectangle (a "knockout"). */
  | "knockout";

export interface RenderParams {
  mode: RenderMode;
  /** Fill colour (fill/knockout) or stroke colour (outline). */
  color: string;
  /** Stage background. `null` means transparent (checkerboard in editor). */
  background: string | null;
  /**
   * How eagerly blobs merge, 0..1. Low = they stay separate until they touch;
   * high = long, stretchy bridges that connect from a distance.
   */
  goo: number;
  /**
   * Contour quality: grid cells across the longest edge. Higher = smoother and
   * more faithful, but heavier paths. 96–220 is a sensible range.
   */
  resolution: number;
  /** Curve smoothing of the traced outline, 0..1. */
  smoothing: number;
  /** Stroke width used in `outline` mode (stage units). */
  strokeWidth: number;
  /** Grain/texture overlay on/off. */
  texture: boolean;
  /** Grain intensity, 0..1 (drives opacity + a little edge dissolve). */
  textureAmount: number;
  /** Grain size, 0..1 (low = fine film grain, high = coarse). */
  textureScale: number;
}

export interface Scene {
  width: number;
  height: number;
  blobs: Blob[];
  links: Link[];
  params: RenderParams;
}

/** On-disk document wrapper — versioned so old files stay loadable. */
export interface ViarnaDoc {
  format: "viarna";
  version: 1;
  scene: Scene;
}
