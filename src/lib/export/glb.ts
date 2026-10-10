/** Binary glTF (.glb) + binary STL helpers shared by the 3D and Glass tabs. */
import type { Object3D } from "three";
import { GLTFExporter } from "three-stdlib";
import { STLExporter } from "three-stdlib";

export async function toGlb(obj: Object3D): Promise<Blob> {
  const out = await new GLTFExporter().parseAsync(obj, { binary: true });
  return new Blob([out as ArrayBuffer], { type: "model/gltf-binary" });
}

export function toStl(obj: Object3D): Blob {
  const dv = new STLExporter().parse(obj, { binary: true });
  return new Blob([dv.buffer as ArrayBuffer], { type: "model/stl" });
}
