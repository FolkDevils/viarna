/**
 * The core pipeline: a `Scene` → the fused metaball outline.
 *
 *   blobs + links ──▶ field ──▶ marching squares ──▶ simplify ──▶ smooth
 *
 * This is the one function the rest of the app depends on. The canvas calls it
 * to draw, and the exporter calls it to serialise — so what you see is exactly
 * what you copy. It is deliberately pure (no React, no DOM), which keeps it
 * trivially testable and reusable from the Node smoke test.
 */
import type { Blob, Link, Scene, Vec2 } from "@/model/types";
import { buildField, gooToSpread } from "./field";
import { traceContours, type Bounds } from "./marchingSquares";
import { simplifyClosed } from "./simplify";
import { loopsToPath } from "./smooth";

/**
 * Bounding box that comfortably contains every source's influence. A
 * neighbour's Gaussian tail slightly inflates a source's far side, so the
 * padding grows with both source size and goo (spread) to keep the contour
 * from ever being clipped. Link capsules run between blob centres, so the
 * blob bounding box already contains them laterally; their thickness is
 * folded into the pad.
 */
export function fieldBounds(blobs: Blob[], links: Link[], goo: number): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxSize = 0;
  for (const b of blobs) {
    if (b.r <= 0) continue;
    minX = Math.min(minX, b.x - b.r);
    minY = Math.min(minY, b.y - b.r);
    maxX = Math.max(maxX, b.x + b.r);
    maxY = Math.max(maxY, b.y + b.r);
    maxSize = Math.max(maxSize, b.r);
  }
  for (const l of links) maxSize = Math.max(maxSize, l.t);
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const pad = Math.max(12, maxSize * gooToSpread(goo) * 0.75);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

/**
 * Ceiling for the auto-refined grid so a hair-thin neck on a huge stage can't
 * blow up sampling cost. Below this, the effective resolution is raised as
 * needed to keep thin features solid.
 */
const MAX_EFFECTIVE_RES = 700;

export interface MetaballResult {
  /** Raw traced loops in stage coordinates. */
  loops: Vec2[][];
  /** The compound SVG path `d`. Empty string when there is nothing to draw. */
  d: string;
}

/** Run the full pipeline for a scene. */
export function computeMetaball(scene: Scene): MetaballResult {
  const { blobs, links, params } = scene;
  const field = buildField(blobs, links, params.goo);
  if (field.points.length + field.segments.length === 0) return { loops: [], d: "" };

  const bounds = fieldBounds(blobs, links, params.goo);
  const maxDim = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

  // Marching squares drops any feature thinner than its cell, so a thin neck
  // (or tiny blob) needs a fine enough grid. Auto-raise the effective
  // resolution so the thinnest feature always gets a few samples across it —
  // capped so cost stays bounded. The user's Quality slider is the floor.
  let thinnest = Infinity;
  for (const l of links) if (l.t > 0) thinnest = Math.min(thinnest, l.t);
  for (const b of blobs) if (b.r > 0) thinnest = Math.min(thinnest, b.r);
  const needed = Number.isFinite(thinnest) ? Math.ceil(maxDim / (thinnest * 0.6)) : 0;
  const effRes = Math.min(MAX_EFFECTIVE_RES, Math.max(params.resolution, needed));

  const raw = traceContours(field, bounds, effRes);

  // Simplify relative to the sampling cell so detail scales with resolution.
  const cell = maxDim / effRes;
  const epsilon = cell * 0.12;
  const loops = raw.map((l) => simplifyClosed(l, epsilon)).filter((l) => l.length >= 3);

  return { loops, d: loopsToPath(loops, params.smoothing) };
}
