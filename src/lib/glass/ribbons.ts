/**
 * Ribbon bundle geometry for the Glass tab.
 *
 * Solid glass strands can't pass through each other, so the bundle is built
 * in lanes:
 *  - one shared spine carries the wave (height, count, depth swing), with a
 *    second harmonic and a slow warp so it isn't a perfect sine,
 *  - each strand circles the spine in its own evenly spaced lane, far enough
 *    out (`laneAt`) that neighbours never touch; the bundle twist makes them
 *    weave over and under each other,
 *  - each strand drifts outward and back on its own rhythm, at its own speed
 *    (whole-number multiples of the base flow, so a video of one flow cycle
 *    still loops seamlessly),
 *  - width and thickness swell and pinch along the length (and breathe over
 *    time) independently of each other.
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
 *  A: drift×, –, width×, thickness×
 *  B: roll offset, lane angle, –, –
 *  C: –, –, speed k (integer), swell freq
 *  D: swell/drift phase, –, –, drift freq
 * The – slots are unused but still drawn, so a seed keeps giving the same
 * strand widths and rhythms.
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
    // Lanes must stay evenly spaced for `laneAt` to keep them apart.
    B[i + 1] = (s / n) * TAU;
    r();
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
    // Counter-clockwise seen from outside, so FrontSide is the outer wall.
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = base + i * (RAD + 1) + j;
        const b = a + RAD + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
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
  uniform int uStrands;
  uniform vec4 uJitA[MAX_STRANDS];
  uniform vec4 uJitB[MAX_STRANDS];
  uniform vec4 uJitC[MAX_STRANDS];
  uniform vec4 uJitD[MAX_STRANDS];
  const float TAU = 6.283185307;

  vec3 ribbonSpine(float u) {
    // Slow domain warp: stretches/compresses the wave along its length.
    float uw = u + uOrganic * 0.035 * sin(TAU * 0.7 * u + 1.1 - uPhase);
    float a = TAU * uWaves * uw - uPhase;
    float harm = sin(TAU * 2.7 * uw - uPhase * 2.0 + 0.6);
    return vec3((u - 0.5) * uLength,
                uAmp * (sin(a) + uOrganic * 0.35 * harm),
                uAmp * uDepth * 0.6 * cos(a));
  }

  // Cross-section radii (width, thickness): taper at the ends, and swell —
  // width and thickness pinch/bulge along the length, out of step.
  vec2 ribbonRadii(float u, vec4 A, vec4 C, vec4 D) {
    float t = uPhase * C.z;
    // Linear taper from the tips, rounded into full size (a hard cap would
    // kink the lanes, which follow the radii).
    float e = min(u, 1.0 - u) * 14.0 + 0.25;
    float g = max(0.3 - abs(e - 1.0), 0.0) / 0.3;
    float taper = min(e, 1.0) - g * g * 0.075;
    float sw = max(0.25, 1.0 + uSwell * 0.6 * sin(TAU * C.w * u + D.x - t));
    float st = max(0.25, 1.0 + uSwell * 0.6 * sin(TAU * C.w * 1.37 * u + D.x * 2.1 + 1.3 - t));
    return vec2(uWidth * A.z * taper * sw, uThick * A.w * taper * st);
  }

  // How far out the lanes sit at u so neighbours never touch: the fattest
  // pair of strands there must fit between evenly spaced lanes, measured
  // across the strands' helical tilt. Norms stand in for max() (8 for each
  // strand's width vs thickness, 16 across pairs) so the lanes breathe
  // smoothly with the swell instead of kinking where the largest switches.
  float laneAt(float u) {
    if (uStrands < 2) return 0.0;
    float rad[MAX_STRANDS];
    float top = 0.0;
    for (int s = 0; s < MAX_STRANDS; s++) {
      if (s >= uStrands) break;
      vec2 r = ribbonRadii(u, uJitA[s], uJitC[s], uJitD[s]);
      rad[s] = pow(pow(r.x, 8.0) + pow(r.y, 8.0), 0.125);
      top = max(top, rad[s]);
    }
    float acc = 0.0;
    for (int a = 0; a < MAX_STRANDS; a++) {
      if (a >= uStrands) break;
      for (int b = a + 1; b < MAX_STRANDS; b++) {
        if (b >= uStrands) break;
        acc += pow((rad[a] + rad[b]) / (2.0 * top), 16.0);
      }
    }
    float snug = 2.0 * top * pow(acc, 1.0 / 16.0) / (2.0 * sin(3.14159265 / float(uStrands)));
    float k = TAU * uTwist / uLength;
    return 1.05 * snug / sqrt(max(0.2, 1.0 - snug * snug * k * k));
  }

  // Separation stretches the lanes vertically and drift only moves a strand
  // outward — both keep neighbours at least as far apart as laneAt allows.
  vec3 ribbonCentre(float u, vec4 A, vec4 B, vec4 C, vec4 D) {
    vec3 c = ribbonSpine(u);
    vec3 T = normalize(ribbonSpine(u + 1.0 / ${SEG}.0) - c);
    vec3 W = normalize(cross(vec3(0.0, 0.0, 1.0), T));
    vec3 H = cross(T, W);
    float t = uPhase * C.z;
    float drift = uOrganic * 0.35 * uAmp * A.x * (0.5 + 0.5 * sin(TAU * D.w * u + D.x - t));
    float r = laneAt(u) + uSpread + drift;
    float th = TAU * uTwist * u + B.y;
    return c + r * (cos(th) * (1.0 + uSeparation) * W + sin(th) * H);
  }

  // Besides the surface point and normal, hands back the local tube frame:
  // centre, the two cross-section axes and their radii — the glass shader
  // traces rays through that ellipse.
  void ribbonSweep(vec3 p, out vec3 outPos, out vec3 outNormal,
                   out vec3 outCentre, out vec3 outW, out vec3 outH, out vec2 outRadii) {
    float u = p.x;
    float ang = p.y;
    int si = int(p.z + 0.5);
    vec4 A = uJitA[si], B = uJitB[si], C = uJitC[si], D = uJitD[si];
    float du = 1.0 / ${SEG}.0;
    vec3 Cn = ribbonCentre(u, A, B, C, D);
    vec3 T = u >= 1.0 ? Cn - ribbonCentre(u - du, A, B, C, D)
                      : ribbonCentre(min(1.0, u + du), A, B, C, D) - Cn;
    T = normalize(T);
    // Orient the cross-section by the strand's lane (spine → strand), which
    // turns smoothly with the twist; a fixed world axis flips wherever a
    // strand heads toward the camera.
    vec3 toLane = Cn - ribbonSpine(u);
    toLane -= T * dot(toLane, T);
    vec3 W = length(toLane) > 1e-3 ? normalize(toLane) : normalize(cross(vec3(0.0, 0.0, 1.0), T));
    vec3 H = normalize(cross(T, W));
    float ro = TAU * uRoll * u + B.x;
    float cr = cos(ro), sr = sin(ro);
    vec3 w = W * cr + H * sr;
    vec3 h = H * cr - W * sr;
    vec2 rr = ribbonRadii(u, A, C, D);
    float ww = rr.x, hh = rr.y;
    // Lanes on the inside of a spine bend curve tighter than the spine. A
    // tube fatter than its bend radius would fold through itself, so slim it
    // there (measured toward the bend).
    float hs = 3.0 * du;
    float uc = clamp(u, hs, 1.0 - hs);
    vec3 Cm = ribbonCentre(uc, A, B, C, D);
    vec3 a0 = Cm - ribbonCentre(uc - hs, A, B, C, D);
    vec3 a1 = ribbonCentre(uc + hs, A, B, C, D) - Cm;
    vec3 bend = normalize(a1) - normalize(a0);
    float kappa = length(bend) / (0.5 * (length(a0) + length(a1)));
    if (kappa > 1e-4) {
      vec3 N = bend / length(bend);
      float reach = length(vec2(ww * dot(N, w), hh * dot(N, h)));
      float fit = min(1.0, 0.85 / (kappa * max(reach, 1e-4)));
      ww *= fit;
      hh *= fit;
    }
    float ca = cos(ang), sa = sin(ang);
    outPos = Cn + w * (ww * ca) + h * (hh * sa);
    outNormal = normalize(w * (hh * ca) + h * (ww * sa));
    outCentre = Cn;
    outW = w;
    outH = h;
    outRadii = vec2(ww, hh);
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
    uStrands: sh.strands,
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

/** CPU copy of the shader's centreline and radii for one frame. */
function sweep(sh: GlassShape, phase: number, j: StrandJitter) {
  const laneAt = (u: number) => {
    const ns = sh.strands;
    if (ns < 2) return 0;
    const rad = Array.from({ length: ns }, (_, s) => {
      const [rw, rh] = radii(u, s);
      return (rw ** 8 + rh ** 8) ** 0.125;
    });
    const top = Math.max(...rad);
    let acc = 0;
    for (let a = 0; a < ns; a++) for (let b = a + 1; b < ns; b++) acc += ((rad[a] + rad[b]) / (2 * top)) ** 16;
    const snug = (2 * top * acc ** (1 / 16)) / (2 * Math.sin(Math.PI / ns));
    const k = (TAU * sh.twist) / sh.length;
    return (1.05 * snug) / Math.sqrt(Math.max(0.2, 1 - snug * snug * k * k));
  };
  const spine = (u: number): V3 => {
    const uw = u + sh.organic * 0.035 * Math.sin(TAU * 0.7 * u + 1.1 - phase);
    const a = TAU * sh.waves * uw - phase;
    const harm = Math.sin(TAU * 2.7 * uw - phase * 2 + 0.6);
    return [
      (u - 0.5) * sh.length,
      sh.amplitude * (Math.sin(a) + sh.organic * 0.35 * harm),
      sh.amplitude * sh.depth * 0.6 * Math.cos(a),
    ];
  };
  const centre = (u: number, s: number): V3 => {
    const i = s * 4;
    const c = spine(u);
    const q = spine(u + 1 / SEG);
    const T = norm([q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
    const W = norm(cross([0, 0, 1], T));
    const H = cross(T, W);
    const t = phase * j.C[i + 2];
    const drift =
      sh.organic * 0.35 * sh.amplitude * j.A[i] * (0.5 + 0.5 * Math.sin(TAU * j.D[i + 3] * u + j.D[i] - t));
    const r = laneAt(u) + sh.spread + drift;
    const th = TAU * sh.twist * u + j.B[i + 1];
    const ow = Math.cos(th) * (1 + sh.separation) * r;
    const oh = Math.sin(th) * r;
    return [c[0] + ow * W[0] + oh * H[0], c[1] + ow * W[1] + oh * H[1], c[2] + ow * W[2] + oh * H[2]];
  };
  const radii = (u: number, s: number): [number, number] => {
    const i = s * 4;
    const t = phase * j.C[i + 2];
    const e = Math.min(u, 1 - u) * 14 + 0.25;
    const g = Math.max(0.3 - Math.abs(e - 1), 0) / 0.3;
    const taper = Math.min(e, 1) - g * g * 0.075;
    const sw = Math.max(0.25, 1 + sh.swell * 0.6 * Math.sin(TAU * j.C[i + 3] * u + j.D[i] - t));
    const st = Math.max(
      0.25,
      1 + sh.swell * 0.6 * Math.sin(TAU * j.C[i + 3] * 1.37 * u + j.D[i] * 2.1 + 1.3 - t),
    );
    return [sh.width * j.A[i + 2] * taper * sw, sh.thickness * j.A[i + 3] * taper * st];
  };
  return { spine, centre, radii };
}

/** How far the bundle reaches above or below its axis, for framing. */
export function ribbonHalfHeight(sh: GlassShape, phase: number): number {
  const { centre, radii } = sweep(sh, phase, strandJitter(sh));
  let half = 0;
  for (let s = 0; s < sh.strands; s++) {
    for (let k = 0; k <= 128; k++) {
      const u = k / 128;
      half = Math.max(half, Math.abs(centre(u, s)[1]) + Math.max(...radii(u, s)));
    }
  }
  return half;
}

/** CPU bake of the current frame (real positions + normals) for export. */
export function bakeRibbonGeometry(sh: GlassShape, phase: number): BufferGeometry {
  const j = strandJitter(sh);
  const { spine, centre, radii } = sweep(sh, phase, j);
  const topo = createRibbonGeometry(sh.strands);
  const params = topo.getAttribute("position").array as Float32Array;
  const n = params.length / 3;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);

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
    const sp = spine(u);
    const o: V3 = [C[0] - sp[0], C[1] - sp[1], C[2] - sp[2]];
    const od = o[0] * T[0] + o[1] * T[1] + o[2] * T[2];
    const op: V3 = [o[0] - T[0] * od, o[1] - T[1] * od, o[2] - T[2] * od];
    const W = Math.hypot(...op) > 1e-3 ? norm(op) : norm(cross([0, 0, 1], T));
    const H = norm(cross(T, W));
    const ro = TAU * sh.roll * u + j.B[i];
    const cr = Math.cos(ro);
    const sr = Math.sin(ro);
    const w: V3 = [W[0] * cr + H[0] * sr, W[1] * cr + H[1] * sr, W[2] * cr + H[2] * sr];
    const h: V3 = [H[0] * cr - W[0] * sr, H[1] * cr - W[1] * sr, H[2] * cr - W[2] * sr];
    let [ww, hh] = radii(u, s);
    const hs = 3 * du;
    const uc = Math.min(1 - hs, Math.max(hs, u));
    const cm = centre(uc, s);
    const cp = centre(uc - hs, s);
    const cq = centre(uc + hs, s);
    const a0: V3 = [cm[0] - cp[0], cm[1] - cp[1], cm[2] - cp[2]];
    const a1: V3 = [cq[0] - cm[0], cq[1] - cm[1], cq[2] - cm[2]];
    const n0 = norm(a0);
    const n1 = norm(a1);
    const bend: V3 = [n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]];
    const bl = Math.hypot(...bend);
    const kappa = bl / (0.5 * (Math.hypot(...a0) + Math.hypot(...a1)));
    if (kappa > 1e-4) {
      const b: V3 = [bend[0] / bl, bend[1] / bl, bend[2] / bl];
      const dw = b[0] * w[0] + b[1] * w[1] + b[2] * w[2];
      const dh = b[0] * h[0] + b[1] * h[1] + b[2] * h[2];
      const fit = Math.min(1, 0.85 / (kappa * Math.max(Math.hypot(ww * dw, hh * dh), 1e-4)));
      ww *= fit;
      hh *= fit;
    }
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
