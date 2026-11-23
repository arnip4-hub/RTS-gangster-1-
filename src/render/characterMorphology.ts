import * as THREE from 'three';
import { bindBonePoint, wardrobeBodyMesh } from './characterBindSpace';

export type CharacterBuild = 'thin' | 'average' | 'stocky' | 'heavy';
export interface CharacterFaceMorph {
  width: number;
  jawWidth: number;
  length: number;
  nose: number;
  cheeks: number;
}
export interface CharacterMorphology {
  build: CharacterBuild;
  heightScale: number;
  faceIndex: number;
  /** Multipliers around one; omitted values use the indexed face preset. */
  face?: Partial<CharacterFaceMorph>;
}

const BUILDS = {
  thin: { width: .83, depth: .87, belly: -.012, shoulder: -.014, thigh: .92 },
  average: { width: 1, depth: 1, belly: 0, shoulder: 0, thigh: 1 },
  stocky: { width: 1.20, depth: 1.18, belly: .025, shoulder: .035, thigh: 1.10 },
  heavy: { width: 1.47, depth: 1.43, belly: .085, shoulder: .085, thigh: 1.20 },
} as const;
const DERIVED_ATTRIBUTES = ['aCloth', 'aHeadwear', 'aRobeCovered', 'aWardrobe', 'aWardrobePoint', 'aWardrobeBody', 'aWardrobeOldSkirt'];

interface CachedGeometry { geometry: THREE.BufferGeometry; references: number; touched: number }
interface MeshBinding {
  mesh: THREE.SkinnedMesh;
  source: THREE.BufferGeometry;
  cached: CachedGeometry;
  box: THREE.Box3 | null;
  sphere: THREE.Sphere | null;
}
interface ModelBinding {
  scale: THREE.Vector3;
  position: THREE.Vector3;
  meshes: MeshBinding[];
}

// Three initializes these caches to null; its r169 declarations omit null.
function setSkinBounds(mesh: THREE.SkinnedMesh, box: THREE.Box3 | null, sphere: THREE.Sphere | null): void {
  const bounds = mesh as unknown as { boundingBox: THREE.Box3 | null; boundingSphere: THREE.Sphere | null };
  bounds.boundingBox = box;
  bounds.boundingSphere = sphere;
}

/** Twenty-four subtle head forms; hats retain their authored brim silhouette. */
export function characterFaceMorph(index: number): CharacterFaceMorph {
  const n = ((Math.trunc(index) % 24) + 24) % 24;
  return {
    width: [.91, 1, 1.09][n % 3],
    jawWidth: [.91, 1.06][Math.floor(n / 3) % 2],
    length: [.95, 1.05][Math.floor(n / 6) % 2],
    nose: [.92, 1.10][Math.floor(n / 12) % 2],
    cheeks: [.96, 1.05][Math.floor(n / 4) % 2],
  };
}

/** Layer-owned, reference-counted body geometry. Live and spare rigs keep their
 * geometry until release; only unused entries can be evicted. Source assets,
 * skin weights, UVs and animation tracks are never modified. */
export class CharacterMorphologyCache {
  private geometries = new Map<string, CachedGeometry>();
  private bindings = new Map<THREE.Object3D, ModelBinding>();
  private clock = 0;

  constructor(private readonly capacity = 256) {}

