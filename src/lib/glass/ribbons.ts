/**
 * Ribbon bundle geometry for the Glass tab.
 *
 * Every strand is its own organic wave rather than a copy of one curve:
 *  - its own wave count, height, depth swing and phase,
 *  - its own speed (whole-number multiples of the base flow, so a video of
 *    one flow cycle still loops seamlessly),
 *  - a second harmonic plus a slow domain warp along the length so the
 *    curve isn't a perfect sine,
 *  - width and thickness that swell and pinch along the length (and breathe
 *    over time) independently of each other,
 *  - a place in a vertical/depth fan ("separation") so strands spread out
 *    instead of stacking, optionally wound around each other ("bundle").
 *
 * The live view evaluates this on the GPU (`RIBBON_VERTEX`; the mesh only
 * carries (u, angle, strand) per vertex). `bakeRibbonGeometry` runs the same
 * maths on the CPU for model export — keep the two in lockstep.
 */
import { BufferAttribute, BufferGeometry } from "three";
import type { GlassShape } from "@/state/glass";

export const SEG = 640; // samples along the length
export const RAD = 40; // samples around the cross-section
export const MAX_STRANDS = 12;
const TAU = Math.PI * 2;

/** Small deterministic PRNG so "variation" is stable for a given seed. */
const rand = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/**
 * Per-strand personality, packed as 4 × vec4 per strand:
 *  A: amp×, phase, width×, thickness×
 *  B: roll offset, bundle slot, waves×, depth×
 *  C: harmonic freq, harmonic phase, speed k (integer), swell freq
 *  D: swell phase, fan y (-1..1), fan z (-1..1), warp freq
 */
export interface StrandJitter {
  A: Float32Array;
  B: Float32Array;
  C: Float32Array;
  D: Float32Array;
}

export function strandJitter(sh: GlassShape): StrandJitter {
  const r = rand(sh.seed * 977 + sh.strands);
  const v = sh.variation;
  const n = sh.strands;
  const A = new Float32Array(MAX_STRANDS * 4);
  const B = new Float32Array(MAX_STRANDS * 4);
  const C = new Float32Array(MAX_STRANDS * 4);
  const D = new Float32Array(MAX_STRANDS * 4);
  // Shuffle fan positions so neighbours in the fan aren't neighbours in
  // phase — avoids a tidy "staircase".
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let s = 0; s < MAX_STRANDS; s++) {
    const i = s * 4;
    A[i] = 1 + (r() - 0.5) * 0.9 * v;
    A[i + 1] = (r() - 0.5) * Math.PI * v;
    A[i + 2] = 1 + (r() - 0.5) * 1.1 * v;
    A[i + 3] = 1 + (r() - 0.5) * 1.1 * v;
    B[i] = r() * TAU;
    B[i + 1] = (s / n) * TAU + (r() - 0.5) * v;
    B[i + 2] = 1 + (r() - 0.5) * 0.35 * v;
    B[i + 3] = 1 + (r() - 0.5) * 1.2 * v;
    C[i] = 1.5 + r() * 3;
    C[i + 1] = r() * TAU;
    C[i + 2] = 1 + Math.floor(r() * (1 + 2 * v)); // 1..3
    C[i + 3] = 0.6 + r() * 1.6;
    D[i] = r() * TAU;
    const fan = n > 1 ? (order[s % n] / (n - 1)) * 2 - 1 : 0;
    D[i + 1] = fan + (r() - 0.5) * 0.35 * v;
    D[i + 2] = (r() - 0.5) * 2;
    D[i + 3] = 0.4 + r() * 0.9;
  }
  return { A, B, C, D };
}

