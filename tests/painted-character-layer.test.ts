import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SculptReviewLayer } from '../src/render/sculptReviewLayer';
import { CHARACTER_BODY_TYPES, CHARACTER_OUTFITS, resolveCharacterWardrobe, withCharacterWardrobe,
  type CharacterWardrobe } from '../src/render/characterWardrobe';
import type { CharacterAppearance } from '../src/render/characterEquipment';
import type { PersonRole } from '../src/sim/types';
import type { ActorStyle } from '../src/render/actors';

/** Keep the delivered vertices, skin and animation; a browser is only needed
 * for atlas decoding, which is inspected by the separate rendered gallery. */
async function geometryAsset(url: string): Promise<GLTF> {
  const raw = readFileSync(`public${url}`), length = raw.readUInt32LE(12);
  const gltf = JSON.parse(raw.subarray(20, 20 + length).toString());
  gltf.materials = (gltf.materials ?? []).map(() => ({}));
  delete gltf.images; delete gltf.textures; delete gltf.samplers;
  const binary = raw.subarray(28 + length), encoded = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
  binaryHeader.writeUInt32LE(binary.length); binaryHeader.write('BIN\0', 4);
  const packed = Buffer.concat([header, json, binaryHeader, binary]);
  return new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength), '');
}

function preset(female: boolean, shape: 'heavy' | 'thin', skinIndex: number, outfitId?: string): CharacterWardrobe {
  const base = resolveCharacterWardrobe({ id: female ? 211 : 210, portrait: 0, female, role: 'citizen' });
  return withCharacterWardrobe(base, {
    body: CHARACTER_BODY_TYPES.find(row => row.sex === (female ? 'female' : 'male') && row.shape === shape)!,
    heightScale: shape === 'heavy' ? 1.06 : .94,
    skinIndex,
    ...(outfitId ? { outfit: CHARACTER_OUTFITS.find(row => row.id === outfitId)! } : {}),
  });
}
function appearance(wardrobe: CharacterWardrobe, role: PersonRole = 'citizen'): CharacterAppearance {
  return { role, coat: wardrobe.outfit.coatColor, wardrobe };
}
function skinned(root: THREE.Object3D): THREE.SkinnedMesh {
  return root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
}
function shaderUniforms(mesh: THREE.Mesh): Record<string, { value: unknown }> {
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>' };
  material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
  return shader.uniforms;
}

