import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CharacterEquipment } from '../src/render/characterEquipment';
import { prepareWardrobeMask, WardrobeMaterialState } from '../src/render/characterWardrobeMaterial';
import { resolveCharacterWardrobe, withCharacterWardrobe } from '../src/render/characterWardrobe';
import { EquipmentModels } from '../src/render/equipmentModels';

function rig() {
  const group = new THREE.Group(), model = new THREE.Group(); group.add(model);
  const rows = [
    ['Spine', 0, 1.22, .12], ['LeftLeg', .1, .52, .03], ['LeftHand', .3, 1.0, 0],
    ['Head', 0, 1.60, .05], ['Head', 0, 1.80, 0], ['LeftFoot', .1, .04, .1],
    ['Neck', 0, 1.5, 0],
    ['Spine', .35, .4, .04],
  ] as const;
  const names = ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'Head', 'Neck', 'LeftHand', 'RightHand', 'LeftFoot'];
  const bones = names.map(name => { const b = new THREE.Bone(); b.name = name;
    b.position.y = name === 'Head' ? 1.6 : name === 'Hips' ? .95 : name === 'Spine' ? 1.25 : 0;
    if (name === 'LeftLeg') b.position.set(.1, .52, .03);
    if (name === 'LeftFoot') b.position.set(.1, .04, .1);
    model.add(b); return b; });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(rows.flatMap(row => row.slice(1) as number[]), 3));
  const joints = new Uint16Array(rows.length * 4), weights = new Float32Array(rows.length * 4);
  rows.forEach((row, i) => { joints[i * 4] = names.indexOf(row[0]); weights[i * 4] = 1; });
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex([0, 1, 2, 3, 4, 6]);
  const source = new THREE.MeshStandardMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, source); model.add(mesh);
  group.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  const library = new EquipmentModels();
  const equipment = new CharacterEquipment(group, model, library);
  return { group, model, mesh, geometry, source, equipment, close() {
    equipment.dispose(); library.dispose(); mesh.skeleton.dispose(); geometry.dispose(); source.dispose();
  } };
}

describe('painted 3D wardrobe materials', () => {
  it('separates exposed skin, trousers, headwear and shoes using the actual rest skeleton', () => {
    const r = rig();
    try {
      prepareWardrobeMask(r.mesh);
      const mask = r.geometry.getAttribute('aWardrobe');
      expect(mask.getX(2)).toBe(1); expect(mask.getX(3)).toBe(1); expect(mask.getX(6)).toBe(1);
      expect(mask.getY(1)).toBe(1); expect(mask.getZ(0)).toBe(1);
      expect(mask.getW(4)).toBe(1); expect(mask.getW(3)).toBe(0);
      expect(mask.getX(5)).toBe(0); expect(mask.getZ(5)).toBe(0);
      const oldSkirt = r.geometry.getAttribute('aWardrobeOldSkirt');
      expect(oldSkirt.getX(1)).toBe(0); expect(oldSkirt.getX(7)).toBe(1);
    } finally { r.close(); }
  });

  it('keeps skin and fabric uniforms independent across cached identities and can return to source art', () => {
    const a = new WardrobeMaterialState(), b = new WardrobeMaterialState();
    const first = resolveCharacterWardrobe({ id: 53, portrait: 7, female: false, role: 'citizen' });
    const second = withCharacterWardrobe(first, { skinIndex: (first.skinIndex + 4) % 10 });
    a.set(first); b.set(second);
    expect(a.skin.value).not.toBe(b.skin.value); expect(a.skin.value.equals(b.skin.value)).toBe(false);
    expect(a.enabled.value).toBe(1); expect(b.enabled.value).toBe(1);
    a.set(); expect(a.enabled.value).toBe(0); expect(b.enabled.value).toBe(1);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>' } as Parameters<THREE.Material['onBeforeCompile']>[0];
    b.patch(shader);
    expect(shader.uniforms.paintedSkin.value).toBe(b.skin.value);
  });

  it('replaces real hats and clothing without leaking garment resources or losing a held weapon', () => {
    const r = rig();
    try {
      const wardrobe = resolveCharacterWardrobe({ id: 55, portrait: 9, female: false, role: 'citizen' });
      const sourceDispose = vi.spyOn(r.geometry, 'dispose');
      r.equipment.set({ role: 'citizen', coat: 0x555555, weapon: 'pistol', wardrobe });
      const hat = r.group.getObjectByName('wardrobe-headwear') as THREE.Mesh;
      expect(hat).toBeDefined(); expect(hat.parent).toBe(r.group);
      expect(r.group.getObjectByName('equipment-pistol')?.parent?.name).toBe('RightHand');
      const hatGeometry = vi.spyOn(hat.geometry, 'dispose');
      const hatMaterial = vi.spyOn(hat.material as THREE.Material, 'dispose');
      r.equipment.set({ role: 'citizen', coat: 0x444444 });
      expect(r.group.getObjectByName('wardrobe-headwear')).toBeUndefined();
      expect(r.mesh.geometry).toBe(r.geometry);
      expect(hatGeometry).toHaveBeenCalledOnce(); expect(hatMaterial).toHaveBeenCalledOnce();
      expect(sourceDispose).not.toHaveBeenCalled();
    } finally { r.close(); }
  });
});
