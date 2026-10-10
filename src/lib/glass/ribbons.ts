/**
 * Ribbon bundle geometry for the Glass tab.
 *
 * Each strand follows a travelling sine wave across x that also swings in z
 * (so the bundle crosses over itself in depth), is offset around the main
 * wave by a twisting bundle radius, and is swept with an elliptical cross-
 * section that rolls along its length.
 *
 * The live view evaluates this on the GPU (see `RIBBON_VERTEX` — the mesh only
 * carries (u, angle, strand) per vertex, so animating costs no CPU). The same
 * maths runs on the CPU in `bakeRibbonGeometry` for model export.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import type { GlassShape } from "@/state/glass";

export const SEG = 360; // samples along the length
export const RAD = 28; // samples around the cross-section
export const MAX_STRANDS = 12;

/** Small deterministic PRNG so "variation" is stable for a given seed. */
const rand = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

export interface StrandJitter {
  /** amp, phase, width, thickness multipliers per strand. */
  a: Float32Array; // vec4 × MAX_STRANDS
  /** roll offset, bundle slot angle per strand. */
  b: Float32Array; // vec2 × MAX_STRANDS
}

export function strandJitter(sh: GlassShape): StrandJitter {
  const r = rand(sh.seed * 977 + sh.strands);
  const v = sh.variation;
  const a = new Float32Array(MAX_STRANDS * 4);
  const b = new Float32Array(MAX_STRANDS * 2);
  for (let s = 0; s < MAX_STRANDS; s++) {
    a[s * 4] = 1 + (r() - 0.5) * 0.5 * v;
    a[s * 4 + 1] = (r() - 0.5) * 1.2 * v;
    a[s * 4 + 2] = 1 + (r() - 0.5) * 0.7 * v;
    a[s * 4 + 3] = 1 + (r() - 0.5) * 0.7 * v;
    b[s * 2] = r() * Math.PI * 2;
    b[s * 2 + 1] = (s / sh.strands) * Math.PI * 2 + (r() - 0.5) * v;
  }
  return { a, b };
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
        params[k * 3 + 1] = (j / RAD) * Math.PI * 2;
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
  uniform vec4 uJitA[MAX_STRANDS];
  uniform vec2 uJitB[MAX_STRANDS];
  const float TAU = 6.283185307;

  vec3 ribbonCentre(float u, vec4 ja, vec2 jb) {
    float x = (u - 0.5) * uLength;
    float a = TAU * uWaves * u - uPhase + ja.y;
    float tw = TAU * uTwist * u + jb.y;
    return vec3(
      x,
      uAmp * ja.x * sin(a) + uSpread * cos(tw),
      uAmp * uDepth * 0.6 * cos(a) + uSpread * sin(tw)
    );
  }

  void ribbonSweep(vec3 p, out vec3 outPos, out vec3 outNormal) {
    float u = p.x;
    float ang = p.y;
    int si = int(p.z + 0.5);
    vec4 ja = vec4(1.0);
    vec2 jb = vec2(0.0);
    for (int i = 0; i < MAX_STRANDS; i++) {
      if (i == si) { ja = uJitA[i]; jb = uJitB[i]; }
    }
    float du = 1.0 / ${SEG}.0;
    vec3 C = ribbonCentre(u, ja, jb);
    vec3 T = u >= 1.0 ? C - ribbonCentre(u - du, ja, jb) : ribbonCentre(min(1.0, u + du), ja, jb) - C;
    T = normalize(T);
    vec3 W = normalize(cross(vec3(0.0, 0.0, 1.0), T));
    vec3 H = normalize(cross(T, W));
    float ro = TAU * uRoll * u + jb.x;
    float cr = cos(ro), sr = sin(ro);
    vec3 w = W * cr + H * sr;
    vec3 h = H * cr - W * sr;
    float taper = min(1.0, min(u, 1.0 - u) * 14.0 + 0.25);
    float ww = uWidth * ja.z * taper;
    float hh = uThick * ja.w * taper;
    float ca = cos(ang), sa = sin(ang);
    outPos = C + w * (ww * ca) + h * (hh * sa);
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
    uJitA: j.a,
    uJitB: j.b,
  };
}

const C = new Vector3();
const T = new Vector3();
const W = new Vector3();
const H = new Vector3();
const Z = new Vector3(0, 0, 1);

/** CPU bake of the current frame (real positions + normals) for export. */
export function bakeRibbonGeometry(sh: GlassShape, phase: number): BufferGeometry {
  const j = strandJitter(sh);
  const topo = createRibbonGeometry(sh.strands);
  const params = topo.getAttribute("position").array as Float32Array;
  const n = params.length / 3;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const TAU = Math.PI * 2;

  const centre = (u: number, s: number, out: Vector3) => {
    const x = (u - 0.5) * sh.length;
    const a = TAU * sh.waves * u - phase + j.a[s * 4 + 1];
    const tw = TAU * sh.twist * u + j.b[s * 2 + 1];
    return out.set(
      x,
      sh.amplitude * j.a[s * 4] * Math.sin(a) + sh.spread * Math.cos(tw),
      sh.amplitude * sh.depth * 0.6 * Math.cos(a) + sh.spread * Math.sin(tw),
    );
  };

  const du = 1 / SEG;
  for (let k = 0; k < n; k++) {
    const u = params[k * 3];
    const ang = params[k * 3 + 1];
    const s = Math.round(params[k * 3 + 2]);
    centre(u, s, C);
    if (u >= 1) T.subVectors(C, centre(u - du, s, T));
    else T.subVectors(centre(Math.min(1, u + du), s, T), C);
    T.normalize();
    W.crossVectors(Z, T).normalize();
    H.crossVectors(T, W).normalize();
    const ro = TAU * sh.roll * u + j.b[s * 2];
    const cr = Math.cos(ro);
    const sr = Math.sin(ro);
    const wx = W.x * cr + H.x * sr, wy = W.y * cr + H.y * sr, wz = W.z * cr + H.z * sr;
    const hx = H.x * cr - W.x * sr, hy = H.y * cr - W.y * sr, hz = H.z * cr - W.z * sr;
    const taper = Math.min(1, Math.min(u, 1 - u) * 14 + 0.25);
    const ww = sh.width * j.a[s * 4 + 2] * taper;
    const hh = sh.thickness * j.a[s * 4 + 3] * taper;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    P[k * 3] = C.x + wx * ww * ca + hx * hh * sa;
    P[k * 3 + 1] = C.y + wy * ww * ca + hy * hh * sa;
    P[k * 3 + 2] = C.z + wz * ww * ca + hz * hh * sa;
    let nx = wx * hh * ca + hx * ww * sa;
    let ny = wy * hh * ca + hy * ww * sa;
    let nz = wz * hh * ca + hz * ww * sa;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    N[k * 3] = nx;
    N[k * 3 + 1] = ny;
    N[k * 3 + 2] = nz;
  }
  topo.setAttribute("position", new BufferAttribute(P, 3));
  topo.setAttribute("normal", new BufferAttribute(N, 3));
  topo.computeBoundingSphere();
  return topo;
}
