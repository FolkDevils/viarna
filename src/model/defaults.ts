/**
 * The scene Viarna opens with: a V — two lobes up top, one at the bottom
 * centre, each top lobe linked to the bottom one. The links guarantee the
 * necks survive any amount of pulling apart.
 */
import type { Scene } from "./types";
import { BRAND } from "@/lib/brand";

let counter = 0;
/** Small, dependency-free unique id. */
export const nextId = (prefix = "blob"): string =>
  `${prefix}-${Date.now().toString(36)}-${counter++}`;

export const STAGE_WIDTH = 720;
export const STAGE_HEIGHT = 560;

export const defaultScene = (): Scene => {
  const cx = STAGE_WIDTH / 2;
  const cy = STAGE_HEIGHT / 2;
  const topLeft = { id: nextId(), x: cx - 153.64, y: cy - 197.48, r: 62 };
  const topRight = { id: nextId(), x: cx + 153.64, y: cy - 197.48, r: 62 };
  const bottom = { id: nextId(), x: cx, y: cy + 150, r: 62 };
  return {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    blobs: [topLeft, topRight, bottom],
    links: [
      { id: nextId("link"), from: topLeft.id, to: bottom.id, t: 16 },
      { id: nextId("link"), from: topRight.id, to: bottom.id, t: 16 },
    ],
    params: {
      mode: "fill",
      color: BRAND.blue,
      background: null,
      goo: 0.1,
      resolution: 200,
      smoothing: 1,
      strokeWidth: 6,
      texture: false,
      textureAmount: 0.5,
      textureScale: 0.4,
    },
  };
};

/** A fresh blob dropped near the middle of the stage. */
export const newBlob = (x = STAGE_WIDTH / 2, y = STAGE_HEIGHT / 2, r = 80) => ({
  id: nextId(),
  x,
  y,
  r,
});