  /** Apply in the normalized reference pose, before equipment is attached.
   * Returns false when the bounded cache is fully occupied by live rigs. */
  apply(model: THREE.Object3D, appearance: CharacterMorphology): boolean {
    this.release(model);
    model.updateWorldMatrix(true, true);
    const scale = model.scale.clone(), position = model.position.clone();
    const indexed = characterFaceMorph(appearance.faceIndex);
    // Catalog presets also carry descriptive id/sex fields. Only numeric
    // shape parameters belong in deformation and its cache signature.
    const face: CharacterFaceMorph = {
      width: appearance.face?.width ?? indexed.width,
      jawWidth: appearance.face?.jawWidth ?? indexed.jawWidth,
      length: appearance.face?.length ?? indexed.length,
      nose: appearance.face?.nose ?? indexed.nose,
      cheeks: appearance.face?.cheeks ?? indexed.cheeks,
    };
    for (const key of Object.keys(face) as (keyof CharacterFaceMorph)[])
      face[key] = THREE.MathUtils.clamp(face[key], .80, 1.25);
    const meshes: THREE.SkinnedMesh[] = [];
    model.traverse(child => { if (child instanceof THREE.SkinnedMesh) meshes.push(child); });
    if (!meshes.length) return false;

    // Build proportions from the imported, animation-independent bind pose.
    // The GLB can be centimetre-authored; frame * mesh.matrixWorld converts it
    // into the normalized actor's metres. No sampled bone matrix is consulted.
    const reference = wardrobeBodyMesh(model) ?? meshes[0];
    const allBounds = new THREE.Box3();
    const p = new THREE.Vector3();
    // Vertex attributes are in geometry space, converted to the skeleton's
    // authored bind frame with bindMatrix, not the moving GLB root transform.
    for (const mesh of meshes) {
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(mesh.bindMatrix);
        allBounds.expandByPoint(p);
      }
    }
    const height = allBounds.max.y - allBounds.min.y;
    if (!Number.isFinite(height) || height <= 0) return false;
    const head = bindBonePoint(reference, 'head', new THREE.Matrix4())
      ?? new THREE.Vector3(0, allBounds.min.y + height * .89, 0);
    const hips = bindBonePoint(reference, 'hips', new THREE.Matrix4())
      ?? new THREE.Vector3(0, allBounds.min.y + height * .54, 0);
    const headFront = bindBonePoint(reference, 'headfront', new THREE.Matrix4());
    const front = headFront ? headFront.sub(head) : new THREE.Vector3(0, 0, 1);
    front.y = 0;
    if (front.lengthSq() < .000001) front.set(0, 0, 1);
    front.normalize();
    const side = new THREE.Vector3(front.z, 0, -front.x);
    // Equipment attributes are fitted per morphed geometry and later discarded.
    const heightScale = THREE.MathUtils.clamp(appearance.heightScale, .88, 1.12);
    const signature = `${appearance.build}:${heightScale}:${Object.values(face).map(value => value.toFixed(4)).join(':')}`;
    const pending = meshes.map(mesh => ({ mesh, key: `${mesh.geometry.uuid}:${scale.toArray().join(',')}:${signature}` }));
    const pendingKeys = new Set(pending.map(entry => entry.key));
    const required = new Set(pending.filter(entry => !this.geometries.has(entry.key)).map(entry => entry.key)).size;
    const unused = [...this.geometries.entries()].filter(([key, entry]) => entry.references === 0 && !pendingKeys.has(key))
      .sort((a, b) => a[1].touched - b[1].touched);
    while (this.geometries.size + required > this.capacity && unused.length) {
      const [key, entry] = unused.shift()!;
      this.geometries.delete(key);
      entry.geometry.dispose();
    }
    if (this.geometries.size + required > this.capacity) return false;

    const binding: ModelBinding = { scale, position, meshes: [] };
    for (const { mesh, key } of pending) {
      let cached = this.geometries.get(key);
      if (!cached) {
        cached = { geometry: morphedGeometry(mesh, appearance.build, face, height, head, hips, front, side),
          references: 0, touched: ++this.clock };
        this.geometries.set(key, cached);
      }
      cached.references++;
      cached.touched = ++this.clock;
      binding.meshes.push({ mesh, source: mesh.geometry, cached,
        box: mesh.boundingBox?.clone() ?? null, sphere: mesh.boundingSphere?.clone() ?? null });
      mesh.geometry = cached.geometry;
      setSkinBounds(mesh, null, null);
    }

    // Shoulder width is deformed in bind space alongside the torso. Never
    // patch bone.updateMatrix: weapons must follow their original hand bones.
    model.scale.y = scale.y * heightScale;
    model.position.y = position.y * heightScale;
    this.bindings.set(model, binding);
    model.userData.characterMorphology = { build: appearance.build, heightScale, faceIndex: appearance.faceIndex };
    model.updateMatrixWorld(true);
    return true;
  }

  /** Restore before destroying or reassigning a rig; equipment may be disposed first. */
  release(model: THREE.Object3D): void {
    const binding = this.bindings.get(model);
    if (!binding) return;
    for (const { mesh, source, cached, box, sphere } of binding.meshes) {
      mesh.geometry = source;
      setSkinBounds(mesh, box, sphere);
      cached.references--;
      cached.touched = ++this.clock;
    }
    model.scale.copy(binding.scale);
    model.position.copy(binding.position);
    delete model.userData.characterMorphology;
    this.bindings.delete(model);
    model.updateMatrixWorld(true);
  }

  get size(): number { return this.geometries.size; }
  get referenceCount(): number { return [...this.geometries.values()].reduce((sum, value) => sum + value.references, 0); }

  dispose(): void {
    for (const model of this.bindings.keys()) this.release(model);
    for (const entry of this.geometries.values()) entry.geometry.dispose();
    this.geometries.clear();
  }
}

