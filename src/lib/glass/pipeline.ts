/**
 * Multi-pass renderer for the glass stage.
 *
 * Glass has to see what's behind it, including the other strands, so each
 * frame builds a few helper buffers first:
 *  1. backdrop → `back` (full res, linear)
 *  2. nearest glass surface per pixel: depth + strand id → `ids`
 *  3. backdrop + every strand's nearest surface, cheaply shaded → `full`
 *  4. backdrop + the second-nearest surface (depth-peeled) → `layer`
 *  5. screen: backdrop, then the nearest glass at full quality. Refracted
 *     rays read `full` — or `layer` where `full` shows the same strand, so a
 *     strand never sees itself, only what's behind it.
 * Buffers 2–4 are only ever seen bent through glass, so they drop to half
 * resolution while things are moving.
 *
 * The backdrop is rendered in the scene (not CSS) so the glass can refract it;
 * exports simply read the canvas.
 */
import {
  DepthTexture,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { BACKDROP_TYPE_ID, type Backdrop } from "@/lib/backdrop";
import type { GlassLook } from "@/state/glass";
import { createRibbonGeometry } from "./ribbons";
import { Studio } from "./studio";
import {
  GLSL_COLOR,
  applyGlassLook,
  createGlassMaterial,
  createIdMaterial,
  createRibbonUniforms,
} from "./material";

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Same geometry as the CSS gradients and `paintBackdrop`, output linear. */
const BACKDROP_FRAG = /* glsl */ `
  uniform vec3 uFrom;
  uniform vec3 uTo;
  uniform int uType;
  uniform float uAngle;
  uniform vec2 uRes;
  ${GLSL_COLOR}
  void main() {
    vec2 c = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - 0.5 * uRes;
    float t = 0.0;
    if (uType == 1) {
      vec2 dir = vec2(sin(uAngle), -cos(uAngle));
      float len = abs(uRes.x * sin(uAngle)) + abs(uRes.y * cos(uAngle));
      t = clamp(dot(c, dir) / len + 0.5, 0.0, 1.0);
    } else if (uType == 2) {
      t = clamp(length(c) / length(0.5 * uRes), 0.0, 1.0);
    }
    // Interpolate in sRGB like CSS does, then store linear.
    gl_FragColor = vec4(toLinear(mix(uFrom, uTo, t)), 1.0);
  }
`;

const copyFrag = (srgb: boolean) => /* glsl */ `
  uniform sampler2D uTex;
  varying vec2 vUv;
  ${GLSL_COLOR}
  void main() {
    vec3 c = texture(uTex, vUv).rgb;
    gl_FragColor = vec4(${srgb ? "toSRGB(c)" : "c"}, 1.0);
  }
`;

/** Hex → sRGB components without colour management. */
const srgb = (hex: string, out: Vector3) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const quadMaterial = (fragmentShader: string, uniforms: ShaderMaterial["uniforms"]) =>
  new ShaderMaterial({ depthTest: false, depthWrite: false, uniforms, vertexShader: QUAD_VERT, fragmentShader });

/** The helper buffers (ids / full / layer) at one resolution. */
class Helpers {
  readonly res = new Vector2(1, 1);
  readonly ids = new WebGLRenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(1, 1),
  });
  readonly full = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  readonly layer = new WebGLRenderTarget(1, 1, { type: HalfFloatType });

  setSize(w: number, h: number) {
    this.res.set(w, h);
    this.full.setSize(w, h);
    this.layer.setSize(w, h);
    // r160 doesn't resize an attached depth texture on its own.
    const dt = this.ids.depthTexture!;
    dt.image.width = w;
    dt.image.height = h;
    this.ids.setSize(w, h);
  }

  dispose() {
    this.full.dispose();
    this.layer.dispose();
    this.ids.depthTexture?.dispose();
    this.ids.dispose();
  }
}

export class GlassPipeline {
  readonly ribbon = createRibbonUniforms();
  private studio = new Studio();
  private idMat = createIdMaterial(this.ribbon);
  private fullMat = createGlassMaterial(this.ribbon, "full");
  private peelMat = createGlassMaterial(this.ribbon, "peel");
  private frontMat = createGlassMaterial(this.ribbon, "front");
  private scene = new Scene();
  private mesh: Mesh;
  private quadScene = new Scene();
  private quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private res = new Vector2(1, 1);
  private back = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private sharp = new Helpers();
  private quick = new Helpers();
  private backdropMat = quadMaterial(BACKDROP_FRAG, {
    uFrom: { value: new Vector3(1, 1, 1) },
    uTo: { value: new Vector3(1, 1, 1) },
    uType: { value: 0 },
    uAngle: { value: 0 },
    uRes: { value: this.res },
  });
  private copyMat = quadMaterial(copyFrag(false), { uTex: { value: this.back.texture } });
  private outMat = quadMaterial(copyFrag(true), { uTex: { value: this.back.texture } });
  private strands: number;
  private dispersion = 0;

