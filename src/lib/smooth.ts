/**
 * Turn a closed polyline into an SVG path `d` string.
 *
 * With `smoothing` at 0 we emit straight line segments. Above 0 we fit a
 * closed Catmull-Rom spline through the points and convert each span to a cubic
 * Bézier — the standard Catmull-Rom→Bézier tangent construction — scaled by the
 * smoothing amount. The result is a single organic outline with no visible
 * seam, which is exactly what a metaball wants.
 */
import type { Vec2 } from "@/model/types";
import { round } from "./geometry";

const fmt = (p: Vec2): string => `${round(p.x)},${round(p.y)}`;

/** One closed loop → a `d` sub-path (starting with M, ending with Z). */
export function loopToPath(points: Vec2[], smoothing: number): string {
  const n = points.length;
  if (n < 2) return "";
  if (n < 3 || smoothing <= 0) {
    return `M${points.map(fmt).join("L")}Z`;
  }

  const k = smoothing / 6; // Catmull-Rom tension → Bézier handle length.
  const at = (i: number): Vec2 => points[((i % n) + n) % n];

  let d = `M${fmt(points[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const c1: Vec2 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2: Vec2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };

    d += `C${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
  }
  return `${d}Z`;
}

/** Join many loops into one compound `d` (rendered even-odd). */
export const loopsToPath = (loops: Vec2[][], smoothing: number): string =>
  loops
    .map((l) => loopToPath(l, smoothing))
    .filter(Boolean)
    .join(" ");
