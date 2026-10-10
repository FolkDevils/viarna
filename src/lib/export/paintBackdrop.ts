/**
 * Paint a Backdrop onto a 2D canvas with the same geometry as the CSS
 * gradients the views use, so exported images match the screen.
 */
import type { Backdrop } from "@/lib/backdrop";

export function paintBackdrop(ctx: CanvasRenderingContext2D, b: Backdrop, w: number, h: number) {
  if (b.type === "solid") {
    ctx.fillStyle = b.from;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  let g: CanvasGradient;
  if (b.type === "linear") {
    // CSS: 0deg points up, angles go clockwise; gradient line length is
    // |w·sinθ| + |h·cosθ| through the centre.
    const a = (b.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  } else {
    // circle farthest-corner at centre
    g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w / 2, h / 2));
  }
  g.addColorStop(0, b.from);
  g.addColorStop(1, b.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
