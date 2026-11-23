import * as THREE from 'three';

/** Convert the body's authored geometry coordinates to the actor frame.
 * Include the normalized model's scale/translation, but cancel the actor's
 * street position/rotation. Bones and sampled animation are never inverted. */
function actorFromBodyGeometry(mesh: THREE.SkinnedMesh, actor: THREE.Object3D): THREE.Matrix4 {
  actor.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const fromGeometry = actor.matrixWorld.clone().invert().multiply(mesh.matrixWorld);

  // Certain delivered GLBs scale only their mesh node by 0.01 while the
  // skeleton remains in metre-sized bind coordinates. Three's skinning then
  // cancels that internal 0.01 at each vertex. The bare mesh.matrixWorld is
  // therefore NOT the reference-space transform seen by the skinned surface.
  // Correct that static authoring-scale discrepancy, not any blended or
  // currently animated skin matrix. Normal model height/position changes are
  // already present in fromGeometry and must not be applied a second time.
  const rootBone = mesh.skeleton.bones[0];
  if (rootBone) {
    rootBone.updateWorldMatrix(true, false);
    const meshScale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
    const boneScale = new THREE.Vector3().setFromMatrixScale(rootBone.matrixWorld);
    const correction = new THREE.Vector3(1, 1, 1);
    for (const axis of ['x', 'y', 'z'] as const) {
      const factor = meshScale[axis] > 1e-8 ? boneScale[axis] / meshScale[axis] : 1;
      // Only normalize imported centimetre meshes; a real clothing/body size
      // adjustment must remain intact, including nonuniform model.scale.
      if (factor > 10 && factor < 1000) correction[axis] = factor;
    }
    fromGeometry.scale(correction);
  }
  return fromGeometry;
}

/** Bind-pose bone coordinates in actor metres, with the complete model
 * normalization and height scale applied exactly once. */
export function actorFromBind(mesh: THREE.SkinnedMesh, actor: THREE.Object3D): THREE.Matrix4 {
  return actorFromBodyGeometry(mesh, actor).multiply(mesh.bindMatrix.clone().invert());
}

export function bindBonePoint(
  mesh: THREE.SkinnedMesh, name: string, fromBind: THREE.Matrix4,
): THREE.Vector3 | undefined {
  const index = mesh.skeleton.bones.findIndex(bone => bone.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return undefined;
  return new THREE.Vector3()
    .setFromMatrixPosition(mesh.skeleton.boneInverses[index].clone().invert())
    .applyMatrix4(fromBind);
}

/** Find the actual skinned body (not a rigid hat or accessory). */
export function wardrobeBodyMesh(model: THREE.Object3D): THREE.SkinnedMesh | undefined {
  let selected: THREE.SkinnedMesh | undefined;
  let count = 0;
  model.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    if (!node.geometry.hasAttribute('skinIndex') || !node.geometry.hasAttribute('skinWeight')) return;
    const size = node.geometry.getAttribute('position')?.count ?? 0;
    if (size > count) { selected = node; count = size; }
  });
  return selected;
}

interface SourceVertex {
  position: THREE.Vector3;
  index: [number, number, number, number];
  weight: [number, number, number, number];
}

/** A generated garment's authoring positions are in actor metres. Convert
 * them into the existing body's geometry/bind space and transfer neighboring
 * body skin influences. The garment shares the source skeleton, including its
 * exact inverse bind matrices; it never allocates a second Skeleton. */
