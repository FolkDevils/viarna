/**
 * The photo studio the glass reflects and refracts.
 *
 * Glass has no colour of its own to show — it looks real because of what it
 * picks up from its surroundings. Product renders like the references are
 * lit with big softboxes in a grey room: the softboxes become the crisp white
 * streaks, and the dimmer room (and dark flags) become the deep streaks once
 * they're seen through tinted glass. This builds that room from emissive
 * panels ("lightformers") and bakes it into an HDR cube map.
 *
 * Fixed in world space, so orbiting the camera slides the reflections around
 * like a turntable shoot.
 */
import {
  BackSide,
  Color,
  CubeCamera,
  DoubleSide,
  HalfFloatType,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLCubeRenderTarget,
  type CubeTexture,
  type WebGLRenderer,
} from "three";

export interface StudioLook {
  /** Softbox colour. */
  highlight: string;
  /** Softbox brightness multiplier. */
  lights: number;
  /** 0 = evenly lit white room, 1 = dark room with only the softboxes. */
  studio: number;
}

interface Panel {
  pos: [number, number, number];
  size: [number, number];
  /** Brightness relative to `lights`; 0 = a black flag. */
  power: number;
}

// Directions matter, not distances — the cube map sees them at infinity.
// The camera looks down -z from +z, so +z panels sit behind the viewer.
const PANELS: Panel[] = [
  { pos: [0, 30, 4], size: [44, 16], power: 2.4 }, // overhead
  { pos: [0, 15, 26], size: [40, 2.6], power: 3.2 }, // long strip above the camera
  { pos: [25, 5, 15], size: [5, 32], power: 4.5 }, // key strip, right
  { pos: [-25, 2, 13], size: [3.5, 26], power: 2.6 }, // fill strip, left
  { pos: [15, 4, -24], size: [3, 26], power: 3 }, // back rims
  { pos: [-15, 4, -24], size: [3, 26], power: 3 },
  { pos: [-14, -2, 24], size: [6, 34], power: 0 }, // black flag, front left
];

export class Studio {
  readonly texture: CubeTexture;
  private scene = new Scene();
  private target: WebGLCubeRenderTarget;
  private camera: CubeCamera;
  private room: ShaderMaterial;
  private panels: { mesh: Mesh; mat: ShaderMaterial; power: number }[] = [];
  private key = "";

  constructor(size = 512) {
    this.target = new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    });
    this.texture = this.target.texture;
    this.camera = new CubeCamera(0.5, 200, this.target);

    this.room = new ShaderMaterial({
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTop: { value: 1 }, uHorizon: { value: 0.8 }, uFloor: { value: 0.3 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTop, uHorizon, uFloor;
        varying vec3 vDir;
        void main() {
          float y = normalize(vDir).y;
          float v = y > 0.0
            ? mix(uHorizon, uTop, smoothstep(0.0, 0.8, y))
            : mix(uHorizon, uFloor, smoothstep(0.0, 0.3, -y));
          gl_FragColor = vec4(vec3(v), 1.0);
        }
      `,
    });
    this.scene.add(new Mesh(new SphereGeometry(80, 48, 24), this.room));

    const plane = new PlaneGeometry(1, 1);
    for (const p of PANELS) {
      // Real softboxes are brightest in the middle and soft at the rim —
      // flat panels read as CG cut-outs once glass magnifies them.
      const mat = new ShaderMaterial({
        side: DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uColor: { value: new Color() } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            vec2 e = min(vUv, 1.0 - vUv);
            float rim = smoothstep(0.0, 0.3, e.x) * smoothstep(0.0, 0.3, e.y);
            float hot = 0.55 + 0.45 * smoothstep(0.7, 0.0, length(vUv - 0.5));
            gl_FragColor = vec4(uColor * hot, rim);
          }
        `,
      });
      const mesh = new Mesh(plane, mat);
      mesh.position.set(...p.pos);
      mesh.scale.set(p.size[0], p.size[1], 1);
      mesh.lookAt(0, 0, 0);
      // No depth buffer games (the cube faces aren't cleared): draw order
      // alone layers lights over the room and flags over lights.
      mesh.renderOrder = p.power === 0 ? 2 : 1;
      this.scene.add(mesh);
      this.panels.push({ mesh, mat, power: p.power });
    }
  }

  /** Re-bake if anything changed. Cheap enough to call every frame. */
  update(renderer: WebGLRenderer, look: StudioLook) {
    const key = `${look.highlight}|${look.lights}|${look.studio}`;
    if (key === this.key) return;
    this.key = key;
    const s = look.studio;
    const u = this.room.uniforms;
    u.uTop.value = 1.0 - 0.25 * s;
    u.uHorizon.value = 0.92 - 0.5 * s;
    u.uFloor.value = 0.75 - 0.72 * s;
    const hl = new Color(look.highlight);
    for (const p of this.panels) {
      (p.mat.uniforms.uColor.value as Color).copy(hl).multiplyScalar(p.power * look.lights);
    }
    this.camera.update(renderer, this.scene);
  }

  dispose() {
    this.target.dispose();
    this.room.dispose();
    for (const p of this.panels) p.mat.dispose();
    this.panels[0]?.mesh.geometry.dispose();
  }
}
