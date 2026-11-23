import * as THREE from 'three';
import type { VehicleId } from '../sim/types';
import { VEHICLE_PROFILE } from './vehicles';
import { prepareSculptCoupeRoof } from './sculptCoupeRoof';
import { paintedVehicleMaterial, prepareVehicleBodyPaint, vehiclePaintPixels } from './vehiclePaint';

export const SCULPT_VEHICLE_KINDS: VehicleId[] = ['coupe', 'truck', 'speedster'];
export const SCULPT_VEHICLE_PROFILE: typeof VEHICLE_PROFILE = {
  ...VEHICLE_PROFILE,
  // The supplied sporting car has its fabric roof raised. Picking and markers
  // must include it instead of using the procedural open car's low windscreen.
  speedster: { ...VEHICLE_PROFILE.speedster, height: 1.72 },
};

/** Preserve every GLB primitive and its material, normalized together to +X and ground zero. */
export function createSculptVehicle(root: THREE.Object3D, kind: VehicleId, capacity: number,
  options: { painted?: boolean; coachworkPaint?: boolean; finish?: 'enamel' | 'illustrated' } = {}): {
  parts: THREE.InstancedMesh[]; ownedMaterials: THREE.Material[];
} {
  root.updateMatrixWorld(true);
  const sources: THREE.Mesh[] = [];
  root.traverse(child => { if (child instanceof THREE.Mesh) sources.push(child); });
  if (!sources.length) throw Error(`Sculpt ${kind} has no mesh`);
  const geometry = sources.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  // Midnight's nose is +Z. The two newer FBX exports face -X.
  geometry.forEach(part => part.rotateY(kind === 'coupe' ? Math.PI / 2 : Math.PI));
  const bounds = new THREE.Box3();
  for (const part of geometry) { part.computeBoundingBox(); bounds.union(part.boundingBox!); }
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(value => Number.isFinite(value) && value > 0)) {
    geometry.forEach(part => part.dispose());
    throw Error(`Sculpt ${kind} has invalid bounds`);
  }
  const profile = SCULPT_VEHICLE_PROFILE[kind], ownedMaterials: THREE.Material[] = [];
  const parts = geometry.map((part, index) => {
    part.translate(-center.x, -bounds.min.y, -center.z);
    part.scale(profile.length / size.x, profile.height / size.y, profile.width / size.z);
    part.computeBoundingBox(); part.computeBoundingSphere();
    let material = sources[index].material;
    const coachwork = options.coachworkPaint ?? !!options.painted;
    const finish = options.finish ?? (options.painted ? 'illustrated' : 'enamel');
    if (coachwork) {
      const source = Array.isArray(material) ? material[0] : material;
      const texture = source instanceof THREE.MeshStandardMaterial
        ? (source.userData.vehiclePaintReferenceMap as THREE.Texture | undefined) ?? source.map : null;
      prepareVehicleBodyPaint(part, kind, profile, material, vehiclePaintPixels(texture));
    }
    if (kind === 'coupe') {
      const roof = prepareSculptCoupeRoof(part, profile.height);
      ownedMaterials.push(roof);
      material = [Array.isArray(material) ? material[0] : material, roof];
    }
    if (coachwork) {
      const clone = (source: THREE.Material) => {
        const painted = paintedVehicleMaterial(source, kind, profile, { finish }); ownedMaterials.push(painted); return painted;
      };
      material = Array.isArray(material) ? material.map(clone) : clone(material);
    }
    const mesh = new THREE.InstancedMesh(part, material, capacity);
    mesh.name = `sculpt-review-${kind}${index ? `-part-${index}` : ''}`;
    mesh.count = 0;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (coachwork) {
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    }
    const livery = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    const canvas = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    livery.setUsage(THREE.DynamicDrawUsage);
    canvas.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aLivery', livery);
    mesh.geometry.setAttribute('aCanvas', canvas);
    mesh.raycast = () => {};
    return mesh;
  });
  return { parts, ownedMaterials };
}
