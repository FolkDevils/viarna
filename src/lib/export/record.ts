/**
 * Real-time video capture of a canvas.
 *
 * Each animation frame we call `draw(ctx)` to composite whatever the view
 * shows into a private 2D canvas, and MediaRecorder encodes that stream.
 * MP4 (H.264) is used where the browser can encode it (Chrome 126+, Safari),
 * otherwise WebM. Recording runs at real speed, so keep the tab visible.
 */
export interface RecordResult {
  blob: Blob;
  ext: "mp4" | "webm";
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export const pickVideoMime = (): string | null => {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
};

/** Even, capped dimensions — H.264 encoders reject odd sizes. */
export const videoSize = (w: number, h: number, maxEdge = 2160) => {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  const even = (n: number) => Math.max(2, Math.floor((n * k) / 2) * 2);
  return { width: even(w), height: even(h) };
};

export function recordCanvas(opts: {
  width: number;
  height: number;
  seconds: number;
  fps?: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  onProgress?: (elapsed: number) => void;
}): Promise<RecordResult> {
  const mime = pickVideoMime();
  if (!mime) return Promise.reject(new Error("Video recording isn't supported in this browser."));
  const fps = opts.fps ?? 60;
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d")!;
  // Manual frame pushing (captureStream(0) + requestFrame) hands the encoder
  // every composited frame, even if the page briefly drops below `fps`.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const push = () => track.requestFrame?.();
  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.round(opts.width * opts.height * fps * 0.15),
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  return new Promise((resolve, reject) => {
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      opts.draw(ctx, canvas.width, canvas.height);
      push();
      const t = (performance.now() - start) / 1000;
      opts.onProgress?.(Math.min(t, opts.seconds));
      if (t >= opts.seconds) {
        rec.stop();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((tr) => tr.stop());
      // Name the file after what the encoder actually produced.
      const actual = rec.mimeType || mime;
      const blob = new Blob(chunks, { type: actual.split(";")[0] });
      if (blob.size === 0) {
        reject(new Error("The browser recorded an empty video — try again, or use Chrome."));
        return;
      }
      resolve({ blob, ext: actual.includes("mp4") ? "mp4" : "webm" });
    };
    rec.onerror = () => reject(new Error("Recording failed."));
    opts.draw(ctx, canvas.width, canvas.height);
    rec.start(250);
    push();
    raf = requestAnimationFrame(loop);
  });
}

export const canvasToPng = (c: HTMLCanvasElement): Promise<Blob> =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