/** Static mesh topology: per-vertex (u along, angle around, strand). */
export function createRibbonGeometry(strands: number): BufferGeometry {
  const g = new BufferGeometry();
  const verts = strands * (SEG + 1) * (RAD + 1);
  const params = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const idx: number[] = [];
  for (let s = 0; s < strands; s++) {
    const base = s * (SEG + 1) * (RAD + 1);
    for (let i = 0; i <= SEG; i++) {
      for (let j = 0; j <= RAD; j++) {
        const k = base + i * (RAD + 1) + j;
        params[k * 3] = i / SEG;
        // Pack samples toward the ribbon's sharp edges (a = 0, π) where a
        // flat ellipse curves fastest — keeps the silhouette smooth.
        const a = (j / RAD) * TAU;
        params[k * 3 + 1] = a - 0.4 * Math.sin(2 * a);
        params[k * 3 + 2] = s;
        uv[k * 2] = i / SEG;
        uv[k * 2 + 1] = j / RAD;
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = base + i * (RAD + 1) + j;
        const b = a + RAD + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  // `position` holds the params (three requires a position attribute); the
  // vertex shader decodes them.
  g.setAttribute("position", new BufferAttribute(params, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** GLSL for the ribbon sweep — mirrors `bakeRibbonGeometry` exactly. */
export const RIBBON_VERTEX = /* glsl */ `
  #define MAX_STRANDS ${MAX_STRANDS}
  uniform float uLength, uAmp, uWaves, uDepth, uSpread, uTwist;
  uniform float uWidth, uThick, uRoll, uPhase;
  uniform float uSeparation, uOrganic, uSwell;
  uniform vec4 uJitA[MAX_STRANDS];
  uniform vec4 uJitB[MAX_STRANDS];
  uniform vec4 uJitC[MAX_STRANDS];
  uniform vec4 uJitD[MAX_STRANDS];
  const float TAU = 6.283185307;

  vec3 ribbonCentre(float u, vec4 A, vec4 B, vec4 C, vec4 D) {
    float t = uPhase * C.z;
    // Slow domain warp: stretches/compresses the wave along its length.
    float uw = u + uOrganic * 0.035 * sin(TAU * D.w * u + D.x - t);
    float a = TAU * uWaves * B.z * uw - t + A.y;
    float harm = sin(TAU * C.x * uw - t * 2.0 + C.y);
    float tw = TAU * uTwist * u + B.y;
    float x = (u - 0.5) * uLength;
    float y = uAmp * A.x * (sin(a) + uOrganic * 0.35 * harm)
            + uSeparation * D.y + uSpread * cos(tw);
    float z = uAmp * uDepth * B.w * 0.6 * cos(a)
            + uSeparation * 0.5 * D.z + uSpread * sin(tw);
    return vec3(x, y, z);
  }

  void ribbonSweep(vec3 p, out vec3 outPos, out vec3 outNormal) {
    float u = p.x;
    float ang = p.y;
    int si = int(p.z + 0.5);
    vec4 A = vec4(1.0), B = vec4(0.0), C = vec4(1.0), D = vec4(0.0);
    for (int i = 0; i < MAX_STRANDS; i++) {
      if (i == si) { A = uJitA[i]; B = uJitB[i]; C = uJitC[i]; D = uJitD[i]; }
    }
    float du = 1.0 / ${SEG}.0;
    vec3 Cn = ribbonCentre(u, A, B, C, D);
    vec3 T = u >= 1.0 ? Cn - ribbonCentre(u - du, A, B, C, D)
                      : ribbonCentre(min(1.0, u + du), A, B, C, D) - Cn;
    T = normalize(T);
    vec3 W = normalize(cross(vec3(0.0, 0.0, 1.0), T));
    vec3 H = normalize(cross(T, W));
    float ro = TAU * uRoll * u + B.x;
    float cr = cos(ro), sr = sin(ro);
    vec3 w = W * cr + H * sr;
    vec3 h = H * cr - W * sr;
    float t = uPhase * C.z;
    float taper = min(1.0, min(u, 1.0 - u) * 14.0 + 0.25);
    // Swell: width and thickness pinch/bulge along the length, out of step.
    float sw = max(0.25, 1.0 + uSwell * 0.6 * sin(TAU * C.w * u + D.x - t));
    float st = max(0.25, 1.0 + uSwell * 0.6 * sin(TAU * C.w * 1.37 * u + D.x * 2.1 + 1.3 - t));
    float ww = uWidth * A.z * taper * sw;
    float hh = uThick * A.w * taper * st;
    float ca = cos(ang), sa = sin(ang);
    outPos = Cn + w * (ww * ca) + h * (hh * sa);
    outNormal = normalize(w * (hh * ca) + h * (ww * sa));
  }
`;

/** Uniform values for the sweep shader. */
export function ribbonUniformValues(sh: GlassShape, phase: number, j: StrandJitter) {
  return {
    uLength: sh.length,
    uAmp: sh.amplitude,
    uWaves: sh.waves,
    uDepth: sh.depth,
    uSpread: sh.spread,
    uTwist: sh.twist,
    uWidth: sh.width,
    uThick: sh.thickness,
    uRoll: sh.roll,
    uPhase: phase,
    uSeparation: sh.separation,
    uOrganic: sh.organic,
    uSwell: sh.swell,
    uJitA: j.A,
    uJitB: j.B,
    uJitC: j.C,
    uJitD: j.D,
  };
}

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** CPU bake of the current frame (real positions + normals) for export. */
export function bakeRibbonGeometry(sh: GlassShape, phase: number): BufferGeometry {
  const j = strandJitter(sh);
  const topo = createRibbonGeometry(sh.strands);
  const params = topo.getAttribute("position").array as Float32Array;
  const n = params.length / 3;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);

  const centre = (u: number, s: number): V3 => {
    const i = s * 4;
    const t = phase * j.C[i + 2];
    const uw = u + sh.organic * 0.035 * Math.sin(TAU * j.D[i + 3] * u + j.D[i] - t);
    const a = TAU * sh.waves * j.B[i + 2] * uw - t + j.A[i + 1];
    const harm = Math.sin(TAU * j.C[i] * uw - t * 2 + j.C[i + 1]);
    const tw = TAU * sh.twist * u + j.B[i + 1];
    return [
      (u - 0.5) * sh.length,
      sh.amplitude * j.A[i] * (Math.sin(a) + sh.organic * 0.35 * harm) +
        sh.separation * j.D[i + 1] +
        sh.spread * Math.cos(tw),
      sh.amplitude * sh.depth * j.B[i + 3] * 0.6 * Math.cos(a) +
        sh.separation * 0.5 * j.D[i + 2] +
        sh.spread * Math.sin(tw),
    ];
  };

  const du = 1 / SEG;
  for (let k = 0; k < n; k++) {
    const u = params[k * 3];
    const ang = params[k * 3 + 1];
    const s = Math.round(params[k * 3 + 2]);
    const i = s * 4;
    const C = centre(u, s);
    let T: V3;
    if (u >= 1) {
      const p = centre(u - du, s);
      T = [C[0] - p[0], C[1] - p[1], C[2] - p[2]];
    } else {
      const q = centre(Math.min(1, u + du), s);
      T = [q[0] - C[0], q[1] - C[1], q[2] - C[2]];
    }
    T = norm(T);
    const W = norm(cross([0, 0, 1], T));
    const H = norm(cross(T, W));
    const ro = TAU * sh.roll * u + j.B[i];
    const cr = Math.cos(ro);
    const sr = Math.sin(ro);
    const w: V3 = [W[0] * cr + H[0] * sr, W[1] * cr + H[1] * sr, W[2] * cr + H[2] * sr];
    const h: V3 = [H[0] * cr - W[0] * sr, H[1] * cr - W[1] * sr, H[2] * cr - W[2] * sr];
    const t = phase * j.C[i + 2];
    const taper = Math.min(1, Math.min(u, 1 - u) * 14 + 0.25);
    const sw = Math.max(0.25, 1 + sh.swell * 0.6 * Math.sin(TAU * j.C[i + 3] * u + j.D[i] - t));
    const st = Math.max(
      0.25,
      1 + sh.swell * 0.6 * Math.sin(TAU * j.C[i + 3] * 1.37 * u + j.D[i] * 2.1 + 1.3 - t),
    );
    const ww = sh.width * j.A[i + 2] * taper * sw;
    const hh = sh.thickness * j.A[i + 3] * taper * st;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let c = 0; c < 3; c++) P[k * 3 + c] = C[c] + w[c] * ww * ca + h[c] * hh * sa;
    const nn = norm([
      w[0] * hh * ca + h[0] * ww * sa,
      w[1] * hh * ca + h[1] * ww * sa,
      w[2] * hh * ca + h[2] * ww * sa,
    ]);
    N[k * 3] = nn[0];
    N[k * 3 + 1] = nn[1];
    N[k * 3 + 2] = nn[2];
  }
  topo.setAttribute("position", new BufferAttribute(P, 3));
  topo.setAttribute("normal", new BufferAttribute(N, 3));
  topo.computeBoundingSphere();
  return topo;
}
