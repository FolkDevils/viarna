/**
 * Animated SVG export for the Orbit tab.
 *
 * Vector approximation of the shader: every circle is an SMIL
 * `animateTransform` rotation about the stage centre (so it loops forever
 * with no script), and a classic "goo" filter (blur → alpha threshold) fuses
 * them. The halo ring is a second, wider goo layer whose ink is dissolved by
 * an feTurbulence grain mask. Plays in browsers; design tools import the
 * first frame and may ignore the filters.
 */
import { useOrbit, type OrbitCircle } from "@/state/orbit";
import { liveAngles, STAGE_REF } from "./runtime";
import type { Backdrop } from "@/lib/backdrop";

const f = (n: number) => +n.toFixed(3);

function backdropDefs(b: Backdrop, W: number, H: number): { defs: string; fill: string } {
  if (b.type === "solid") return { defs: "", fill: b.from };
  if (b.type === "linear") {
    const a = (b.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    return {
      defs: `<linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="${f(-dx * half)}" y1="${f(-dy * half)}" x2="${f(dx * half)}" y2="${f(dy * half)}"><stop offset="0" stop-color="${b.from}"/><stop offset="1" stop-color="${b.to}"/></linearGradient>`,
      fill: "url(#bg)",
    };
  }
  return {
    defs: `<radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${f(Math.hypot(W / 2, H / 2))}"><stop offset="0" stop-color="${b.from}"/><stop offset="1" stop-color="${b.to}"/></radialGradient>`,
    fill: "url(#bg)",
  };
}

function circleGroup(c: OrbitCircle, rpm: number, grow: number, fill: string) {
  const a0 = ((liveAngles.get(c.id) ?? c.angle) * 180) / Math.PI;
  const w = rpm * c.speed;
  const body = `<circle cx="${f(c.orbit)}" cy="0" r="${f(c.r + grow)}" fill="${fill}"/>`;
  if (w <= 0) return `<g transform="rotate(${f(a0)})">${body}</g>`;
  const dur = 60 / w;
  const to = a0 + (c.dir === "cw" ? 360 : -360);
  return `<g transform="rotate(${f(a0)})"><animateTransform attributeName="transform" type="rotate" from="${f(a0)} 0 0" to="${f(to)} 0 0" dur="${f(dur)}s" repeatCount="indefinite"/>${body}</g>`;
}

/** `w`,`h` are the on-screen stage size in CSS px (sets the aspect). */
export function orbitAnimatedSvg(w: number, h: number, transparent: boolean): string {
  const { circles, rpm, look } = useOrbit.getState();
  const k = STAGE_REF / Math.min(w, h);
  const W = w * k;
  const H = h * k;
  const bg = backdropDefs(look.backdrop, W, H);
  // Blur radius that gives a neck comparable to the shader's smooth-union.
  const sd = Math.max(1, look.goo * 0.55);
  const goo = (id: string) =>
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${f(sd)}" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="g"/></filter>`;
  const grainFilter =
    look.grain > 0
      ? `<filter id="haloGoo" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${f(sd)}" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="g"/><feTurbulence type="fractalNoise" baseFrequency="${f(0.9 / Math.max(0.5, look.grainSize))}" numOctaves="1" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${f(-14 * look.grain)} ${f(7 * look.grain + (1 - look.grain) * 1 + 0.3)}" result="m"/><feComposite in="g" in2="m" operator="in"/></filter>`
      : goo("haloGoo");

  const halo =
    look.haloWidth > 0
      ? `<g filter="url(#haloGoo)" opacity="${f(1 - look.haloFade * 0.45)}">${circles
          .map((c) => circleGroup(c, rpm, look.haloWidth, look.halo))
          .join("")}</g>`
      : "";
  // Core: radial rim→core gradient per circle, fused by the goo filter.
  const coreGrad = `<radialGradient id="coreGrad"><stop offset="0" stop-color="${look.core}"/><stop offset="${f(
    Math.max(0, 1 - look.coreFalloff / 60),
  )}" stop-color="${look.core}"/><stop offset="1" stop-color="${look.rim}"/></radialGradient>`;
  const core = `<g filter="url(#coreGoo)">${circles.map((c) => circleGroup(c, rpm, 0, "url(#coreGrad)")).join("")}</g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="${f(-W / 2)} ${f(-H / 2)} ${f(W)} ${f(H)}">
<defs>${bg.defs}${goo("coreGoo")}${grainFilter}${coreGrad}</defs>
${transparent ? "" : `<rect x="${f(-W / 2)}" y="${f(-H / 2)}" width="${f(W)}" height="${f(H)}" fill="${bg.fill}"/>`}
${halo}
${core}
</svg>`;
}
