import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWardrobeGarments } from '../src/render/characterWardrobeGarments';
import { CharacterMorphologyCache } from '../src/render/characterMorphology';
import { CHARACTER_HEADWEAR, CHARACTER_OUTFITS, resolveCharacterWardrobe, withCharacterWardrobe } from '../src/render/characterWardrobe';

function fixture(height = 1) {
  const group = new THREE.Group(), model = new THREE.Group(); group.add(model);
  model.scale.y = height;
  const hip = new THREE.Bone(); hip.name = 'Hips'; hip.position.y = .91; model.add(hip);
  for (const [name, x] of [['LeftUpLeg', .11], ['RightUpLeg', -.11]] as const) {
    const leg = new THREE.Bone(); leg.name = name; leg.position.set(x, -.08, 0); hip.add(leg);
  }
  const spine = new THREE.Bone(); spine.name = 'Spine'; spine.position.y = .21; hip.add(spine);
  const head = new THREE.Bone(); head.name = 'Head'; head.position.y = .46; spine.add(head);
  // Synthetic bound GLB-like body: identical skeleton and bind matrix for
  // both source and generated clothes, with legs that can move independently.
  const geometry = new THREE.CylinderGeometry(.16, .21, 1.45, 16, 14);
  geometry.translate(0, .82, 0);
  const pos = geometry.getAttribute('position');
  const skinIndex = new Uint16Array(pos.count * 4), skinWeight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), x = pos.getX(i), k = i * 4;
    if (y >= 1.42) { skinIndex[k] = 4; skinWeight[k] = 1; }
    else if (y >= 1.10) { skinIndex[k] = 3; skinWeight[k] = 1; }
    else if (y >= .79) {
      skinIndex[k] = 0; skinIndex[k + 1] = 3;
      skinWeight[k] = 1 - (y - .79) / .31; skinWeight[k + 1] = 1 - skinWeight[k];
    } else {
      // A physical skinned crotch blends smoothly into both legs. Hard
      // left/right assignment across one connected tube causes artificial
      // split-triangle stretching not present on a correctly weighted mesh.
      const legAmount = .5 * THREE.MathUtils.smoothstep(Math.abs(x), 0, .13)
        * (1 - THREE.MathUtils.smoothstep(y, .50, .95));
      skinIndex[k] = 0;
      skinIndex[k + 1] = x > 0 ? 1 : 2;
      skinWeight[k] = 1 - legAmount; skinWeight[k + 1] = legAmount;
    }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0x665544 }));
  model.add(body);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([
    hip, hip.children[0] as THREE.Bone, hip.children[1] as THREE.Bone, spine, head,
  ]);
  body.bind(skeleton, body.matrixWorld.clone());
  const rest = new Map<string, THREE.Matrix4>(), points = new Map<string, THREE.Vector3>();
  model.traverse(node => { if (node instanceof THREE.Bone) {
    rest.set(node.name, node.matrixWorld.clone()); points.set(node.name, node.getWorldPosition(new THREE.Vector3()));
  } });
  return { group, model, rest, points, hip, spine, head, body };
}

