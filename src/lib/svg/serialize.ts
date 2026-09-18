/**
 * Scene → paint description → SVG markup.
 *
 * `buildArtSpec` is the single source of truth for how a scene is painted:
 * the live canvas renders the spec as JSX (cheap attribute updates while
 * dragging) and the exporter stringifies the *same* spec — so the screen and
 * the copied SVG can never drift apart.
 *
 * Three paint modes:
 *   fill      — solid shape in `color`
 *   outline   — stroked silhouette, no fill
 *   knockout  — the shape punched out of a solid `color` rectangle (even-odd)
 *
 * Export frames:
 *   stage frame  — the full working stage (what you see while editing)
 *   content frame — a tight box around the traced shape plus padding, so a
 *                   Figma paste arrives without dead whitespace
 */
import type { Scene, Vec2 } from "@/model/types";
import { round, lerp, clamp01 } from "@/lib/geometry";
import { computeMetaball } from "@/lib/metaball";

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The full working stage. */
export const stageFrame = (scene: Scene): Frame => ({
  x: 0,
  y: 0,
  w: scene.width,
  h: scene.height,
});

/** Tight box around the traced loops, padded (plus stroke allowance). */
export function contentFrame(scene: Scene, loops: Vec2[][], pad = 16): Frame {
  if (loops.length === 0) return stageFrame(scene);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const extra = scene.params.mode === "outline" ? scene.params.strokeWidth / 2 : 0;
  const p = pad + extra;
  return { x: minX - p, y: minY - p, w: maxX - minX + 2 * p, h: maxY - minY + 2 * p };
}

const framePathD = (f: Frame): string =>
  `M${round(f.x)},${round(f.y)}H${round(f.x + f.w)}V${round(f.y + f.h)}H${round(f.x)}Z`;

/**
 * A grain/texture filter, described concretely (all numbers resolved) so the
 * canvas and the exporter emit byte-identical `<filter>` markup. Rendered as a
 * `feTurbulence` film-grain overlay: fine monochrome noise blended over the
 * shape, clipped to it, with a touch of blur + displacement so the edge
 * dissolves into grain (the soft, dusty look of the reference).
 */
export interface TextureSpec {
  id: string;
  baseFrequency: number;
  numOctaves: number;
  seed: number;
  blur: number;
  displace: number;
  grainAlpha: number;
}

/** Everything needed to paint the art, ready for JSX or string output. */
export interface ArtSpec {
  background: (Frame & { fill: string }) | null;
  texture: TextureSpec | null;
  path: {
    d: string;
    fill: string;
    fillRule?: "evenodd";
    stroke?: string;
    strokeWidth?: number;
    strokeLinejoin?: "round";
    /** `url(#id)` referencing the texture filter, when texture is on. */
    filter?: string;
  } | null;
}

/**
 * Serialise a `TextureSpec` to a self-contained `<filter>` element. Used by
 * both the live canvas (via defs) and the exporter, so they never drift.
 */
export const textureFilterEl = (t: TextureSpec): string =>
  `<filter id="${t.id}" x="-25%" y="-25%" width="150%" height="150%" ` +
  `color-interpolation-filters="sRGB">` +
  `<feTurbulence type="fractalNoise" baseFrequency="${t.baseFrequency}" ` +
  `numOctaves="${t.numOctaves}" seed="${t.seed}" stitchTiles="stitch" result="noise"/>` +
  `<feGaussianBlur in="SourceGraphic" stdDeviation="${t.blur}" result="soft"/>` +
  `<feDisplacementMap in="soft" in2="noise" scale="${t.displace}" ` +
  `xChannelSelector="R" yChannelSelector="G" result="shape"/>` +
  `<feColorMatrix in="noise" type="saturate" values="0" result="mono"/>` +
  `<feComponentTransfer in="mono" result="grain">` +
  `<feFuncA type="linear" slope="${t.grainAlpha}"/></feComponentTransfer>` +
  `<feComposite in="grain" in2="shape" operator="in" result="grainClipped"/>` +
  `<feBlend in="shape" in2="grainClipped" mode="overlay"/>` +
  `</filter>`;

export function buildArtSpec(scene: Scene, d: string, frame: Frame): ArtSpec {
  const { params } = scene;

  const background =
    params.background && params.mode !== "knockout"
      ? { ...frame, fill: params.background }
      : null;

  // Resolve the grain filter from the two 0..1 knobs. Edge blur/displacement
  // are muted in knockout mode so the punched-out rectangle keeps clean sides;
  // the grain overlay itself still applies.
  let texture: TextureSpec | null = null;
  if (params.texture && d) {
    const a = clamp01(params.textureAmount);
    const edgeFx = params.mode === "knockout" ? 0 : 1;
    texture = {
      id: "viarna-texture",
      baseFrequency: round(lerp(0.9, 0.25, clamp01(params.textureScale)), 4),
      numOctaves: 2,
      seed: 11,
      blur: round(a * 1.2 * edgeFx, 3),
      displace: round(a * 5 * edgeFx, 3),
      grainAlpha: round(a, 3),
    };
  }
  const filter = texture ? `url(#${texture.id})` : undefined;

  let path: ArtSpec["path"] = null;
  if (d) {
    if (params.mode === "outline") {
      path = {
        d,
        fill: "none",
        stroke: params.color,
        strokeWidth: params.strokeWidth,
        strokeLinejoin: "round",
        filter,
      };
    } else if (params.mode === "knockout") {
      // Solid rectangle with the shape subtracted via the even-odd rule.
      path = {
        d: `${framePathD(frame)} ${d}`,
        fill: params.color,
        fillRule: "evenodd",
        filter,
      };
    } else {
      path = { d, fill: params.color, fillRule: "evenodd", filter };
    }
  }

  return { background, texture, path };
}

/* ------------------------------------------------------------------ */
/* String output (export)                                              */
/* ------------------------------------------------------------------ */

const specToMarkup = (spec: ArtSpec): string => {
  const parts: string[] = [];
  if (spec.texture) {
    parts.push(`<defs>${textureFilterEl(spec.texture)}</defs>`);
  }
  if (spec.background) {
    const b = spec.background;
    parts.push(
      `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(
        b.h,
      )}" fill="${b.fill}"/>`,
    );
  }
  if (spec.path) {
    const p = spec.path;
    const attrs = [`d="${p.d}"`, `fill="${p.fill}"`];
    if (p.fillRule) attrs.push(`fill-rule="${p.fillRule}"`);
    if (p.stroke) attrs.push(`stroke="${p.stroke}"`, `stroke-width="${round(p.strokeWidth ?? 1)}"`);
    if (p.strokeLinejoin) attrs.push(`stroke-linejoin="${p.strokeLinejoin}"`);
    if (p.filter) attrs.push(`filter="${p.filter}"`);
    parts.push(`<path ${attrs.join(" ")}/>`);
  }
  return parts.join("");
};

export interface RenderOptions {
  /** Include a `<?xml?>` declaration (for file downloads). */
  declaration?: boolean;
  /** Crop the document to the shape instead of the full stage. */
  fit?: boolean;
}

/** A complete, standalone SVG document string. */
export function renderSvg(scene: Scene, opts: RenderOptions = {}): string {
  const { loops, d } = computeMetaball(scene);
  const frame = opts.fit ? contentFrame(scene, loops) : stageFrame(scene);
  const inner = specToMarkup(buildArtSpec(scene, d, frame));
  const decl = opts.declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : "";
  const w = round(frame.w);
  const h = round(frame.h);
  return (
    `${decl}<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="${round(frame.x)} ${round(frame.y)} ${w} ${h}" fill="none">${inner}</svg>`
  );
}