function morphedGeometry(mesh: THREE.SkinnedMesh, build: CharacterBuild, face: CharacterFaceMorph,
  height: number, head: THREE.Vector3, hips: THREE.Vector3,
  front: THREE.Vector3, side: THREE.Vector3): THREE.BufferGeometry {
  const source = mesh.geometry, geometry = source.clone();
  for (const name of DERIVED_ATTRIBUTES) geometry.deleteAttribute(name);
  const position = geometry.getAttribute('position');
  const indices = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight');
  // This is the only mapping used for both directions. Inverting a weighted
  // sum of bone matrices is not valid: it may be nearly singular at joints.
  const bindInverse = mesh.bindMatrix.clone().invert();
  const point = new THREE.Vector3(), offset = new THREE.Vector3(), delta = new THREE.Vector3();
  const profile = BUILDS[build];
  const shoulderY = head.y - height * .17;
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix);
    let torso = 0, thigh = 0, faceWeight = 0, shoulderWeight = 0;
    for (let slot = 0; slot < 4; slot++) {
      const weight = weights.getComponent(index, slot);
      if (weight <= 0) continue;
      const joint = indices.getComponent(index, slot);
      const name = mesh.skeleton.bones[joint]?.name ?? '';
      if (/^(hips|spine\\d*)$/i.test(name)) torso += weight;
      if (/^(left|right)upleg$/i.test(name)) thigh += weight;
      if (/^(head|neck|head_end|headfront)$/i.test(name)) faceWeight += weight;
      if (/^(left|right)(shoulder|arm)$/i.test(name)) shoulderWeight += weight;
    }
    offset.copy(point).sub(hips);
    const lateral = offset.dot(side), depth = offset.dot(front);
    const waist = Math.exp(-Math.pow((point.y / height - .57) / .17, 2));
    const legBand = Math.exp(-Math.pow((point.y / height - .39) / .12, 2));
    const widthAmount = (profile.width - 1) * torso * waist + (profile.thigh - 1) * thigh * legBand;
    const depthAmount = (profile.depth - 1) * torso * waist + (profile.thigh - 1) * thigh * legBand;
    delta.copy(side).multiplyScalar(lateral * widthAmount)
      .addScaledVector(front, depth * depthAmount + profile.belly * torso * waist * THREE.MathUtils.smoothstep(depth, -.025, .09));
    // Smoothly widen the shoulder/upper-arm surface, fading to zero before
    // elbows and hands. All attached weapons keep the unmodified hand rig.
    const shoulderBand = Math.exp(-Math.pow((point.y - shoulderY) / (height * .105), 2));
    const outsideNeck = THREE.MathUtils.smoothstep(Math.abs(lateral) / height, .035, .10);
    delta.addScaledVector(side, Math.sign(lateral) * profile.shoulder
      * shoulderBand * outsideNeck * Math.min(1, torso + shoulderWeight));
    point.add(delta);

    if (faceWeight > .01) {
      offset.copy(point).sub(head);
      const faceY = offset.y;
      const inFace = (1 - THREE.MathUtils.smoothstep(faceY, .085, .14)) *
        THREE.MathUtils.smoothstep(faceY, -.13, -.045) * faceWeight;
      const jaw = 1 - THREE.MathUtils.smoothstep(faceY, -.025, .07);
      const width = THREE.MathUtils.lerp(face.width, face.jawWidth, jaw);
      const forward = offset.dot(front), x = offset.dot(side);
      const cheeks = Math.exp(-Math.pow((faceY - .025) / .05, 2));
      point.addScaledVector(side, x * ((width - 1) + (face.cheeks - 1) * cheeks) * inFace);
      point.y += faceY * (face.length - 1) * inFace;
      const nose = Math.exp(-Math.pow((faceY - .025) / .037, 2)) * THREE.MathUtils.smoothstep(forward, .055, .11);
      point.addScaledVector(front, .035 * (face.nose - 1) * nose * inFace);
    }
    point.applyMatrix4(bindInverse);
    position.setXYZ(index, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
