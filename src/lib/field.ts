/**
 * The metaball scalar field.
 *
 * Every source contributes a value that falls off with distance; the final
 * shape is the iso-contour where the summed, normalised field equals 1.
 *
 * Two kinds of source feed the field:
 *
 *  - **Blobs** (point sources):    exp( -dist(p, centre)²        / (2σ²) )
 *  - **Links** (segment sources):  exp( -dist(p, segment A→B)²   / (2σ²) )
 *
 * Links are "bones" in implicit-surface terms (skeletal / convolution
 * primitives): they pour goo along the entire line between two blobs, so the
 * neck they carry survives *any* separation distance — this is what keeps a
 * V shape connected however far the lobes are dragged.
 *
 * The Gaussian falloff is the mathematical form of the classic "blur then
 * threshold" goo trick. Unlike an inverse-power law it has no razor-thin
 * ridge between sources, so necks thin out smoothly instead of shattering.
 *
 * Engineered properties:
 *
 *  1. **Radius fidelity.** The field is normalised so a lone blob's contour
 *     sits exactly at its radius — and a lone link's capsule at exactly its
 *     thickness — for any goo value. The numbers you set are the sizes you see.
 *
 *  2. **Decoupled goo.** `gooToSpread` maps the 0..1 slider to a blur factor
 *     `g` (σ = size·g). Small `g` keeps shapes crisp; large `g` melts them
 *     together with soft, far-reaching fillets.
 */
import type { Blob, Link, Vec2 } from "@/model/types";
import { clamp01, lerp } from "./geometry";

/**
 * The iso value that defines the surface. The field is pre-normalised (see
 * `buildField`) so this stays a plain 1 and the tracer needs no knobs.
 */
export const ISO = 1;

/**
 * Map the 0..1 goo slider to the Gaussian spread factor `g` (σ = size · g).
 *
 * goo 0   → g≈0.55  (tight — near-perfect shapes until they overlap)
 * goo 0.5 → g≈1.0   (rounded merges, the friendly default)
 * goo 1   → g≈2.2   (heavy melt, far-reaching fillets)
 */
export const gooToSpread = (goo: number): number => lerp(0.55, 2.2, clamp01(goo));

/** Point source. `k = 1/(2σ²)` — one multiply per sample. */
export interface PointSource {
  x: number;
  y: number;
  k: number;
}

/** Segment source (capsule). A→B with precomputed direction and length². */
export interface SegmentSource {
  ax: number;
  ay: number;
  abx: number;
  aby: number;
  len2: number;
  k: number;
}

/** Sampling context: all sources plus the normalisation constant. */
export interface Field {
  points: PointSource[];
  segments: SegmentSource[];
  /** Multiplier that puts an isolated source's contour exactly on its size. */
  norm: number;
}

/**
 * Build the sampling context for a set of blobs and links.
 *
 * Radius fidelity, worked out: an isolated source at distance `d = r`
 * contributes `exp(-r²/(2σ²))` with `σ = r·g`, i.e. `exp(-1/(2g²))`.
 * Multiplying the whole field by `norm = exp(1/(2g²))` makes that exactly 1 —
 * and because the sizes cancel, one `norm` fixes every source at once
 * (blobs and link capsules alike).
 */
export const buildField = (blobs: Blob[], links: Link[], goo: number): Field => {
  const g = gooToSpread(goo);
  const g2x2 = 2 * g * g;
  const norm = Math.exp(1 / g2x2);

  const points: PointSource[] = blobs
    .filter((b) => b.r > 0)
    .map((b) => ({ x: b.x, y: b.y, k: 1 / (b.r * b.r * g2x2) }));

  const byId = new Map(blobs.map((b) => [b.id, b]));
  const segments: SegmentSource[] = [];
  for (const l of links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b || l.t <= 0) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    segments.push({
      ax: a.x,
      ay: a.y,
      abx,
      aby,
      len2: abx * abx + aby * aby,
      k: 1 / (l.t * l.t * g2x2),
    });
  }

  return { points, segments, norm };
};

/** Sample the normalised field at a point. */
export const sampleField = (px: number, py: number, field: Field): number => {
  const { points, segments, norm } = field;
  let sum = 0;

  for (let i = 0; i < points.length; i++) {
    const s = points[i];
    const dx = px - s.x;
    const dy = py - s.y;
    sum += Math.exp(-(dx * dx + dy * dy) * s.k);
  }

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    // Distance to the closest point on the segment (clamped projection).
    let t = 0;
    if (s.len2 > 0) {
      t = ((px - s.ax) * s.abx + (py - s.ay) * s.aby) / s.len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const dx = px - (s.ax + t * s.abx);
    const dy = py - (s.ay + t * s.aby);
    sum += Math.exp(-(dx * dx + dy * dy) * s.k);
  }

  return sum * norm;
};

/** Convenience overload taking a `Vec2`. */
export const sampleFieldAt = (p: Vec2, field: Field): number =>
  sampleField(p.x, p.y, field);

/**
 * Sample the same normalised field at a 3D point (all sources live on the
 * z = 0 plane, so a lone blob is a perfect sphere of radius r and a link is a
 * true 3D capsule). This is what makes the 3D view morph *identically* to the
 * 2D one: same Gaussian, same normalisation, same goo — the 2D outline is
 * literally the z = 0 cross-section of this field.
 *
 * `pz` is the distance from the editing plane in stage units. Contributions
 * with exponents below −16 (≈1e−7) are skipped; that is far beneath the iso
 * threshold of 1 and saves most of the `exp` calls on a 3D grid.
 */
export const sampleField3 = (
  px: number,
  py: number,
  pz: number,
  field: Field,
): number => {
  const { points, segments, norm } = field;
  const z2 = pz * pz;
  let sum = 0;

  for (let i = 0; i < points.length; i++) {
    const s = points[i];
    const dx = px - s.x;
    const dy = py - s.y;
    const e = -(dx * dx + dy * dy + z2) * s.k;
    if (e > -16) sum += Math.exp(e);
  }

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    let t = 0;
    if (s.len2 > 0) {
      t = ((px - s.ax) * s.abx + (py - s.ay) * s.aby) / s.len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const dx = px - (s.ax + t * s.abx);
    const dy = py - (s.ay + t * s.aby);
    const e = -(dx * dx + dy * dy + z2) * s.k;
    if (e > -16) sum += Math.exp(e);
  }

  return sum * norm;
};
