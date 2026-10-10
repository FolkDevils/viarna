/**
 * Dithered-falloff metaball shader.
 *
 * Profile (measured off the reference renders):
 *   - Circles are fused with an exponential smooth-min of their SDFs, so the
 *     necks form naturally and order doesn't matter.
 *   - Outside → in: a grainy halo ring whose ink density thins toward the
 *     outer edge, then a dark core with an exponential rim→black gradient.
 *   - Grain is mean-preserving: mix(p, step(noise, p), grain). The average
 *     tone equals the smooth falloff; grain only adds the speckle.
 */
export const MAX_BLOBS = 24;

export const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `
precision highp float;
#define MAX_BLOBS ${MAX_BLOBS}

uniform vec2  uRes;        // device px
uniform float uScale;      // device px per logical px
uniform int   uCount;
uniform vec3  uBlobs[MAX_BLOBS]; // x, y (logical, centred, y-down), r

uniform float uK;          // smooth-union radius
uniform float uHalo;       // halo ring width
uniform float uFade;       // halo thinning toward outer edge
uniform float uFall;       // core gradient length
uniform float uEdge;       // outer edge softness
uniform float uCoreEdge;   // core edge softness
uniform float uGrain;      // 0..1
uniform float uGrainSize;  // device px
uniform float uSeed;

uniform vec3  uBg;        // backdrop start / centre
uniform vec3  uBg2;       // backdrop end / edge
uniform int   uBgType;    // 0 solid, 1 linear, 2 radial
uniform float uBgAngle;   // radians, CSS convention
uniform vec3 uHaloCol;
uniform vec3 uRim;
uniform vec3 uCore;
uniform int  uTransparent; // 1 = no backdrop, premultiplied alpha out

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smoothly interpolated value noise at uGrainSize device px, contrast-
// restored toward a uniform spread so the dither keeps its average tone.
// Sub-2px cells give the soft, clumpy film grain of the reference.
float grainNoise(vec2 fc, vec2 off) {
  vec2 q = fc / uGrainSize + off;
  vec2 i = floor(q);
  vec2 f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float v = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return clamp((v - 0.5) * 1.6 + 0.5, 0.002, 0.998);
}

float dither(float p, float n) {
  return mix(p, p > n ? 1.0 : 0.0, uGrain);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = (frag - 0.5 * uRes) / uScale;

  // Exponential smooth-min over all circle SDFs (stable form).
  float m = 1e9;
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= uCount) break;
    vec3 b = uBlobs[i];
    m = min(m, length(p - b.xy) - b.z);
  }
  float D = m;
  if (uK > 0.001 && uCount > 0) {
    float s = 0.0;
    for (int i = 0; i < MAX_BLOBS; i++) {
      if (i >= uCount) break;
      vec3 b = uBlobs[i];
      float d = length(p - b.xy) - b.z;
      s += exp(-(d - m) / uK);
    }
    D = m - uK * log(s);
  }

  // Never go sharper than ~1 device pixel (anti-aliasing floor).
  float px = 1.0 / uScale;
  float edge = max(uEdge, 0.75 * px);
  float cEdge = max(uCoreEdge, 0.75 * px);

  float n1 = grainNoise(gl_FragCoord.xy, vec2(uSeed));
  float n2 = grainNoise(gl_FragCoord.xy, vec2(uSeed) + vec2(91.7, 37.3));

  // Backdrop — same maths as the CSS gradients used by the 2D/3D tabs.
  vec3 col = uBg;
  vec2 c = frag - 0.5 * uRes;
  if (uBgType == 1) {
    vec2 dir = vec2(sin(uBgAngle), -cos(uBgAngle));
    float len = abs(uRes.x * sin(uBgAngle)) + abs(uRes.y * cos(uBgAngle));
    col = mix(uBg, uBg2, clamp(dot(c, dir) / len + 0.5, 0.0, 1.0));
  } else if (uBgType == 2) {
    col = mix(uBg, uBg2, clamp(length(c) / length(0.5 * uRes), 0.0, 1.0));
  }

  // Halo ring: ink density thins from the core edge to the outer edge.
  if (uHalo > 0.0) {
    float outer = 1.0 - smoothstep(-edge, edge, D);
    float t = clamp((D + uHalo) / uHalo, 0.0, 1.0);
    float thin = mix(0.08, uFade, pow(t, 1.6));
    // Grain lives inside the ring; the silhouette edge stays smooth.
    float hp = outer * dither(1.0 - thin, n1);
    col = mix(col, uHaloCol, hp);
  }

  // Dark core with rim→core exponential gradient.
  float dc = D + uHalo;
  float coreCov = 1.0 - smoothstep(-cEdge, cEdge, dc);
  float cp = dither(coreCov, n2);
  float g = exp(-max(-dc, 0.0) / uFall);
  vec3 coreCol = mix(uCore, uRim, g);
  col = mix(col, coreCol, cp);

  if (uTransparent == 1) {
    // Same layering, composited over nothing (premultiplied).
    float hp = 0.0;
    if (uHalo > 0.0) {
      float outer = 1.0 - smoothstep(-edge, edge, D);
      float t = clamp((D + uHalo) / uHalo, 0.0, 1.0);
      hp = outer * dither(1.0 - mix(0.08, uFade, pow(t, 1.6)), n1);
    }
    vec3 pc = uHaloCol * hp;
    float pa = hp;
    pc = coreCol * cp + pc * (1.0 - cp);
    pa = cp + pa * (1.0 - cp);
    gl_FragColor = vec4(pc, pa);
    return;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
