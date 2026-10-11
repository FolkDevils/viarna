/**
 * Physically based glass for the ribbon tubes.
 *
 * Offline renders of glass (the look we're matching) come from light
 * bouncing around inside the glass. Real-time engines usually fake that; here
 * we can trace it, because every strand is locally an elliptical tube whose
 * frame the vertex shader already knows. Per pixel:
 *
 *  1. Fresnel reflection of the studio off the outer surface.
 *  2. Refract in, then bounce around the cross-section: at each wall the
 *     ray partly exits (refracted, Fresnel-weighted) and partly reflects —
 *     or totally internally reflects. Those bounces make the bright and dark
 *     streaks along real glass tubes, and the saturated edges.
 *  3. Beer–Lambert absorption: colour deepens with distance travelled in
 *     the glass, so thin faces stay pale and edges / long paths go deep.
 *  4. Dispersion: red, green and blue trace with slightly different IORs.
 *
 * Light leaving the glass sees the studio (`uEnv`) when heading back toward
 * the viewer, and the stage behind (`uBehind`: backdrop + strands further
 * back, sampled in screen space) when heading away.
 */
import { Color, FrontSide, NormalBlending, ShaderMaterial, Vector2, type IUniform } from "three";
import type { GlassLook } from "@/state/glass";
import { MAX_STRANDS, RIBBON_VERTEX } from "./ribbons";

export type RibbonUniforms = Record<string, IUniform>;

/** One set of sweep uniforms shared by every pass, so they move in lockstep. */
export function createRibbonUniforms(): RibbonUniforms {
  return {
    uLength: { value: 20 },
    uAmp: { value: 1 },
    uWaves: { value: 2 },
    uDepth: { value: 1 },
    uSpread: { value: 0.5 },
    uTwist: { value: 0.5 },
    uWidth: { value: 0.5 },
    uThick: { value: 0.3 },
    uRoll: { value: 0.5 },
    uPhase: { value: 0 },
    uSeparation: { value: 1 },
    uOrganic: { value: 0.5 },
    uSwell: { value: 0.5 },
    uStrands: { value: 1 },
    uSpacing: { value: 1 },
    uMelt: { value: 0.5 },
    uJitA: { value: new Float32Array(MAX_STRANDS * 4) },
    uJitB: { value: new Float32Array(MAX_STRANDS * 4) },
    uJitC: { value: new Float32Array(MAX_STRANDS * 4) },
    uJitD: { value: new Float32Array(MAX_STRANDS * 4) },
  };
}

export const GLSL_COLOR = /* glsl */ `
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 toSRGB(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  // Film-like shoulder: identity below 0.8, then eases into white. Very
  // bright light bleeds into the other channels so blown highlights go white
  // instead of clipping to a flat cyan.
  vec3 rolloff(vec3 c) {
    float m = max(c.r, max(c.g, c.b));
    c += max(m - 1.0, 0.0) * 0.3;
    const float k = 0.8;
    vec3 hi = k + (1.0 - k) * (1.0 - exp(-(c - k) / (1.0 - k)));
    return mix(c, hi, step(k, c));
  }
`;

