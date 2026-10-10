/**
 * Live (per-frame) angles for orbit circles, keyed by circle id.
 *
 * Angles advance every animation frame, so they live outside React/zustand to
 * avoid re-rendering the UI 60×/s. A circle without an entry starts at its
 * stored `angle`. Integrating per frame (instead of angle = phase + ωt) means
 * flipping direction or changing speed never makes a circle jump.
 */
export const liveAngles = new Map<string, number>();

export const STAGE_REF = 800;
