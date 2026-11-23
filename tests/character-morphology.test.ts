import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CharacterMorphologyCache, characterFaceMorph, type CharacterBuild } from '../src/render/characterMorphology';
import { prepareWardrobeMask } from '../src/render/characterWardrobeMaterial';
import { createWardrobeGarments } from '../src/render/characterWardrobeGarments';
import { CHARACTER_OUTFITS, resolveCharacterWardrobe, withCharacterWardrobe } from '../src/render/characterWardrobe';

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
  it('widens isolated Spine, Spine1 and Spine2 skin influences on a heavy torso', () => {
    // A Hips-only width assertion misses an incorrectly escaped \\d in the
    // spine regex. Keep each spine region driven solely by its own bone.
    const model = new THREE.Group();
    const boneNames = ['Hips', 'Spine', 'Spine1', 'Spine2'];
    const bones = boneNames.map(name => {
      const bone = new THREE.Bone(); bone.name = name; return bone;
    });
    bones[0].position.y = .92; model.add(bones[0]);
    for (let i = 1; i < bones.length; i++) {
      bones[i].position.y = .1; bones[i - 1].add(bones[i]);
    }
    const vertices = [0, 0, 0, 0, 1.8, 0];
    const boneIndices = [0, 0];
    for (let i = 0; i < bones.length; i++) {
      vertices.push(.14, 1.02 + i * .01, .1, -.14, 1.02 + i * .01, .1);
      boneIndices.push(i, i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex([2, 3, 4, 4, 5, 6, 6, 7, 8, 0, 1, 2]);
    const indices = new Uint16Array(boneIndices.length * 4);
    const weights = new Float32Array(boneIndices.length * 4);
    for (let i = 0; i < boneIndices.length; i++) {
      indices[i * 4] = boneIndices[i]; weights[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const body = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    model.add(body); model.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(bones), body.matrixWorld.clone());
    const cache = new CharacterMorphologyCache();
    expect(cache.apply(model, { build: 'heavy', heightScale: 1, faceIndex: 0, face: neutralFace })).toBe(true);
    const morphed = body.geometry.getAttribute('position');
    for (let i = 0; i < bones.length; i++) {
      const positiveVertex = 2 + i * 2;
      expect(morphed.getX(positiveVertex), `${boneNames[i]} should widen`)
        .toBeGreaterThan(geometry.getAttribute('position').getX(positiveVertex) + .025);
    }
    cache.dispose(); body.skeleton.dispose(); geometry.dispose();
  });


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

  it.each([
    ['fedora', false, 'coat'],
    ['woman', true, 'dress'],
  ] as const)('CPU-skins real %s body and %s garment through walk phases with finite short edges',
    async (style, female, silhouette) => {
      const asset = await geometryAsset(style), { model, mixer, clip } = rig(asset);
      const group = new THREE.Group(); group.add(model);
      const cache = new CharacterMorphologyCache();
      expect(cache.apply(model, { build: 'stocky', heightScale: 1, faceIndex: 7 })).toBe(true);
      const boneRest = new Map<string, THREE.Matrix4>(), restPositions = new Map<string, THREE.Vector3>();
      group.updateMatrixWorld(true);
      model.traverse(node => {
        if (!(node instanceof THREE.Bone)) return;
        boneRest.set(node.name, node.matrixWorld.clone());
        restPositions.set(node.name, node.getWorldPosition(new THREE.Vector3()));
      });
      const base = resolveCharacterWardrobe({ id: female ? 72 : 63, female, portrait: 3, role: 'citizen' });
      const outfit = CHARACTER_OUTFITS.find(item => item.silhouette === silhouette && item.sex === (female ? 'female' : 'male'))!;
      const garments = createWardrobeGarments(model, withCharacterWardrobe(base, { outfit }), boneRest, restPositions);
      const garment = garments.meshes.find(mesh => mesh.name === `wardrobe-${silhouette}`) as THREE.SkinnedMesh;
      const body = model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
      expect(garment).toBeInstanceOf(THREE.SkinnedMesh);
      expect(garment.skeleton).toBe(body.skeleton);
      const point = new THREE.Vector3();
      for (const phase of [0, .25, .5, .75]) {
        mixer.setTime(phase * clip.duration); group.updateMatrixWorld(true);
        garments.sync();
        for (const mesh of [body, garment]) {
          const pos = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
          const skinned: THREE.Vector3[] = [];
          for (let i = 0; i < pos.count; i++) {
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
            expect([point.x, point.y, point.z].every(Number.isFinite)).toBe(true);
            skinned.push(point.clone());
          }
          let longest = 0, worst = -1;
          const count = index?.count ?? pos.count;
          for (let i = 0; i + 2 < count; i += 3) {
            const a = skinned[index ? index.getX(i) : i];
            const b = skinned[index ? index.getX(i + 1) : i + 1];
            const c = skinned[index ? index.getX(i + 2) : i + 2];
            const longestHere = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
            if (longestHere > longest) { longest = longestHere; worst = i; }
          }
          if (mesh === garment && phase === 0) {
            const vertex = (slot: number) => index ? index.getX(worst + slot) : worst + slot;
            const debug = {
              style, bodyMatrix: body.matrixWorld.elements, bindMatrix: body.bindMatrix.elements,
              garmentMatrix: garment.matrixWorld.elements, modelScale: model.scale.toArray(),
              modelPosition: model.position.toArray(), longest, worst,
              bones: body.skeleton.bones.slice(0, 16).map((bone, i) => ({
                name: bone.name, scale: new THREE.Vector3().setFromMatrixScale(bone.matrixWorld).toArray(),
                bindScale: new THREE.Vector3().setFromMatrixScale(body.skeleton.boneInverses[i].clone().invert()).toArray(),
                parent: bone.parent?.name,
              })),
              bodySamples: [0, 100, 500].filter(i => i < body.geometry.getAttribute('position').count).map(i => ({
                raw: new THREE.Vector3().fromBufferAttribute(body.geometry.getAttribute('position'), i).toArray(),
                skinned: body.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(body.matrixWorld).toArray(),
                unskinned: new THREE.Vector3().fromBufferAttribute(body.geometry.getAttribute('position'), i).applyMatrix4(body.matrixWorld).toArray(),
              })),
              original: [0, 1, 2].map(slot => new THREE.Vector3().fromBufferAttribute(pos, vertex(slot)).toArray()),
              deformed: [0, 1, 2].map(slot => skinned[vertex(slot)].toArray()),
            };
            console.log('ACTOR_SPACE_DEBUG', JSON.stringify(debug));
          }
          expect(longest, `${style}/${mesh.name || 'body'}/phase ${phase}`).toBeLessThan(.35);
        }
      }
      garments.dispose();
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