export function skinGarmentToBody(
  geometry: THREE.BufferGeometry, material: THREE.Material,
  actor: THREE.Object3D, body: THREE.SkinnedMesh,
): THREE.SkinnedMesh {
  // Both the body vertices and the new garment must meet in actor metres.
  // Include the model's normalization and height scale once, then convert
  // the garment back to the same geometry coordinates as its bound body.
  const actorFromBodyGeom = actorFromBodyGeometry(body, actor);
  const bodyGeomFromActor = actorFromBodyGeom.clone().invert();
  const positions = body.geometry.getAttribute('position');
  const skinIndices = body.geometry.getAttribute('skinIndex');
  const skinWeights = body.geometry.getAttribute('skinWeight');
  if (!positions || !skinIndices || !skinWeights) throw Error('Body is missing skin attributes');

  const samples: SourceVertex[] = [];
  const buckets = new Map<string, number[]>();
  const cell = .16;
  const bucketOf = (x: number, y: number, z: number): string =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const p = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).applyMatrix4(actorFromBodyGeom);
    const sample: SourceVertex = {
      position: p.clone(),
      index: [0, 1, 2, 3].map(j => skinIndices.getComponent(i, j)) as SourceVertex['index'],
      weight: [0, 1, 2, 3].map(j => skinWeights.getComponent(i, j)) as SourceVertex['weight'],
    };
    const number = samples.push(sample) - 1;
    const key = bucketOf(p.x, p.y, p.z);
    const members = buckets.get(key) ?? [];
    members.push(number);
    buckets.set(key, members);
  }

  const target = geometry.getAttribute('position');
  const indices = new Uint16Array(target.count * 4);
  const weights = new Float32Array(target.count * 4);
  const candidates: { index: number; distance: number }[] = [];
  const centre = new THREE.Vector3();
  const local = new THREE.Vector3();
  for (let i = 0; i < target.count; i++) {
    centre.fromBufferAttribute(target, i);
    candidates.length = 0;
    const cx = Math.floor(centre.x / cell), cy = Math.floor(centre.y / cell), cz = Math.floor(centre.z / cell);
    // Expand around the vertex. Even long skirts can find both thighs,
    // without scanning the entire imported body for every garment vertex.
    for (let radius = 0; radius <= 6 && candidates.length < 8; radius++) {
      for (let x = -radius; x <= radius; x++)
        for (let y = -radius; y <= radius; y++)
          for (let z = -radius; z <= radius; z++) {
            if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== radius) continue;
            for (const number of buckets.get(`${cx + x},${cy + y},${cz + z}`) ?? []) {
              const distance = centre.distanceToSquared(samples[number].position);
              candidates.push({ index: number, distance });
            }
          }
    }
    if (!candidates.length) {
      for (let j = 0; j < samples.length; j++)
        candidates.push({ index: j, distance: centre.distanceToSquared(samples[j].position) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const influence = new Map<number, number>();
    // The four nearest *positions* supply up to four strongest bone weights.
    for (const candidate of candidates.slice(0, 12)) {
      const sample = samples[candidate.index];
      const gain = 1 / Math.sqrt(Math.max(candidate.distance, .0025));
      for (let slot = 0; slot < 4; slot++) {
        const w = sample.weight[slot] * gain;
        if (w > 0) influence.set(sample.index[slot], (influence.get(sample.index[slot]) ?? 0) + w);
      }
    }
    const largest = [...influence].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = largest.reduce((sum, entry) => sum + entry[1], 0);
    for (let j = 0; j < 4; j++) {
      indices[i * 4 + j] = largest[j]?.[0] ?? 0;
      weights[i * 4 + j] = total > 0 ? (largest[j]?.[1] ?? 0) / total : (j === 0 ? 1 : 0);
    }
    // Position attribute ends in body-local geometry coordinates, not metres.
    local.copy(centre).applyMatrix4(bodyGeomFromActor);
    target.setXYZ(i, local.x, local.y, local.z);
  }
  // The nearest skin weights can differ sharply across a skirt seam even
  // though the two vertices are centimeters apart. Regularize transferred
  // weights over garment mesh adjacency so one hem triangle does not attach
  // to opposing thighs during a stride. All influences still originate from
  // the source GLB skeleton; no new bones or bind matrices are fabricated.
  const neighbor = Array.from({ length: target.count }, () => new Set<number>());
  const triangles = geometry.index;
  const faceCount = triangles?.count ?? target.count;
  for (let i = 0; i + 2 < faceCount; i += 3) {
    const a = triangles ? triangles.getX(i) : i;
    const b = triangles ? triangles.getX(i + 1) : i + 1;
    const c = triangles ? triangles.getX(i + 2) : i + 2;
    neighbor[a].add(b); neighbor[a].add(c);
    neighbor[b].add(a); neighbor[b].add(c);
    neighbor[c].add(a); neighbor[c].add(b);
  }
  for (let pass = 0; pass < 2; pass++) {
    const nextIndex = new Uint16Array(indices.length);
    const nextWeight = new Float32Array(weights.length);
    for (let i = 0; i < target.count; i++) {
      const accum = new Map<number, number>();
      const collect = (vertex: number, share: number) => {
        for (let slot = 0; slot < 4; slot++) {
          const weight = weights[vertex * 4 + slot] * share;
          if (weight <= 0) continue;
          const joint = indices[vertex * 4 + slot];
          accum.set(joint, (accum.get(joint) ?? 0) + weight);
        }
      };
      collect(i, neighbor[i].size ? .6 : 1);
      for (const j of neighbor[i]) collect(j, .4 / neighbor[i].size);
      const jointWeights = [...accum].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = jointWeights.reduce((sum, item) => sum + item[1], 0);
      for (let slot = 0; slot < 4; slot++) {
        nextIndex[i * 4 + slot] = jointWeights[slot]?.[0] ?? 0;
        nextWeight[i * 4 + slot] = total > 0 ? (jointWeights[slot]?.[1] ?? 0) / total
          : slot === 0 ? 1 : 0;
      }
    }
    indices.set(nextIndex);
    weights.set(nextWeight);
  }

  target.needsUpdate = true;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const garment = new THREE.SkinnedMesh(geometry, material);
  garment.bindMode = body.bindMode;
  garment.position.copy(body.position);
  garment.quaternion.copy(body.quaternion);
  garment.scale.copy(body.scale);
  garment.matrixAutoUpdate = body.matrixAutoUpdate;
  if (!garment.matrixAutoUpdate) garment.matrix.copy(body.matrix);
  body.parent?.add(garment);
  garment.bind(body.skeleton, body.bindMatrix.clone());
  return garment;
}
