import * as THREE from 'three';
import type { VehicleId } from '../sim/types';

interface PaintSample { r: number; g: number; b: number }
interface VehicleSize { length: number; width: number; height: number }
interface Pixels { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number }

/** A reference sample is only retained while a vehicle is prepared. It never
 * becomes an extra GPU texture or a separate image for each traffic car. */
export function vehiclePaintPixels(texture: THREE.Texture | null): Pixels | null {
  if (!texture?.image) return null;
  const image = texture.image as { width: number; height: number; data?: Uint8Array };
  if (!image.width || !image.height) return null;
  if (image.data) return { data: image.data, width: image.width, height: image.height,
    channels: image.data.length / (image.width * image.height) };
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image as unknown as CanvasImageSource, 0, 0);
    return { data: context.getImageData(0, 0, image.width, image.height).data,
      width: image.width, height: image.height, channels: 4 };
  } catch { return null; }
}

/** The delivered one-material bodies also contain tyres, windows and trim.
 * Restrict repainting to coachwork, with the source atlas protecting chrome
 * and the sports car's authored red panels. Coordinates are normalized metres. */
export function vehicleBodyPaintWeight(kind: VehicleId, size: VehicleSize,
  point: THREE.Vector3, normal: THREE.Vector3, materialName: string, sample?: PaintSample): number {
  const name = materialName.toLowerCase();
  if (/glass|window|clean-roof/.test(name)) return 0;
  if (/repaired-coachwork/.test(name)) return 1;
  const { length, width, height } = size, { x, y, z } = point;
  // The coupe's side panes extend lower than its door-top UV highlights.
  // Keep the narrow cabin above the belt line in its authored dark finish;
  // luminance alone cannot distinguish its near-black glass from body paint.
  if (kind === 'coupe' && y > height * .46 && x < length * .26 && Math.abs(z) < width * .42 && normal.y < .70) return 0;
  if (kind === 'speedster' && sample) {
    // The retained sports-car primitive has distinct red painted panels;
    // tyres, bright metal and the fabric top have separate neutral texels.
    return sample.r > .16 && sample.r > sample.g * 1.42 && sample.r > sample.b * 1.42 ? 1 : 0;
  }
  if (y < height * .22 || y > height * (kind === 'truck' ? .72 : .85)) return 0;
  if (sample) {
    const bright = Math.max(sample.r, sample.g, sample.b);
    const dark = Math.min(sample.r, sample.g, sample.b);
    if (bright > .60 && bright - dark < .18) return 0; // chrome and pale lamps
    if (kind === 'coupe' && y > height * .50 && x < length * .30 &&
        (sample.r + sample.g + sample.b) / 3 > .24) return 0; // grey cabin glass
  }
  // Wheel discs and rubber stay unchanged, including their side faces.
  if (Math.abs(z) > width * .30) {
    const wheelY = height * (kind === 'truck' ? .20 : .225);
    const radius = height * (kind === 'truck' ? .205 : .235);
    for (const axle of [-.31, .30])
      if (Math.hypot(x - length * axle, y - wheelY) < radius) return 0;
  }
  // The radiator face and bumpers keep their metal/black treatment.
  if (x > length * .31 && normal.x > .60) return 0;
  if (x > length * .43 && y < height * .47) return 0;
  if (kind === 'truck') {
    // This hauler's rear cargo cover is canvas, not painted sheet metal.
    if (x < -length * .10) return 0;
    if (y > height * .51 && x < length * .25 && normal.y < .65) return 0; // cab glazing
    return 1;
  }
  if (y > height * .60 && x < length * .26) return 0; // cabin windows/roof
  return 1;
}