describe('bone-fitted wardrobe geometry', () => {
  it('fits every hat with a closed scalp and releases its owned resources once', () => {
    const f = fixture(), base = resolveCharacterWardrobe({ id: 17, portrait: 2, female: false, role: 'citizen' });
    const dimensions = new Set<string>();
    for (const headwear of CHARACTER_HEADWEAR) {
      const wardrobe = withCharacterWardrobe(base, { headwear });
      const result = createWardrobeGarments(f.model, wardrobe, f.rest, f.points);
      const mesh = result.meshes.find(mesh => mesh.name === 'wardrobe-headwear') as THREE.Mesh;
      expect(result.hidesSourceHat).toBe(true);
      expect(mesh.parent).toBe(f.group);
      result.sync();
      f.group.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(.12); expect(size.x).toBeLessThan(.65);
      expect(size.y).toBeGreaterThan(.08); expect(size.y).toBeLessThan(.5);
      dimensions.add(size.toArray().map(n => n.toFixed(3)).join(','));
      const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
      const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose');
      result.dispose(); result.dispose();
      expect(mesh.parent).toBeNull();
      expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
    }
    expect(dimensions.size).toBeGreaterThanOrEqual(11);
  });

  it('skins coat and dress shells to the existing body skeleton', () => {
    const f = fixture();
    const base = resolveCharacterWardrobe({ id: 24, portrait: 1, female: true, role: 'citizen' });
    for (const outfit of CHARACTER_OUTFITS.filter(outfit => ['coat', 'dress'].includes(outfit.silhouette))) {
      const result = createWardrobeGarments(f.model, withCharacterWardrobe(base, { outfit }), f.rest, f.points);
      const mesh = result.meshes.find(mesh => mesh.name === `wardrobe-${outfit.silhouette}`) as THREE.SkinnedMesh;
      expect(mesh).toBeDefined(); expect(result.hidesSourceBody).toBe(false);
      expect(mesh.parent).toBe(f.body.parent);
      expect(mesh.skeleton).toBe(f.body.skeleton);
      expect(mesh.bindMatrix.toArray()).toEqual(f.body.bindMatrix.toArray());
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(result.bodyHem, 5);
      f.group.updateMatrixWorld(true);
      const before = mesh.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      f.hip.position.x += .2; f.group.updateMatrixWorld(true); result.sync(); f.group.updateMatrixWorld(true);
      const after = mesh.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      expect(after.x - before.x).toBeCloseTo(.2, 5);
      f.hip.position.x -= .2; f.group.updateMatrixWorld(true);
      const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
      result.dispose(); expect(geometryDispose).toHaveBeenCalledTimes(1);
    }
  });

  it('applies height once while the same hat retains its width', () => {
    const base = resolveCharacterWardrobe({ id: 17, portrait: 2, female: false, role: 'citizen' });
    const extents = [.94, 1.06].map(heightScale => {
      const f = fixture(heightScale);
      const wardrobe = withCharacterWardrobe(base, {
        heightScale, headwear: CHARACTER_HEADWEAR.find(hat => hat.id === 'fedora-brown')!,
        outfit: CHARACTER_OUTFITS.find(outfit => outfit.id === 'm-long-duster')!,
      });
      const result = createWardrobeGarments(f.model, wardrobe, f.rest, f.points);
      f.group.updateMatrixWorld(true);
      const hat = result.meshes.find(mesh => mesh.name === 'wardrobe-headwear')!;
      const box = new THREE.Box3().setFromObject(hat);
      const answer = { width: box.max.x - box.min.x, top: box.max.y, hem: result.bodyHem };
      result.dispose(); return answer;
    });
    expect(extents[0].width).toBeCloseTo(extents[1].width, 5);
    expect(extents[1].top / extents[0].top).toBeCloseTo(1.06 / .94, 5);
    expect(extents[1].hem / extents[0].hem).toBeCloseTo(1.06 / .94, 5);
  });

  it('opens male coat panels in front and retains the trousers behind them', () => {
    const base = resolveCharacterWardrobe({ id: 17, portrait: 2, female: false, role: 'citizen' });
    for (const outfit of CHARACTER_OUTFITS.filter(outfit => outfit.sex === 'male' && outfit.silhouette === 'coat')) {
      const f = fixture(), wardrobe = withCharacterWardrobe(base, { outfit });
      const result = createWardrobeGarments(f.model, wardrobe, f.rest, f.points);
      expect(result.hidesSourceBody).toBe(false);
      const mesh = result.meshes.find(mesh => mesh.name === 'wardrobe-coat') as THREE.Mesh;
      const points = mesh.geometry.getAttribute('position');
      const frontHem: number[] = [];
      for (let i = 0; i < points.count; i++) if (points.getY(i) < result.bodyHem + .001 && points.getZ(i) > 0)
        frontHem.push(Math.abs(points.getX(i)));
      expect(frontHem.length).toBeGreaterThan(0);
      // There is no cloth across the centre-front below the coat fastening.
      expect(Math.min(...frontHem)).toBeGreaterThan(.1);
      result.dispose();
    }
  });
  it('keeps CPU-skinned body and garment triangles finite during walk, crouch and death', () => {
    const f = fixture(), cache = new CharacterMorphologyCache();
    expect(cache.apply(f.model, { build: 'stocky', heightScale: 1, faceIndex: 4 })).toBe(true);
    const base = resolveCharacterWardrobe({ id: 82, portrait: 1, female: true, role: 'citizen' });
    const wardrobe = withCharacterWardrobe(base, {
      outfit: CHARACTER_OUTFITS.find(outfit => outfit.sex === 'female' && outfit.silhouette === 'dress')!,
    });
    const result = createWardrobeGarments(f.model, wardrobe, f.rest, f.points);
    const garment = result.meshes.find(o => o.name === 'wardrobe-dress') as THREE.SkinnedMesh;
    expect(garment).toBeInstanceOf(THREE.SkinnedMesh);
    expect(garment.skeleton).toBe(f.body.skeleton);
    const legs = [f.model.getObjectByName('LeftUpLeg')!, f.model.getObjectByName('RightUpLeg')!];
    const poses = [0, .25, .5, .75, 'crouch', 'death'] as const;
    for (const phase of poses) {
      if (typeof phase === 'number') {
        legs[0].rotation.z = Math.sin(phase * 2 * Math.PI) * .25;
        legs[1].rotation.z = -Math.sin(phase * 2 * Math.PI) * .25;
        f.hip.rotation.z = 0; f.spine.rotation.x = 0;
      } else if (phase === 'crouch') {
        legs[0].rotation.z = .36; legs[1].rotation.z = -.36;
        f.hip.rotation.z = 0; f.spine.rotation.x = .20;
      } else {
        legs[0].rotation.z = .20; legs[1].rotation.z = -.20;
        f.hip.rotation.z = Math.PI * .5; f.spine.rotation.x = .15;
      }
      f.group.updateMatrixWorld(true);
      for (const mesh of [f.body, garment]) {
        const positions = mesh.geometry.getAttribute('position');
        const skinned: THREE.Vector3[] = [];
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const point = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          expect(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)).toBe(true);
          skinned.push(point);
        }
        const triangles = mesh.geometry.index;
        const count = triangles?.count ?? positions.count;
        let longest = 0;
        for (let j = 0; j + 2 < count; j += 3) {
          const v = [0, 1, 2].map(k => skinned[triangles ? triangles.getX(j + k) : j + k]);
          longest = Math.max(longest, v[0].distanceTo(v[1]), v[1].distanceTo(v[2]), v[2].distanceTo(v[0]));
        }
        expect(longest, `${mesh.name || 'body'} at ${phase}`).toBeLessThan(.35);
      }
    }
    result.dispose();
    cache.dispose();
  });

});
