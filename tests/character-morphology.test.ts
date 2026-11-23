import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CharacterMorphologyCache, characterFaceMorph, type CharacterBuild } from '../src/render/characterMorphology';
import { prepareWardrobeMask } from '../src/render/characterWardrobeMaterial';

// Use the delivered mesh, UVs, skin weights and walking clip. Texture decoding
// belongs to the browser visual review, so these geometry checks omit images.
async function geometryAsset(style: string): Promise<GLTF> {
  const raw = readFileSync(`public/art/city/sculpt/${style}.glb`), length = raw.readUInt32LE(12);
  const gltf = JSON.parse(raw.subarray(20, 20 + length).toString());
  gltf.materials = (gltf.materials ?? []).map(() => ({}));
  delete gltf.images; delete gltf.textures; delete gltf.samplers;
  const binary = raw.subarray(28 + length), bytes = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), chunk = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
  chunk.writeUInt32LE(binary.length); chunk.write('BIN\0', 4);
  const packed = Buffer.concat([header, json, chunk, binary]);
  return new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), '');
}

function rig(asset: GLTF, targetHeight = 1.82) {
  const model = cloneSkeleton(asset.scene);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(asset.animations[0]).play(); mixer.setTime(0);
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(targetHeight / size.y);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true), center = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  model.updateMatrixWorld(true);
  return { model, mixer, clip: asset.animations[0] };
}

function bodyBounds(model: THREE.Object3D, bone: RegExp): THREE.Box3 {
  const result = new THREE.Box3(), point = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(child => {
    if (!(child instanceof THREE.SkinnedMesh)) return;
    const indices = child.geometry.getAttribute('skinIndex'), weights = child.geometry.getAttribute('skinWeight');
    for (let vertex = 0; vertex < indices.count; vertex++) {
      let amount = 0;
      for (let slot = 0; slot < 4; slot++)
        if (bone.test(child.skeleton.bones[indices.getComponent(vertex, slot)].name)) amount += weights.getComponent(vertex, slot);
      if (amount < .9) continue;
      child.getVertexPosition(vertex, point).applyMatrix4(child.matrixWorld); result.expandByPoint(point);
    }
  });
  return result;
}
const neutralFace = { width: 1, jawWidth: 1, length: 1, nose: 1, cheeks: 1 };

