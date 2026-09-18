/**
 * Scene → 3D scalar field for marching cubes.
 *
 * The 3D view does NOT approximate the scene with three.js's own metaballs —
 * it samples the *exact same field* the 2D renderer contours (`lib/field.ts`:
 * normalised Gaussian blobs + capsule links, iso = 1), just at 3D grid points.
 * Because every source sits on the z = 0 plane, the z = 0 cross-section of
 * this field is the 2D outline itself: goo, links, radii and thin necks all
 * react identically in both views.
 *
 * Coordinate mapping — three-stdlib's `MarchingCubes` mesh spans [-1, 1] and
 * its grid axis i maps to world `2·i/size − 1`. We place the stage into that
 * cube with one uniform scale (so circles stay spheres at any stage aspect):
 *
 *     world = (stage − centre) · (2 / maxDim),   world y flipped (screen-down)
 */
import type { Scene, Vec2 } from "@/model/types";
import { buildField, sampleField3, ISO } from "@/lib/field";

/** The iso threshold the marching cubes must use — same as the 2D tracer. */
export const FIELD_ISO = ISO;

export interface StageMap {
  /** stage px → world units. */
  s: number;
  cx: number;
  cy: number;
}

export const stageMap = (scene: Scene): StageMap => ({
  s: 2 / (Math.max(scene.width, scene.height) || 1),
  cx: scene.width / 2,
  cy: scene.height / 2,
});

export const stageToWorld = (m: StageMap, x: number, y: number): [number, number] => [
  (x - m.cx) * m.s,
  -(y - m.cy) * m.s,
];

export const worldToStage = (m: StageMap, wx: number, wy: number): Vec2 => ({
  x: wx / m.s + m.cx,
  y: m.cy - wy / m.s,
});

/**
 * Fill a marching-cubes field grid (`size³` floats, indexed z·size² + y·size + x)
 * with the scene's field values. Pair with `isolation = FIELD_ISO`.
 */
export function fillField3D(target: Float32Array, size: number, scene: Scene): void {
  const m = stageMap(scene);
  const field = buildField(scene.blobs, scene.links, scene.params.goo);
  const inv = 1 / m.s; // world → stage px
  const half = size / 2;

  let i = 0;
  for (let z = 0; z < size; z++) {
    const pz = ((z - half) / half) * inv; // stage-unit distance from the plane
    for (let y = 0; y < size; y++) {
      const py = m.cy - ((y - half) / half) * inv;
      for (let x = 0; x < size; x++, i++) {
        const px = ((x - half) / half) * inv + m.cx;
        target[i] = sampleField3(px, py, pz, field);
      }
    }
  }
}
