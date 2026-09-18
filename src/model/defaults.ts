/**
 * The scene Viarna opens with: a V — two lobes up top, one at the bottom
 * centre, each top lobe linked to the bottom one. The links guarantee the
 * necks survive any amount of pulling apart.
 */
import type { Scene } from "./types";

let counter = 0;
/** Small, dependency-free unique id. */
export const nextId = (prefix = "blob"): string =>
  `${prefix}-${Date.now().toString(36)}-${counter++}`;

export const STAGE_WIDTH = 720;
export const STAGE_HEIGHT = 560;

export const defaultScene = (): Scene => {
  const topLeft = { id: nextId(), x: 235, y: 185, r: 62 };
  const topRight = { id: nextId(), x: 485, y: 185, r: 62 };
  const bottom = { id: nextId(), x: 360, y: 430, r: 62 };
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
      color: "#111111",
      background: null,
      goo: 0.5,
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