const VERT = /* glsl */ `
  ${RIBBON_VERTEX}
  varying vec3 vM;
  varying vec3 vP;
  varying vec3 vN;
  varying vec3 vC;
  varying vec3 vW;
  varying vec3 vH;
  varying vec2 vR;
  varying vec2 vUv;
  varying float vStrand;
  void main() {
    vec3 pos, nrm, cen, w, h;
    vec2 rad;
    ribbonSweep(position, pos, nrm, cen, w, h, rad);
    vStrand = position.z;
    vM = pos;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    mat3 rot = mat3(modelViewMatrix);
    vP = mv.xyz;
    vN = normalize(normalMatrix * nrm);
    vC = (modelViewMatrix * vec4(cen, 1.0)).xyz;
    vW = rot * w;
    vH = rot * h;
    vR = rad;
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uBehind;
  uniform sampler2D uFull;
  uniform sampler2D uIds;
  uniform sampler2D uFront;
  uniform samplerCube uEnv;
  uniform vec2 uRes;
  uniform mat4 uProj;
  uniform vec3 uColor;
  uniform float uDensity;
  uniform float uBounceTint;
  uniform float uIor;
  uniform float uDispersion;
  uniform float uReflect;
  uniform float uSheen;
  uniform float uDistort;
  uniform float uPixel; // ~1.5 px in world units per unit of view distance
  ${RIBBON_VERTEX}
  varying vec3 vM;
  varying vec3 vP;
  varying vec3 vN;
  varying vec3 vC;
  varying vec3 vW;
  varying vec3 vH;
  varying vec2 vR;
  varying vec2 vUv;
  varying float vStrand;

  ${GLSL_COLOR}

  // Local tube frame (view space): columns = cross-section axes + length.
  mat3 gF;
  vec3 gC;
  vec2 gR;
  vec3 gTint;

  // Transmittance after travelling L with nb internal reflections. Distance
  // tints like Beer–Lambert; each reflection tints too (as a coloured Glass
  // BSDF does offline), which is why light that bounced around comes out
  // saturated while light passing straight through stays pale. Full glass
  // colour at k = 1; past that it only darkens, keeping the hue — Viarna
  // Blue deepens toward Deep Blue instead of drifting violet.
  vec3 absorb(float L, float nb) {
    float k = L * uDensity + nb * uBounceTint;
    return k <= 1.0 ? pow(gTint, vec3(k)) : gTint * exp(-0.8 * (k - 1.0));
  }

  float fresnel(float cosi, float eta) {
    float s2 = eta * eta * (1.0 - cosi * cosi);
    if (s2 >= 1.0) return 1.0;
    float cost = sqrt(1.0 - s2);
    float rs = (eta * cosi - cost) / (eta * cosi + cost);
    float rp = (cosi - eta * cost) / (cosi + eta * cost);
    return 0.5 * (rs * rs + rp * rp);
  }

  vec3 studio(vec3 dirV, float blur) {
    vec3 world = (vec4(dirV, 0.0) * viewMatrix).xyz;
    return textureLod(uEnv, world, blur).rgb;
  }

  // What light leaving the glass at posV along dirV ends up showing. Light
  // from inside (blur > 0) sees the studio a little soft: the real tube's
  // curves smear it, where the straight-tube trace would image it sharply.
  vec3 sceneAt(vec3 posV, vec3 dirV, float blur) {
    vec3 env = studio(dirV, blur);
    float away = smoothstep(0.0, 0.55, -dirV.z);
    if (away <= 0.0) return env;
    vec4 clip = uProj * vec4(posV + dirV * uDistort, 1.0);
    vec2 uv = clamp(clip.xy / clip.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
    #ifdef LAYERED
      // Whatever is nearest there — unless that's this strand, in which
      // case look past it to the layer behind.
      float id = texture(uIds, uv).r * 255.0 - 1.0;
      vec3 behind = abs(id - vStrand) < 0.5 ? texture(uBehind, uv).rgb : texture(uFull, uv).rgb;
    #else
      vec3 behind = texture(uBehind, uv).rgb;
    #endif
    return mix(env, behind, away);
  }

  const float INNER_BLUR = 2.5;

  vec3 toView(vec3 p) { return gC + gF * p; }

  // p sits on the wall, d points inward. Bounce around the ellipse.
  vec3 traceInside(float ior, vec3 p, vec3 d) {
    float energy = 1.0; // Fresnel share still inside
    float L = 0.0;      // path length so far
    vec3 acc = vec3(0.0);
    vec2 r2 = gR * gR;
    // The real tube bends away within a few radii, so a ray aimed down its
    // length meets a wall long before a straight tube would say.
    float maxRun = 3.0 * max(gR.x, gR.y);
    for (int i = 0; i < BOUNCES; i++) {
      // In ellipse-normalised coords p is on the unit circle, so the far
      // hit is the non-zero root of |O + tD|² = 1.
      vec2 O = p.xy / gR;
      vec2 D = d.xy / gR;
      float dd = dot(D, D);
      float od = dot(O, D);
      float tRaw = (od < 0.0 && dd > 1e-6) ? -2.0 * od / dd : 1e4;
      float t = min(tRaw, maxRun);
      L += t;
      // Long runs leave through the bend instead of reaching a wall — after
      // more bouncing round the curve, so dimmer, deeper and diffuse. Faded
      // in so there's no hard edge where the cutoff kicks in.
      float leak = smoothstep(0.45, 1.0, tRaw / maxRun);
      float nb = float(i);
      if (leak > 0.0) acc += energy * leak * absorb(L + maxRun, nb + 2.0) * studio(gF * d, 5.0);
      energy *= 1.0 - leak;
      if (energy < 0.003) return acc;
      p += d * t;
      p.xy /= max(length(p.xy / gR), 1e-4);
      vec3 n = normalize(vec3(p.xy / r2, 0.0));
      float F = fresnel(clamp(dot(d, n), 0.0, 1.0), ior);
      if (F < 1.0) acc += energy * (1.0 - F) * absorb(L, nb) * sceneAt(toView(p), gF * refract(d, -n, ior), INNER_BLUR);
      energy *= F;
      d = reflect(d, n);
    }
    // Whatever is still trapped leaves roughly where it's heading.
    return acc + energy * absorb(L, float(BOUNCES)) * sceneAt(toView(p), gF * d, INNER_BLUR);
  }

  vec3 body(float ior, vec3 p, vec3 dl, vec3 nl) {
    float F = fresnel(-dot(dl, nl), 1.0 / ior);
    return (1.0 - F) * traceInside(ior, p, refract(dl, nl, 1.0 / ior));
  }

  void main() {
    float fade = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
    if (fade < 0.004) discard;
    #ifdef PEEL
      // Second layer only: skip whatever is nearest to the camera.
      if (gl_FragCoord.z <= texture(uFront, gl_FragCoord.xy / uRes).r + 2e-5) discard;
    #endif
    vec3 meltN;
    float meltW, cover;
    if (!ribbonMelt(vM, int(vStrand + 0.5), uPixel * length(vP), meltN, meltW, cover)) discard;
    #ifndef LAYERED
      // Offscreen helpers have no multisampling: cut at the crease itself.
      if (cover < 0.5) discard;
    #endif

    vec3 W = normalize(vW);
    vec3 H = normalize(vH - W * dot(vH, W));
    gF = mat3(W, H, cross(W, H));
    gC = vC;
    gR = max(vR, vec2(1e-3));
    gTint = clamp(uColor, 0.02, 1.0);

    mat3 toLocal = transpose(gF);
    vec3 dv = normalize(vP);
    vec3 dl = toLocal * dv;
    vec3 p = toLocal * (vP - vC);
    p.xy /= max(length(p.xy / gR), 1e-4);
    vec3 nl = normalize(vec3(p.xy / (gR * gR), 0.0));
    // The ribbon has no transform, so model space is world space.
    if (meltW > 0.0) nl = normalize(mix(nl, toLocal * (mat3(viewMatrix) * meltN), meltW));
    // Tessellation can leave the analytic normal facing slightly away right
    // at the silhouette; tip it back toward the eye.
    float facing = dot(dl, nl);
    if (facing > -0.02) nl = normalize(nl - dl * (facing + 0.02));
    float cosi = -dot(dl, nl);

    vec3 nv = gF * nl;
    float F0 = fresnel(cosi, 1.0 / uIor);
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + cosi * 1.4 + vUv.x * 1.5));
    vec3 col = sceneAt(vP, reflect(dv, nv), 0.5) * F0 * uReflect * mix(vec3(1.0), 0.35 + 1.3 * film, uSheen);

    if (uDispersion > 0.001) {
      float s = uDispersion * 0.06;
      col += vec3(body(uIor - s, p, dl, nl).r, body(uIor, p, dl, nl).g, body(uIor + s, p, dl, nl).b);
    } else {
      col += body(uIor, p, dl, nl);
    }

    #ifdef LAYERED
      gl_FragColor = vec4(toSRGB(rolloff(col)), fade * cover);
    #else
      gl_FragColor = vec4(col, fade);
    #endif
  }
`;

