import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWardrobeGarments } from '../src/render/characterWardrobeGarments';
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
  group.updateMatrixWorld(true);
  const rest = new Map<string, THREE.Matrix4>(), points = new Map<string, THREE.Vector3>();
  model.traverse(node => { if (node instanceof THREE.Bone) {
    rest.set(node.name, node.matrixWorld.clone()); points.set(node.name, node.getWorldPosition(new THREE.Vector3()));
  } });
  return { group, model, rest, points, hip, spine, head };
}

describe('bone-fitted wardrobe geometry', () => {
  it('fits every hat with a closed scalp and releases its owned resources once', () => {
    const f = fixture(), base = resolveCharacterWardrobe({ id: 17, portrait: 2, female: false, role: 'citizen' });
    const dimensions = new Set<string>();
    for (const headwear of CHARACTER_HEADWEAR) {
      const wardrobe = withCharacterWardrobe(base, { headwear });
      const result = createWardrobeGarments(f.group, f.model, wardrobe, f.rest, f.points);
      const mesh = result.meshes.find(mesh => mesh.name === 'wardrobe-headwear') as THREE.Mesh;
      expect(result.hidesSourceHat).toBe(true);
      expect(mesh.parent).toBe(f.head);
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

  it('gives coats and dresses weighted hems that follow the same rig', () => {
    const f = fixture();
    const base = resolveCharacterWardrobe({ id: 24, portrait: 1, female: true, role: 'citizen' });
    for (const outfit of CHARACTER_OUTFITS.filter(outfit => ['coat', 'dress'].includes(outfit.silhouette))) {
      const result = createWardrobeGarments(f.group, f.model, withCharacterWardrobe(base, { outfit }), f.rest, f.points);
      const mesh = result.meshes.find(mesh => mesh instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
      expect(mesh).toBeDefined(); expect(result.hidesSourceBody).toBe(true);
      const weights = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < weights.count; i++) {
        const values = [0, 1, 2, 3].map(j => weights.getComponent(i, j));
        expect(values.every(value => value >= 0 && value <= 1)).toBe(true);
        expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      }
      mesh.geometry.computeBoundingBox();
      expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(result.bodyHem, 5);
      f.group.updateMatrixWorld(true); mesh.skeleton.update();
      const before = mesh.getVertexPosition(0, new THREE.Vector3());
      f.hip.position.x += .2; f.group.updateMatrixWorld(true); mesh.skeleton.update();
      const after = mesh.getVertexPosition(0, new THREE.Vector3());
      expect(after.x - before.x).toBeCloseTo(.2, 5);
      f.hip.position.x -= .2; f.group.updateMatrixWorld(true);
      const skeletonDispose = vi.spyOn(mesh.skeleton, 'dispose');
      result.dispose(); expect(skeletonDispose).toHaveBeenCalledTimes(1);
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
      const result = createWardrobeGarments(f.group, f.model, wardrobe, f.rest, f.points);
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
      const result = createWardrobeGarments(f.group, f.model, wardrobe, f.rest, f.points);
      expect(result.hidesSourceBody).toBe(false);
      const mesh = result.meshes.find(mesh => mesh instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh;
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
});
