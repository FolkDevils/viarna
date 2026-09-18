/**
 * Ramer–Douglas–Peucker polyline simplification.
 *
 * Marching squares emits a vertex on every crossed cell edge, so a smooth arc
 * arrives as dozens of nearly-collinear points. Dropping the ones that sit
 * within `epsilon` of the line between their neighbours keeps the silhouette
 * identical while producing SVG paths that stay light enough to paste into a
 * design tool without lag.
 */
import type { Vec2 } from "@/model/types";

const perpDist2 = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  // Perpendicular distance squared from p to the infinite line a→b.
  const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
  return (cross * cross) / len2;
};

/** Simplify an open polyline. */
export function simplifyOpen(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points.slice();
  const eps2 = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxD = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist2(points[i], points[start], points[end]);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (index !== -1 && maxD > eps2) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Simplify a closed loop. We rotate so the two most distant "anchor" points
 * bookend the array, run the open simplifier, and hand back a clean ring.
 */
export function simplifyClosed(loop: Vec2[], epsilon: number): Vec2[] {
  if (loop.length < 4) return loop.slice();

  // Anchor on the point farthest from loop[0] to avoid arbitrary seam artefacts.
  let far = 1;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const dx = loop[i].x - loop[0].x;
    const dy = loop[i].y - loop[0].y;
    const d = dx * dx + dy * dy;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }

  const first = simplifyOpen(loop.slice(0, far + 1), epsilon);
  const second = simplifyOpen(loop.slice(far), epsilon);
  // Splice the two halves, dropping only the shared point at the seam
  // (`second` starts with loop[far], which `first` already ends with).
  return first.concat(second.slice(1));
}
