/**
 * Stylised glass for ribbons on a light backdrop.
 *
 * Real transmission on a white background reads as "nothing", so this is a
 * look-dev shader built from what the references actually show:
 *  - face-on the glass is nearly clear with a faint tint,
 *  - toward grazing angles it deepens to a saturated rim colour (Fresnel),
 *  - a crisp darker line traces the silhouette,
 *  - a thin-film rainbow sheen rides the mid-Fresnel band,
 *  - softbox reflections lay white streaks along the folds.
 * Both faces of each tube render (no depth write), so overlaps and the far
 * wall stack up into the layered, darker crossings of real glass.
 */
import { Color, DoubleSide, NormalBlending, ShaderMaterial } from "three";
import type { GlassLook } from "@/state/glass";
import { MAX_STRANDS, RIBBON_VERTEX } from "./ribbons";

export function createGlassMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
    uniforms: {
      uTint: { value: new Color() },
      uRim: { value: new Color() },
      uHighlight: { value: new Color() },
      uClarity: { value: 0.1 },
      uRimStrength: { value: 0.8 },
      uFresnel: { value: 2.4 },
      uEdgeLine: { value: 0.7 },
      uIrid: { value: 0.4 },
      uSpec: { value: 0.6 },
      uInner: { value: 0.5 },
      // Ribbon sweep (see ribbons.ts)
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
      uJitA: { value: new Float32Array(MAX_STRANDS * 4) },
      uJitB: { value: new Float32Array(MAX_STRANDS * 4) },
      uJitC: { value: new Float32Array(MAX_STRANDS * 4) },
      uJitD: { value: new Float32Array(MAX_STRANDS * 4) },
    },
    vertexShader: /* glsl */ `
      ${RIBBON_VERTEX}
      varying vec3 vN;
      varying vec3 vP;
      varying vec2 vUv;
      void main() {
        vec3 pos;
        vec3 nrm;
        ribbonSweep(position, pos, nrm);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vP = mv.xyz;
        vN = normalize(normalMatrix * nrm);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      uniform vec3 uRim;
      uniform vec3 uHighlight;
      uniform float uClarity;
      uniform float uRimStrength;
      uniform float uFresnel;
      uniform float uEdgeLine;
      uniform float uIrid;
      uniform float uSpec;
      uniform float uInner;
      varying vec3 vN;
      varying vec3 vP;
      varying vec2 vUv;

      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(-vP);
        float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
        float g = 1.0 - ndv;                  // 0 face-on → 1 grazing
        float f = pow(g, uFresnel);

        // Body: clear tint → saturated rim.
        vec3 col = mix(uTint, uRim, smoothstep(0.0, 1.0, f));
        float a = mix(uClarity, uRimStrength, f);

        // Volume: a top-lit tube — undersides deepen toward the rim colour.
        float under = clamp(0.5 - 0.5 * n.y, 0.0, 1.0);
        col = mix(col, uRim, under * 0.35 * smoothstep(0.05, 0.5, g));
        a += under * 0.08 * smoothstep(0.05, 0.5, g);

        // Thin-film sheen across the mid band.
        vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + g * 1.6 + vUv.x * 0.6));
        float band = smoothstep(0.15, 0.55, g) * (1.0 - smoothstep(0.7, 0.98, g));
        col = mix(col, col * (0.55 + 0.9 * film), uIrid * band);
        a += uIrid * band * 0.06;

        // Internal reflections: thin parallel streaks running along the
        // tube (bands around the cross-section), strongest on the walls
        // seen at an angle — the layered "thick glass" lines.
        float ring = vUv.y * 6.2831;
        float streak = pow(abs(cos(ring * 2.0 + 0.6)), 28.0) * 0.8
                     + pow(abs(cos(ring * 3.0 + 1.9)), 60.0) * 0.6;
        // Fade out right at the silhouette, where thin triangles would
        // turn the bands into a sawtooth.
        streak *= uInner * smoothstep(0.08, 0.6, g) * (1.0 - smoothstep(0.72, 0.92, g));
        col = mix(col, uRim * 0.85, streak * 0.8);
        a = max(a, a + streak * 0.35);

        // Crisp silhouette line.
        float edge = smoothstep(0.86, 0.985, g) * uEdgeLine;
        col = mix(col, uRim * 0.72, edge);
        a = max(a, edge * 0.95);

        // Softbox reflections (view-space): a wide overhead bar and a
        // narrow side strip, streaking along the ribbons.
        vec3 r = reflect(-v, n);
        float top = smoothstep(0.7, 0.8, r.y) * (1.0 - smoothstep(0.93, 0.99, r.y));
        float side = smoothstep(0.82, 0.88, r.x) * (1.0 - smoothstep(0.95, 0.99, r.x));
        float spec = uSpec * clamp(top + 0.7 * side, 0.0, 1.0) * (0.35 + 0.65 * g);
        col = mix(col, uHighlight, spec);
        a = max(a, spec * 0.85);

        // Soft ends.
        a *= smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <colorspace_fragment>
      }
    `,
  });
}

export function applyGlassLook(m: ShaderMaterial, l: GlassLook) {
  const u = m.uniforms;
  (u.uTint.value as Color).set(l.tint);
  (u.uRim.value as Color).set(l.rim);
  (u.uHighlight.value as Color).set(l.highlight);
  u.uClarity.value = l.clarity;
  u.uRimStrength.value = l.rimStrength;
  u.uFresnel.value = l.fresnel;
  u.uEdgeLine.value = l.edgeLine;
  u.uIrid.value = l.iridescence;
  u.uSpec.value = l.specular;
  u.uInner.value = l.inner;
}
