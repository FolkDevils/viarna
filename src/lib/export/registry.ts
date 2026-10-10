/**
 * Bridges the sidebars (which own the Export buttons) and the live views
 * (which own the canvases). A view registers its exporter on mount and
 * clears it on unmount.
 */
export interface PngOptions {
  /** Resolution multiplier over the on-screen canvas (1, 2, 4…). */
  scale: number;
  /** Leave the backdrop out (alpha PNG). */
  transparent: boolean;
}

export interface ViewExporter {
  png: (o: PngOptions) => Promise<Blob>;
  /** Composite one video frame (backdrop included) into ctx. */
  drawFrame: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Size of the on-screen canvas in device pixels. */
  frameSize: () => { width: number; height: number };
}

export const exporters: {
  orbit: ViewExporter | null;
  three: (ViewExporter & { glb: () => Promise<Blob>; stl: () => Blob }) | null;
  glass: (ViewExporter & { glb: () => Promise<Blob> }) | null;
} = { orbit: null, three: null, glass: null };

export const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