describe('shared 3D character morphology', () => {
  it.each(['fedora', 'woman'])('widens %s torso and shoulders without widening head or shoes', async style => {
    const asset = await geometryAsset(style), average = rig(asset), heavy = rig(asset);
    const cache = new CharacterMorphologyCache();
    const source = asset.scene.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const positions = Array.from(source.geometry.getAttribute('position').array);
    const bones = heavy.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const inverseMatrices = bones.skeleton.boneInverses.map(matrix => matrix.toArray());
    const arm = heavy.model.getObjectByName('LeftShoulder')!;
    const shoulder = arm.position.clone();
    cache.apply(average.model, { build: 'average', heightScale: 1, faceIndex: 0, face: neutralFace });
    cache.apply(heavy.model, { build: 'heavy', heightScale: 1, faceIndex: 0, face: neutralFace });
    const torso = /^(hips|spine\d*)$/i;
    const torsoAverage = bodyBounds(average.model, torso).getSize(new THREE.Vector3());
    const torsoHeavy = bodyBounds(heavy.model, torso).getSize(new THREE.Vector3());
    expect(torsoHeavy.x).toBeGreaterThan(torsoAverage.x * 1.24);
    expect(torsoHeavy.z).toBeGreaterThan(torsoAverage.z * 1.15);
    const headAverage = bodyBounds(average.model, /^head$/i).getSize(new THREE.Vector3());
    const headHeavy = bodyBounds(heavy.model, /^head$/i).getSize(new THREE.Vector3());
    expect(Math.abs(headHeavy.x - headAverage.x)).toBeLessThan(.015);
    const feetAverage = bodyBounds(average.model, /foot|toe/i).getSize(new THREE.Vector3());
    const feetHeavy = bodyBounds(heavy.model, /foot|toe/i).getSize(new THREE.Vector3());
    expect(feetHeavy.distanceTo(feetAverage)).toBeLessThan(.0001);
    const handAverage = bodyBounds(average.model, /^lefthand$/i).getCenter(new THREE.Vector3());
    const handHeavy = bodyBounds(heavy.model, /^lefthand$/i).getCenter(new THREE.Vector3());
    // Hand joints are untouched; weapon grips are not translated by build.
    expect(Math.abs(handHeavy.x - handAverage.x)).toBeLessThan(.02);
    // Animation channels and inverse bindings retain their authored values.
    expect(arm.position.equals(shoulder)).toBe(true);
    expect(bones.skeleton.boneInverses.map(matrix => matrix.toArray())).toEqual(inverseMatrices);
    expect(Array.from(source.geometry.getAttribute('position').array)).toEqual(positions);
    cache.dispose();
  });

  it.each(['fedora', 'woman'])('keeps %s walk finite and foot geometry unchanged through builds/heights', async style => {
    const asset = await geometryAsset(style), cache = new CharacterMorphologyCache();
    for (const build of ['thin', 'average', 'stocky', 'heavy'] satisfies CharacterBuild[]) {
      const { model, mixer, clip } = rig(asset);
      const scale = build === 'thin' ? .93 : build === 'heavy' ? 1.07 : 1;
      expect(cache.apply(model, { build, heightScale: scale, faceIndex: 17 })).toBe(true);
      const origin = new THREE.Box3().setFromObject(model, true);
      expect(Math.abs(origin.min.y)).toBeLessThan(.002);
      expect(origin.getSize(new THREE.Vector3()).y).toBeCloseTo(1.82 * scale, 1);
      for (let frame = 0; frame < 8; frame++) {
        mixer.setTime(frame / 8 * clip.duration); model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model, true), size = box.getSize(new THREE.Vector3());
        expect(Number.isFinite(size.length())).toBe(true);
        expect(size.x).toBeLessThan(1.2); expect(size.z).toBeLessThan(1.5);
        expect(size.y).toBeGreaterThan(1.5); expect(size.y).toBeLessThan(2.1);
        expect(box.min.y).toBeGreaterThan(-.04);
      }
      cache.release(model);
    }
    cache.dispose();
  });

  it('shares identical geometry, retains live rigs and evicts only released entries', async () => {
    const asset = await geometryAsset('fedora'), cache = new CharacterMorphologyCache(2);
    const a = rig(asset), b = rig(asset), c = rig(asset), d = rig(asset);
    const appearance = { build: 'heavy' as const, heightScale: 1, faceIndex: 0 };
    cache.apply(a.model, appearance); cache.apply(b.model, appearance);
    const mesh = (model: THREE.Object3D) => model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    expect(mesh(a.model).geometry).toBe(mesh(b.model).geometry);
    const geometry = mesh(a.model).geometry, disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    cache.apply(c.model, { ...appearance, faceIndex: 1 });
    expect(cache.size).toBe(2); expect(cache.referenceCount).toBe(3);
    expect(cache.apply(d.model, { ...appearance, faceIndex: 2 })).toBe(false);
    expect(disposed).not.toHaveBeenCalled();
    cache.release(a.model); cache.release(b.model);
    expect(cache.apply(d.model, { ...appearance, faceIndex: 2 })).toBe(true);
    expect(disposed).toHaveBeenCalledOnce();
    expect(cache.size).toBe(2); expect(cache.referenceCount).toBe(2);
    cache.dispose(); expect(cache.size).toBe(0); expect(cache.referenceCount).toBe(0);
  });

  it('deforms the same bind geometry regardless of sampled walking phase', async () => {
    const asset = await geometryAsset('fedora'), still = rig(asset), walking = rig(asset);
    const cache = new CharacterMorphologyCache();
    walking.mixer.setTime(walking.clip.duration * .42);
    walking.model.updateMatrixWorld(true);
    const appearance = { build: 'heavy' as const, heightScale: 1.06, faceIndex: 6 };
    expect(cache.apply(still.model, appearance)).toBe(true);
    expect(cache.apply(walking.model, appearance)).toBe(true);
    const a = still.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const b = walking.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    // Cache keys, bind-pose geometry and inverse bindings are pose-independent.
    expect(a.geometry).toBe(b.geometry);
    expect(Array.from(a.geometry.getAttribute('position').array))
      .toEqual(Array.from(b.geometry.getAttribute('position').array));
    cache.dispose();
  });

  it('keeps short and tall equipment masks separate on otherwise identical bodies', async () => {
    const asset = await geometryAsset('fedora'), cache = new CharacterMorphologyCache();
    const short = rig(asset), tall = rig(asset);
    cache.apply(short.model, { build: 'average', heightScale: .94, faceIndex: 0 });
    cache.apply(tall.model, { build: 'average', heightScale: 1.06, faceIndex: 0 });
    const mesh = (model: THREE.Object3D) => model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const a = mesh(short.model), b = mesh(tall.model);
    prepareWardrobeMask(a); prepareWardrobeMask(b);
    expect(a.geometry).not.toBe(b.geometry);
    const maxHeight = (m: THREE.SkinnedMesh) => {
      const points = m.geometry.getAttribute('aWardrobePoint');
      return Math.max(...Array.from({ length: points.count }, (_, i) => points.getY(i)));
    };
    expect(maxHeight(b) / maxHeight(a)).toBeCloseTo(1.06 / .94, 3);
    cache.dispose();
  });

  it('offers twenty-four head forms and reapplication never compounds height or arm spread', async () => {
    expect(new Set(Array.from({ length: 24 }, (_, index) => JSON.stringify(characterFaceMorph(index)))).size).toBe(24);
    const asset = await geometryAsset('fedora'), { model } = rig(asset), cache = new CharacterMorphologyCache();
    const original = model.scale.clone(), shoulder = model.getObjectByName('LeftShoulder')!;
    const appearance = { build: 'heavy' as const, heightScale: 1.07, faceIndex: 5 };
    cache.apply(model, appearance);
    const first = shoulder.getWorldPosition(new THREE.Vector3());
    cache.apply(model, appearance);
    expect(model.scale.y).toBeCloseTo(original.y * 1.07, 8);
    expect(shoulder.getWorldPosition(new THREE.Vector3()).distanceTo(first)).toBeLessThan(.000001);
    cache.release(model); expect(model.scale.equals(original)).toBe(true);
    cache.dispose();
  });

  it('changes real head and jaw geometry between face presets while retaining the hat crown', async () => {
    const asset = await geometryAsset('fedora'), narrow = rig(asset), broad = rig(asset);
    const cache = new CharacterMorphologyCache();
    cache.apply(narrow.model, { build: 'average', heightScale: 1, faceIndex: 0 });
    cache.apply(broad.model, { build: 'average', heightScale: 1, faceIndex: 23 });
    const surface = (model: THREE.Object3D, lower: number, upper: number) => {
      const box = new THREE.Box3(), p = new THREE.Vector3();
      model.traverse(child => {
        if (!(child instanceof THREE.SkinnedMesh)) return;
        for (let index = 0; index < child.geometry.getAttribute('position').count; index++) {
          child.getVertexPosition(index, p).applyMatrix4(child.matrixWorld);
          if (p.y >= lower && p.y <= upper) box.expandByPoint(p);
        }
      });
      return box.getSize(new THREE.Vector3());
    };
    const smallFace = surface(narrow.model, 1.57, 1.70), largeFace = surface(broad.model, 1.57, 1.70);
    expect(largeFace.x).toBeGreaterThan(smallFace.x + .008);
    expect(surface(narrow.model, 1.76, 1.90).distanceTo(surface(broad.model, 1.76, 1.90))).toBeLessThan(.002);
    cache.dispose();
  });
});
