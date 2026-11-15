import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SculptReviewLayer } from '../src/render/sculptReviewLayer';
import { createSculptVehicle, SCULPT_VEHICLE_PROFILE } from '../src/render/sculptVehicles';
import { paintedVehicleMaterial, vehicleBodyPaintWeight, vehiclePaintPixels } from '../src/render/vehiclePaint';

const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const side = point(0, 0, 1);

describe('selective 1930s vehicle coachwork paint', () => {
  it('keeps coupe rubber, glass, chrome and roof separate from painted doors and bonnet', () => {
    const size = SCULPT_VEHICLE_PROFILE.coupe;
    const weight = (p: THREE.Vector3, sample = { r: .12, g: .12, b: .12 }) =>
      vehicleBodyPaintWeight('coupe', size, p, side, 'Material.001', sample);
    expect(weight(point(0, .95, .8))).toBe(1);
    expect(vehicleBodyPaintWeight('coupe', size, point(1.2, 1.12, 0), point(0, 1, 0),
      'Material.001', { r: .12, g: .12, b: .12 })).toBe(1);
    expect(weight(point(1.392, .432, .8))).toBe(0);
    expect(weight(point(.8, 1.4, .7))).toBe(0);
    expect(weight(point(.1, .95, .65), { r: .08, g: .08, b: .08 })).toBe(0);
    expect(weight(point(0, 1.85, 0))).toBe(0);
    expect(weight(point(0, .95, .8), { r: .8, g: .8, b: .8 })).toBe(0);
  });

  it('paints a hauler cab while preserving its rear canvas and glazing', () => {
    const size = SCULPT_VEHICLE_PROFILE.truck;
    const weight = (p: THREE.Vector3) => vehicleBodyPaintWeight('truck', size, p, side,
      'truck-retained-details', { r: .50, g: .40, b: .25 });
    expect(weight(point(1.2, 1.0, .8))).toBe(1);
    expect(weight(point(-1.3, 2.0, .8))).toBe(0);
    expect(weight(point(.9, 1.5, .8))).toBe(0);
    expect(weight(point(1.662, .486, .85))).toBe(0);
  });

  it('recognizes solid sports-car coachwork and protects its separate glass and neutral fabric', () => {
    const size = SCULPT_VEHICLE_PROFILE.speedster, p = point(0, 1, .6);
    expect(vehicleBodyPaintWeight('speedster', size, p, side, 'speedster-repaired-coachwork')).toBe(1);
    expect(vehicleBodyPaintWeight('speedster', size, p, side, 'speedster-window-glass')).toBe(0);
    expect(vehicleBodyPaintWeight('speedster', size, p, side, 'speedster-retained-details', { r: .8, g: .05, b: .05 })).toBe(1);
    expect(vehicleBodyPaintWeight('speedster', size, p, side, 'speedster-retained-details', { r: .2, g: .2, b: .2 })).toBe(0);
  });

  it('clones only material state and does not serialize preparation textures', () => {
    const original = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const atlas = new THREE.DataTexture(new Uint8Array([30, 30, 30, 255]), 1, 1);
    const reference = new THREE.DataTexture(new Uint8Array([20, 20, 20, 255]), 1, 1);
    original.map = atlas; original.userData.vehiclePaintReferenceMap = reference;
    const serialize = vi.spyOn(reference, 'toJSON');
    const painted = paintedVehicleMaterial(original) as THREE.MeshStandardMaterial;
    expect(painted).not.toBe(original); expect(painted.map).toBe(atlas);
    expect(original.userData.vehiclePaintReferenceMap).toBe(reference);
    expect(painted.userData.vehiclePaintReferenceMap).toBeUndefined();
    expect(serialize).not.toHaveBeenCalled();
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <color_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>' };
    painted.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vVehiclePaint = instanceColor;');
    expect(shader.vertexShader).not.toMatch(/vColor\.xyz\s*\*=\s*instanceColor/);
    expect(shader.fragmentShader).toContain('clamp(vBodyPaint, 0.0, 1.0)');
    expect(vehiclePaintPixels(reference)?.data).toEqual(reference.image.data);
    painted.dispose(); original.dispose(); atlas.dispose(); reference.dispose();
  });

  it('keeps instance paints independent with shared geometry/maps and owns only cloned materials', () => {
    const root = new THREE.Group(), source = new THREE.MeshStandardMaterial({ name: 'speedster-repaired-coachwork' });
    const sourceGeometry = new THREE.BoxGeometry(4, 1.4, 1.8); sourceGeometry.translate(0, .7, 0);
    root.add(new THREE.Mesh(sourceGeometry, source));
    const built = createSculptVehicle(root, 'speedster', 2, { painted: true });
    const mesh = built.parts[0], a = new THREE.Color(0xbeb08d), b = new THREE.Color(0x324c3d);
    mesh.setColorAt(0, a); mesh.setColorAt(1, b);
    const actual = new THREE.Color(); mesh.getColorAt(0, actual); expect(actual.getHex()).toBe(a.getHex());
    mesh.getColorAt(1, actual); expect(actual.getHex()).toBe(b.getHex());
    expect(mesh.geometry.getAttribute('aBodyPaint').count).toBe(sourceGeometry.attributes.position.count);
    expect(mesh.material).not.toBe(source); expect(built.ownedMaterials).toContain(mesh.material);
    expect(sourceGeometry.hasAttribute('aBodyPaint')).toBe(false);
    built.ownedMaterials.forEach(material => material.dispose()); mesh.geometry.dispose(); mesh.dispose();
    sourceGeometry.dispose(); source.dispose();
  });

  it('carries separate paints through the real shared layer across all parts, reset and disposal', async () => {
    const originals: THREE.Texture[] = [], delivered: THREE.Texture[] = [];
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const scene = new THREE.Group();
      const atlas = new THREE.DataTexture(new Uint8Array([90, 60, 40, 255]), 1, 1);
      originals.push(atlas);
      for (let i = 0; i < 3; i++) {
        const geometry = new THREE.BoxGeometry(.2, .3, .2);
        const material = new THREE.MeshStandardMaterial({ map: atlas });
        const mesh = new THREE.Mesh(geometry, material); mesh.position.set(i * .3, .15, 0); scene.add(mesh);
      }
      return { scene, animations: [new THREE.AnimationClip('walking', 1, [])] } as unknown as GLTF;
    });
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => {
      const map = new THREE.DataTexture(new Uint8Array([110, 105, 95, 255]), 1, 1);
      delivered.push(map); return map;
    });
    vi.stubGlobal('fetch', async (url: string) => ({ ok: true,
      json: async () => JSON.parse(readFileSync(`public${url}`, 'utf8')) }));
    const scene = new THREE.Scene(), layer = new SculptReviewLayer(scene, 2, () => {}, 8, { painted: true });
    try {
      await layer.load(); expect(layer.ready).toBe(true); expect(layer.error).toBeNull();
      expect(delivered).toHaveLength(8); // five people and three shared car maps
      const textures = [...originals, ...delivered].map(map => vi.spyOn(map, 'dispose'));
      const cream = 0xc9bb98, green = 0x394e3d;
      for (const kind of ['coupe', 'truck', 'speedster'] as const) {
        expect(layer.pushVehicle(kind, new THREE.Matrix4(), cream)).toBe(true);
        expect(layer.pushVehicle(kind, new THREE.Matrix4().makeTranslation(5, 0, 0), green)).toBe(true);
      }
      layer.commitVehicles(); expect(layer.vehicleCount).toBe(6);
      const parts = scene.children.filter(node => node instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
      expect(parts).toHaveLength(9);
      const materials = new Set(parts.flatMap(part => Array.isArray(part.material) ? part.material : [part.material]));
      const disposed = [...materials].map(material => vi.spyOn(material, 'dispose'));
      const value = new THREE.Color();
      for (const part of parts) {
        expect(part.count).toBe(2); expect(part.geometry.hasAttribute('aBodyPaint')).toBe(true);
        part.getColorAt(0, value); expect(value.getHex()).toBe(cream);
        part.getColorAt(1, value); expect(value.getHex()).toBe(green);
      }
      layer.resetVehicles(); layer.commitVehicles(); expect(parts.every(part => part.count === 0)).toBe(true);
      expect(layer.pushVehicle('coupe', new THREE.Matrix4(), green)).toBe(true);
      layer.commitVehicles();
      for (const part of parts.filter(part => part.name.startsWith('sculpt-review-coupe'))) {
        expect(part.count).toBe(1); part.getColorAt(0, value); expect(value.getHex()).toBe(green);
      }
      layer.dispose(); expect(scene.children).toHaveLength(0);
      for (const spy of [...textures, ...disposed]) expect(spy).toHaveBeenCalledOnce();
    } finally { layer.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });
});
