/**
 * Marching squares: turn the scalar field into closed contour loops.
 *
 * We sample the field on a regular grid, then for every cell look at which of
 * its four corners are "inside" (field ≥ ISO). That 4-bit pattern selects one
 * or two edge-crossing segments, and the exact crossing point on each edge is
 * found by linear interpolation of the field — which is what makes the traced
 * circles smooth rather than blocky.
 *
 * The loose segments are then stitched end-to-end into closed loops. Because
 * neighbouring cells compute the *same* crossing point on their shared edge
 * (same corner values, same formula), endpoints match exactly and stitching is
 * robust.
 *
 * Output loops are in world (stage) coordinates. Disjoint blobs yield separate
 * loops; a ring of blobs enclosing a gap yields an extra inner loop (a hole),
 * which the serializer renders with the even-odd fill rule.
 */
import type { Vec2 } from "@/model/types";
import { ISO, sampleField, type Field } from "./field";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Edge-connection table indexed by the 4-bit corner mask
 * (bit 8 = top-left, 4 = top-right, 2 = bottom-right, 1 = bottom-left).
 * Each entry lists pairs of edges to connect, where edges are
 * 0 = top, 1 = right, 2 = bottom, 3 = left.
 */
const CASES: number[][][] = [
  [], // 0
  [[3, 2]], // 1  BL
  [[2, 1]], // 2  BR
  [[3, 1]], // 3  BL+BR
  [[0, 1]], // 4  TR
  [], // 5  TR+BL — saddle, resolved per-cell (see below)
  [[0, 2]], // 6  TR+BR
  [[0, 3]], // 7  TR+BR+BL
  [[0, 3]], // 8  TL
  [[0, 2]], // 9  TL+BL
  [], // 10 TL+BR — saddle, resolved per-cell (see below)
  [[0, 1]], // 11 TL+BR+BL
  [[3, 1]], // 12 TL+TR
  [[2, 1]], // 13 TL+TR+BL
  [[3, 2]], // 14 TL+TR+BR
  [], // 15
];

/**
 * Saddle resolutions. In cases 5 (TR+BL) and 10 (TL+BR) the corner pattern
 * alone is ambiguous: the two inside corners may be one connected band or two
 * separate islands. We disambiguate with the cell-centre value (the average of
 * the four corners — the bilinear interpolant at the centre). Getting this
 * wrong shows up exactly at neck pinch-points, i.e. the extreme shapes.
 */
const SADDLE_5_JOINED = [[0, 3], [2, 1]]; //  TR–BL band: contour hugs TL and BR
const SADDLE_5_SPLIT = [[0, 1], [3, 2]]; //   TR and BL are separate islands
const SADDLE_10_JOINED = [[0, 1], [2, 3]]; // TL–BR band: contour hugs TR and BL
const SADDLE_10_SPLIT = [[0, 3], [1, 2]]; //  TL and BR are separate islands

const frac = (a: number, b: number): number => {
  const denom = b - a;
  if (denom === 0) return 0.5;
  const t = (ISO - a) / denom;
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

/** Compute the world-space crossing point for one edge of a cell. */
function edgePoint(
  edge: number,
  gx: number,
  gy: number,
  vTL: number,
  vTR: number,
  vBR: number,
  vBL: number,
  minX: number,
  minY: number,
  cell: number,
): Vec2 {
  let ux = gx;
  let uy = gy;
  switch (edge) {
    case 0: // top: TL→TR
      ux = gx + frac(vTL, vTR);
      uy = gy;
      break;
    case 1: // right: TR→BR
      ux = gx + 1;
      uy = gy + frac(vTR, vBR);
      break;
    case 2: // bottom: BL→BR
      ux = gx + frac(vBL, vBR);
      uy = gy + 1;
      break;
    case 3: // left: TL→BL
      ux = gx;
      uy = gy + frac(vTL, vBL);
      break;
  }
  return { x: minX + ux * cell, y: minY + uy * cell };
}

const key = (p: Vec2): string => `${p.x.toFixed(4)}_${p.y.toFixed(4)}`;

/**
 * Trace all iso-contours of the field within `bounds`.
 * `cells` is the target number of grid cells along the longest edge.
 */
export function traceContours(
  field: Field,
  bounds: Bounds,
  cells: number,
): Vec2[][] {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0 || field.points.length + field.segments.length === 0) return [];

  const cell = Math.max(w, h) / Math.max(8, Math.floor(cells));
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));

  // Sample the field on the (cols+1) x (rows+1) corner grid once.
  const stride = cols + 1;
  const values = new Float64Array(stride * (rows + 1));
  for (let gy = 0; gy <= rows; gy++) {
    const py = bounds.minY + gy * cell;
    for (let gx = 0; gx <= cols; gx++) {
      values[gy * stride + gx] = sampleField(bounds.minX + gx * cell, py, field);
    }
  }

  // Collect all edge segments, plus an adjacency map for stitching.
  const segStart: Vec2[] = [];
  const segEnd: Vec2[] = [];
  const adj = new Map<string, number[]>(); // point key → segment indices

  const pushSeg = (a: Vec2, b: Vec2) => {
    const idx = segStart.length;
    segStart.push(a);
    segEnd.push(b);
    for (const p of [a, b]) {
      const k = key(p);
      const list = adj.get(k);
      if (list) list.push(idx);
      else adj.set(k, [idx]);
    }
  };

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const vTL = values[gy * stride + gx];
      const vTR = values[gy * stride + gx + 1];
      const vBR = values[(gy + 1) * stride + gx + 1];
      const vBL = values[(gy + 1) * stride + gx];

      let mask = 0;
      if (vTL >= ISO) mask |= 8;
      if (vTR >= ISO) mask |= 4;
      if (vBR >= ISO) mask |= 2;
      if (vBL >= ISO) mask |= 1;

      let pairs = CASES[mask];
      if (mask === 5 || mask === 10) {
        const centreInside = (vTL + vTR + vBR + vBL) / 4 >= ISO;
        pairs =
          mask === 5
            ? centreInside
              ? SADDLE_5_JOINED
              : SADDLE_5_SPLIT
            : centreInside
              ? SADDLE_10_JOINED
              : SADDLE_10_SPLIT;
      }
      if (pairs.length === 0) continue;
      for (const [e0, e1] of pairs) {
        const a = edgePoint(e0, gx, gy, vTL, vTR, vBR, vBL, bounds.minX, bounds.minY, cell);
        const b = edgePoint(e1, gx, gy, vTL, vTR, vBR, vBL, bounds.minX, bounds.minY, cell);
        pushSeg(a, b);
      }
    }
  }

  // Stitch segments into closed loops.
  const used = new Uint8Array(segStart.length);
  const loops: Vec2[][] = [];

  const nextFrom = (pt: Vec2): number => {
    const list = adj.get(key(pt));
    if (!list) return -1;
    for (const idx of list) {
      if (!used[idx]) return idx;
    }
    return -1;
  };

  for (let i = 0; i < segStart.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: Vec2[] = [segStart[i], segEnd[i]];
    let tail = segEnd[i];
    let guard = 0;
    const limit = segStart.length + 4;
    while (guard++ < limit) {
      const idx = nextFrom(tail);
      if (idx < 0) break;
      used[idx] = 1;
      // Orient the next segment so it continues from `tail`.
      const a = segStart[idx];
      const b = segEnd[idx];
      const next = key(a) === key(tail) ? b : a;
      if (key(next) === key(loop[0])) {
        break; // closed
      }
      loop.push(next);
      tail = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}