/**
 * - `front`: the nearest glass, to screen (tone-shaped, sRGB). Sees the
 *   other strands through the `full`/`peel` buffers.
 * - `full`: every strand's nearest surface, cheaply, into a linear buffer.
 * - `peel`: the second-nearest surface, cheaply, into a linear buffer.
 */
export type GlassPass = "front" | "full" | "peel";

const DEFINES: Record<GlassPass, Record<string, string | number>> = {
  front: { LAYERED: "", BOUNCES: 5 },
  full: { BOUNCES: 2 },
  peel: { PEEL: "", BOUNCES: 2 },
};

export function createGlassMaterial(ribbon: RibbonUniforms, pass: GlassPass): ShaderMaterial {
  return new ShaderMaterial({
    defines: DEFINES[pass],
    // Antialiases the cut where strands melt together (the on-screen pass
    // is the only multisampled one).
    alphaToCoverage: pass === "front",
    transparent: true,
    depthWrite: true,
    side: FrontSide,
    blending: NormalBlending,
    uniforms: {
      ...ribbon,
      uBehind: { value: null },
      uFull: { value: null },
      uIds: { value: null },
      uFront: { value: null },
      uEnv: { value: null },
      uRes: { value: new Vector2(1, 1) },
      uProj: { value: null },
      uColor: { value: new Color() },
      uDensity: { value: 0.12 },
      uBounceTint: { value: 0.3 },
      uIor: { value: 1.5 },
      uDispersion: { value: 0.3 },
      uReflect: { value: 1 },
      uSheen: { value: 0.2 },
      uDistort: { value: 2 },
      uPixel: { value: 0.001 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/** Nearest glass surface per pixel: depth, plus which strand it is (id + 1). */
export function createIdMaterial(ribbon: RibbonUniforms): ShaderMaterial {
  return new ShaderMaterial({
    side: FrontSide,
    uniforms: { ...ribbon },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      ${RIBBON_VERTEX}
      varying vec3 vM;
      varying vec2 vUv;
      varying float vStrand;
      void main() {
        float fade = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
        if (fade < 0.004) discard;
        vec3 meltN;
        float meltW, cover;
        if (!ribbonMelt(vM, int(vStrand + 0.5), 1e-4, meltN, meltW, cover) || cover < 0.5) discard;
        gl_FragColor = vec4((vStrand + 1.0) / 255.0, 0.0, 0.0, 1.0);
      }
    `,
  });
}

export function applyGlassLook(m: ShaderMaterial, l: GlassLook) {
  const u = m.uniforms;
  (u.uColor.value as Color).set(l.color);
  u.uDensity.value = l.density;
  u.uBounceTint.value = l.bounceTint;
  u.uIor.value = l.ior;
  u.uDispersion.value = l.dispersion;
  u.uReflect.value = l.reflection;
  u.uSheen.value = l.sheen;
  u.uDistort.value = l.distortion;
}