  constructor(private renderer: WebGLRenderer, strands: number) {
    renderer.autoClear = false;
    this.strands = strands;
    this.mesh = new Mesh(createRibbonGeometry(strands), this.frontMat);
    // Positions are computed in the vertex shader, so CPU bounds are meaningless.
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.backdropMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    for (const m of [this.fullMat, this.peelMat, this.frontMat]) m.uniforms.uEnv.value = this.studio.texture;
    this.fullMat.uniforms.uBehind.value = this.back.texture;
    this.peelMat.uniforms.uBehind.value = this.back.texture;
  }

  setStrands(n: number) {
    if (n === this.strands) return;
    this.strands = n;
    this.mesh.geometry.dispose();
    this.mesh.geometry = createRibbonGeometry(n);
  }

  /** Match the canvas's drawing-buffer size (device pixels). */
  setSize(w: number, h: number) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.res.x && h === this.res.y) return;
    this.res.set(w, h);
    this.back.setSize(w, h);
    this.sharp.setSize(w, h);
    this.quick.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
  }

  setLook(look: GlassLook) {
    for (const m of [this.fullMat, this.peelMat, this.frontMat]) {
      applyGlassLook(m, look);
      // Only the front glass ever needs the 3× RGB dispersion trace.
      m.uniforms.uDispersion.value = 0;
    }
    this.dispersion = look.dispersion;
    this.studio.update(this.renderer, look);
  }

  private pass(target: WebGLRenderTarget | null, quad: ShaderMaterial | null, glass: ShaderMaterial | null, camera: PerspectiveCamera) {
    const r = this.renderer;
    r.setRenderTarget(target);
    if (quad) {
      r.clear(false, true, false);
      this.quad.material = quad;
      r.render(this.quadScene, this.quadCam);
    } else {
      r.clear(true, true, false);
    }
    if (glass) {
      this.mesh.material = glass;
      r.render(this.scene, camera);
    }
  }

  /**
   * `refine` (still frames and exports) adds dispersion — 3× the cost — and
   * full-resolution helper buffers.
   */
  render(camera: PerspectiveCamera, backdrop: Backdrop, refine = true) {
    const bu = this.backdropMat.uniforms;
    srgb(backdrop.from, bu.uFrom.value);
    srgb(backdrop.type === "solid" ? backdrop.from : backdrop.to, bu.uTo.value);
    bu.uType.value = BACKDROP_TYPE_ID[backdrop.type];
    bu.uAngle.value = (backdrop.angle * Math.PI) / 180;
    for (const m of [this.fullMat, this.peelMat, this.frontMat]) m.uniforms.uProj.value = camera.projectionMatrix;
    const h = refine ? this.sharp : this.quick;
    const fu = this.frontMat.uniforms;
    fu.uDispersion.value = refine ? this.dispersion : 0;
    fu.uBehind.value = h.layer.texture;
    fu.uFull.value = h.full.texture;
    fu.uIds.value = h.ids.texture;
    this.peelMat.uniforms.uFront.value = h.ids.depthTexture;
    this.peelMat.uniforms.uRes.value = h.res;
    // 1.5 px at unit view distance, for antialiasing where strands melt.
    const px = (1.5 * 2 * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom;
    fu.uPixel.value = px / this.res.y;
    this.fullMat.uniforms.uPixel.value = px / h.res.y;
    this.peelMat.uniforms.uPixel.value = px / h.res.y;

    this.pass(this.back, this.backdropMat, null, camera);
    // Strand ids are stored as id + 1, so the clear must read as 0.
    this.renderer.setClearColor(0x000000, 0);
    this.pass(h.ids, null, this.idMat, camera);
    this.pass(h.full, this.copyMat, this.fullMat, camera);
    this.pass(h.layer, this.copyMat, this.peelMat, camera);
    this.pass(null, this.outMat, this.frontMat, camera);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.quad.geometry.dispose();
    for (const m of [this.idMat, this.fullMat, this.peelMat, this.frontMat, this.backdropMat, this.copyMat, this.outMat]) {
      m.dispose();
    }
    this.back.dispose();
    this.sharp.dispose();
    this.quick.dispose();
    this.studio.dispose();
  }
}