export function prepareVehicleBodyPaint(geometry: THREE.BufferGeometry, kind: VehicleId,
  size: VehicleSize, material: THREE.Material | THREE.Material[], pixels: Pixels | null): void {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  const source = Array.isArray(material) ? material[0] : material;
  const texture = source instanceof THREE.MeshStandardMaterial
    ? (source.userData.vehiclePaintReferenceMap as THREE.Texture | undefined) ?? source.map : null;
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), texcoord = new THREE.Vector2();
  const mask = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i); normal.fromBufferAttribute(normals, i);
    let sample: PaintSample | undefined;
    if (texture && uv && pixels) {
      texcoord.set(uv.getX(i), uv.getY(i)); texture.transformUv(texcoord);
      const x = THREE.MathUtils.clamp(Math.floor(texcoord.x * pixels.width), 0, pixels.width - 1);
      const y = THREE.MathUtils.clamp(Math.floor(texcoord.y * pixels.height), 0, pixels.height - 1);
      const index = (y * pixels.width + x) * pixels.channels;
      sample = { r: pixels.data[index] / 255, g: pixels.data[index + 1] / 255, b: pixels.data[index + 2] / 255 };
    }
    mask[i] = vehicleBodyPaintWeight(kind, size, point, normal, source.name, sample);
  }
  geometry.setAttribute('aBodyPaint', new THREE.Float32BufferAttribute(mask, 1));
}

/** Clone ownership stays with the vehicle layer. Instance colours are carried
 * separately from vertex colours so they cannot tint glass, tyres or chrome. */
export function paintedVehicleMaterial(source: THREE.Material, kind?: VehicleId, size?: VehicleSize): THREE.Material {
  // The preparation-only reference is a live Texture. Material.copy normally
  // JSON-serializes userData, which would encode the entire source image.
  // Shadow that one field without mutating the source material.
  const sanitized = Object.create(source) as THREE.Material;
  sanitized.userData = { ...source.userData };
  delete sanitized.userData.vehiclePaintReferenceMap;
  const material = sanitized.clone();
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;
  material.roughness = Math.max(.72, material.roughness);
  material.metalness = Math.min(.12, material.metalness);
  material.emissiveMap = null; material.emissive.setRGB(0, 0, 0);
  const previousCompile = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float aBodyPaint;
      varying float vBodyPaint;
      varying vec3 vVehiclePaint;
      varying vec3 vVehiclePoint;`)
      .replace('#include <color_vertex>', `${THREE.ShaderChunk.color_vertex.replace(/vColor\.xyz\s*\*=\s*instanceColor(?:\.xyz)?\s*;/g, '')}
        vBodyPaint = aBodyPaint;
        vVehiclePoint = position;
        vVehiclePaint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vVehiclePaint = instanceColor;
        #endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vBodyPaint;
      varying vec3 vVehiclePaint;
      varying vec3 vVehiclePoint;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float coachLight = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
        float coachMask = clamp(vBodyPaint, 0.0, 1.0);
        ${kind === 'coupe' && size ? `
          // Window UVs can share a triangle edge with the painted door. An
          // exact per-pixel cabin exclusion prevents interpolated body masks
          // from washing the lower glass in the chosen paint colour.
          if (vVehiclePoint.y > ${(size.height * .46).toFixed(6)}
            && vVehiclePoint.x < ${(size.length * .26).toFixed(6)}
            && abs(vVehiclePoint.z) < ${(size.width * .42).toFixed(6)}) coachMask = 0.0;
        ` : ''}
        ${kind === 'speedster' ? `
          // A generated painted atlas can shift a red edge inside its UV
          // island. Resolve remaining coloured coachwork per pixel above the
          // wheels, without tinting the canvas or dark rubber.
          float redCoach = step(.012, diffuseColor.r) * step(diffuseColor.g * 1.5, diffuseColor.r)
            * step(diffuseColor.b * 1.5, diffuseColor.r) * step(.56, vVehiclePoint.y)
            * (1.0 - step(1.24, vVehiclePoint.y));
          coachMask = max(coachMask, redCoach);
        ` : ''}
        // Preserve the authored paint's broad shading while lifting black
        // source albedo enough that cream/green coachwork is actually visible.
        vec3 coachPaint = vVehiclePaint * clamp(.47 + 1.75 * sqrt(max(coachLight, 0.0)), .48, 1.45);
        diffuseColor.rgb = mix(diffuseColor.rgb, coachPaint, coachMask);`);
  };
  material.customProgramCacheKey = () => `${previousKey}:selective-vehicle-paint-${kind ?? 'default'}-v4`;
  material.needsUpdate = true;
  return material;
}
