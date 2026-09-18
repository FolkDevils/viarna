/**
 * Headless smoke test. Builds via `vite --ssr` (so the `@/` alias and TS
 * resolve exactly like the app) and asserts the core pipeline turns scenes
 * into sane, deterministic SVG in every paint mode — including the linked
 * V shape and the fit-to-content export.
 *
 *   npm run smoke
 */
import { defaultScene } from "@/model/defaults";
import { computeMetaball } from "@/lib/metaball";
import { renderSvg } from "@/lib/svg/serialize";
import { buildField, sampleField, sampleField3 } from "@/lib/field";
import type { RenderMode, Scene } from "@/model/types";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${ok}] ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("Viarna smoke test\n");

// 1. The default V scene (three blobs, two links) fuses into one outline.
const scene = defaultScene();
const { loops, d } = computeMetaball(scene);
check("default scene traces contours", loops.length >= 1, `${loops.length} loop(s)`);
check("path data is non-empty", d.length > 0, `${d.length} chars`);
check("path starts with a move command", d.startsWith("M"));
check("linked V merges into one loop", loops.length === 1, `${loops.length} loop(s)`);

// 2. Every paint mode produces a well-formed <svg>.
for (const mode of ["fill", "outline", "knockout"] as RenderMode[]) {
  const s: Scene = { ...scene, params: { ...scene.params, mode } };
  const svg = renderSvg(s, { declaration: true });
  check(
    `${mode}: valid svg document`,
    svg.startsWith("<?xml") && svg.includes("<svg") && svg.trimEnd().endsWith("</svg>"),
  );
  check(`${mode}: contains a path`, svg.includes("<path"));
}

// 3. Determinism — same scene in, byte-identical SVG out.
check("output is deterministic", renderSvg(scene) === renderSvg(defaultScene()));

// 4. Without links, far-apart blobs at tight goo stay separate.
const apart: Scene = {
  ...scene,
  blobs: [
    { id: "a", x: 120, y: 280, r: 60 },
    { id: "b", x: 360, y: 280, r: 60 },
    { id: "c", x: 600, y: 280, r: 60 },
  ],
  links: [],
  params: { ...scene.params, goo: 0 },
};
check("far apart, no links, tight goo → 3 loops", computeMetaball(apart).loops.length === 3);

// 5. A link keeps even very distant blobs connected at the tightest goo.
const linked: Scene = {
  ...apart,
  blobs: [
    { id: "a", x: 140, y: 280, r: 60 },
    { id: "b", x: 580, y: 280, r: 60 },
  ],
  links: [{ id: "l1", from: "a", to: "b", t: 14 }],
};
check("far blobs with a link stay one loop", computeMetaball(linked).loops.length === 1);

// 5b. A hair-thin neck still renders as one loop (auto-refine catches it).
const thinNeck: Scene = {
  ...linked,
  links: [{ id: "l1", from: "a", to: "b", t: 1 }],
  params: { ...linked.params, goo: 0 },
};
check("hair-thin link still keeps one loop", computeMetaball(thinNeck).loops.length === 1);

// 5c. Texture on: export embeds the grain filter and the shape still paints.
const textured: Scene = {
  ...scene,
  params: { ...scene.params, texture: true, textureAmount: 0.6 },
};
const texSvg = renderSvg(textured, { declaration: true });
check("texture export defines a filter", texSvg.includes("<filter") && texSvg.includes("feTurbulence"));
check("texture export keeps a filtered path", texSvg.includes('filter="url(#'));
check("texture off omits the filter", !renderSvg(scene).includes("feTurbulence"));

// 5d. The 3D view samples the SAME field as 2D. At z = 0 the values must be
// identical, a lone blob must be a true sphere (surface at r in-plane and in
// depth), and a linked neck must survive in 3D.
const loneF = buildField([{ id: "a", x: 300, y: 300, r: 60 }], [], 0.5);
check(
  "3d field at z=0 equals the 2d field",
  Math.abs(sampleField3(345, 312, 0, loneF) - sampleField(345, 312, loneF)) < 1e-9,
);
check(
  "3d: lone blob surface at r in-plane",
  Math.abs(sampleField3(360, 300, 0, loneF) - 1) < 1e-6,
);
check(
  "3d: lone blob surface at r in depth",
  Math.abs(sampleField3(300, 300, 60, loneF) - 1) < 1e-6,
);
const linkedF = buildField(
  [
    { id: "a", x: 140, y: 280, r: 60 },
    { id: "b", x: 580, y: 280, r: 60 },
  ],
  [{ id: "l", from: "a", to: "b", t: 14 }],
  0,
);
check("3d: link neck holds at the midpoint", sampleField3(360, 280, 0, linkedF) >= 1);

// 6. Fit-to-content export crops the document to the shape.
const fitSvg = renderSvg(scene, { fit: true });
check(
  "fit export uses a tight viewBox",
  fitSvg.includes("viewBox=") && !fitSvg.includes(`viewBox="0 0 ${scene.width} ${scene.height}"`),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