async function fixture() {
  const sources = new Map<string, { geometry: THREE.BufferGeometry; positions: Float32Array }[]>();
  const textures: THREE.Texture[] = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    const asset = await geometryAsset(url);
    const entries: { geometry: THREE.BufferGeometry; positions: Float32Array }[] = [];
    asset.scene.traverse(child => {
      if (child instanceof THREE.SkinnedMesh) entries.push({ geometry: child.geometry,
        positions: new Float32Array(child.geometry.getAttribute('position').array) });
    });
    sources.set(url, entries);
    return asset;
  });
  vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => {
    const texture = new THREE.DataTexture(new Uint8Array([130, 93, 60, 255]), 1, 1);
    textures.push(texture); return texture;
  });
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true,
    json: async () => JSON.parse(readFileSync(`public${url}`, 'utf8')) }));
  const scene = new THREE.Scene(), layer = new SculptReviewLayer(scene, 1, () => {}, 8, { painted: true });
  await layer.load();
  expect(layer.error).toBeNull(); expect(layer.ready).toBe(true);
  function unchangedSources() {
    for (const entries of sources.values()) for (const { geometry, positions } of entries)
      expect(Array.from(geometry.getAttribute('position').array)).toEqual(Array.from(positions));
  }
  return { scene, layer, unchangedSources, textures };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('painted wardrobe on the delivered animated bodies', () => {
  it('uses the woman body for female constables and federal agents', async () => {
    const { scene, layer, unchangedSources } = await fixture();
    try {
      const matrix = new THREE.Matrix4();
      for (const [index, role] of (['police', 'policeChief', 'fbi', 'fbiHead', 'firefighter'] as const).entries()) {
        const wardrobe = resolveCharacterWardrobe({ id: 100 + index, portrait: 2, female: true, role });
        expect(layer.pushCharacter(index, 'police', matrix, .4, true, appearance(wardrobe, role))).toBe(true);
        const group = scene.getObjectByName(`sculpt-review-actor-${index}`)!;
        expect(group.userData.modelStyle).toBe('woman');
        expect(skinned(group).skeleton.bones.length).toBeGreaterThan(20);
      }
      unchangedSources();
    } finally { layer.dispose(); }
    expect(scene.children).toHaveLength(0);
  }, 90000);

  it('reassigns a pooled rig without carrying the previous body or material identity', async () => {
    const { scene, layer, unchangedSources, textures } = await fixture();
    const disposed = textures.map(texture => vi.spyOn(texture, 'dispose'));
    try {
      const matrix = new THREE.Matrix4();
      const heavy = preset(false, 'heavy', 9, 'm-wool-overcoat');
      expect(layer.pushCharacter(1, 'fedora', matrix, 0, false, appearance(heavy))).toBe(true);
      const first = scene.getObjectByName('sculpt-review-actor-1')!, firstMesh = skinned(first);
      const oldGeometry = firstMesh.geometry, oldMaterial = firstMesh.material;
      const oldUniforms = shaderUniforms(firstMesh);
      expect((oldUniforms.paintedSkin.value as THREE.Color).getHex()).toBe(heavy.skinColor);
      expect((oldUniforms.paintedCoat.value as THREE.Color).getHex()).toBe(heavy.outfit.coatColor);
      layer.pushCharacter(1, 'fedora', matrix, 0, false, appearance(heavy),
        { clock: 5.2, delta: 1, action: { kind: 'death', time: 5.2 } });
      layer.resetCharacters(); layer.retainCharacters(new Set()); layer.commitCharacters();
      expect(layer.cachedCharacterCount).toBe(1);
      const thin = preset(false, 'thin', 0, 'm-pinstripe');
      expect(layer.pushCharacter(2, 'fedora', matrix, 0, false, appearance(thin))).toBe(true);
      const next = scene.getObjectByName('sculpt-review-actor-2')!, nextMesh = skinned(next);
      expect(next).toBe(first);
      expect(nextMesh.geometry).not.toBe(oldGeometry);
      expect(nextMesh.material).not.toBe(oldMaterial);
      expect(next.children[0].userData.characterMorphology.build).toBe('thin');
      next.updateMatrixWorld(true);
      const standing = new THREE.Box3().setFromObject(next, true);
      expect(standing.max.y).toBeGreaterThan(1.5);
      expect(standing.max.y).toBeLessThan(2.2);
      expect(standing.min.y).toBeGreaterThan(-.05);
      const current = shaderUniforms(nextMesh);
      expect((current.paintedSkin.value as THREE.Color).getHex()).toBe(thin.skinColor);
      expect((current.paintedCoat.value as THREE.Color).getHex()).toBe(thin.outfit.coatColor);
      expect(current.paintedPattern.value).toBe(1);
      // Synthetic delivery drivers have only role/coat data. They must not
      // inherit the last pooled citizen's body or painted identity.
      layer.resetCharacters(); layer.retainCharacters(new Set()); layer.commitCharacters();
      expect(layer.pushCharacter(3, 'fedora', matrix, 0, false, { role: 'citizen', coat: 0x555555 })).toBe(true);
      const driver = scene.getObjectByName('sculpt-review-actor-3')!;
      expect(driver).toBe(first);
      expect(driver.children[0].userData.characterMorphology).toBeUndefined();
      expect(shaderUniforms(skinned(driver)).paintedWardrobe.value).toBe(0);
      unchangedSources();
    } finally { layer.dispose(); }
    expect(scene.children).toHaveLength(0);
    for (const spy of disposed) expect(spy).toHaveBeenCalledOnce();
  }, 90000);

  it('keeps heavy men and women finite, human-sized and grounded through walking, falling and throws', async () => {
    const { scene, layer, unchangedSources } = await fixture();
    try {
      const matrix = new THREE.Matrix4();
      for (const [id, female, style, outfitId] of [[1, false, 'fedora', 'm-fur-collar'],
        [2, true, 'woman', 'f-long-fur']] as const) {
        const wardrobe = preset(female, 'heavy', female ? 8 : 3, outfitId);
        const look = appearance(wardrobe);
        const bounds = () => {
          const group = scene.getObjectByName(`sculpt-review-actor-${id}`)!;
          group.updateMatrixWorld(true);
          return new THREE.Box3().setFromObject(group, true);
        };
        let previous: THREE.Box3 | undefined;
        for (let frame = 0; frame < 8; frame++) {
          expect(layer.pushCharacter(id, style as ActorStyle, matrix, frame * Math.PI / 4, true,
            look, { clock: frame / 8, delta: .125 })).toBe(true);
          const box = bounds(), size = box.getSize(new THREE.Vector3());
          expect(Number.isFinite(size.length())).toBe(true);
          expect(size.y).toBeGreaterThan(1.4); expect(size.y).toBeLessThan(2.6);
          // The delivered woman's walk itself dips a shoe about 4 cm below
          // its reference frame. Body variants must stay inside that envelope.
          expect(box.min.y, `${female ? 'woman' : 'man'} walking frame ${frame}`).toBeGreaterThan(-.05);
          expect(box.min.y).toBeLessThan(.12);
          if (previous && frame === 4) expect(box.equals(previous)).toBe(false);
          previous = box.clone();
        }
        for (const kind of ['death', 'throw'] as const) for (let frame = 0; frame <= 4; frame++) {
          const time = frame / 4 * (kind === 'death' ? 5.2 : 1.5);
          layer.pushCharacter(id, style as ActorStyle, matrix, 0, false,
            kind === 'throw' ? { ...look, throwable: 'molotov' } : look,
            { clock: time, delta: .25, action: kind === 'death' ? { kind, time } : { kind, time, throwable: 'molotov' } });
          const box = bounds(), size = box.getSize(new THREE.Vector3());
          expect(Number.isFinite(size.length())).toBe(true);
          expect(size.length()).toBeLessThan(4.5);
          expect(box.min.y, `${female ? 'woman' : 'man'} ${kind} ${time}`).toBeGreaterThan(-.03);
          expect(box.max.y).toBeLessThan(3);
        }
      }
      unchangedSources();
    } finally { layer.dispose(); }
    expect(scene.children).toHaveLength(0);
  }, 90000);
});
