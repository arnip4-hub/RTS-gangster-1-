import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ResolvedCharacterWardrobe } from './characterWardrobe';
import { actorFromBind, bindBonePoint, skinGarmentToBody, wardrobeBodyMesh } from './characterBindSpace';

export interface WardrobeGarments {
  meshes: THREE.Object3D[];
  hidesSourceHat: boolean;
  hidesSourceBody: boolean;
  /** Lowest point covered by the clothing shell, in actor coordinates. */
  bodyHem: number;
  /** Retain the painted source torso above the garment's fitted waist. */
  bodyTop: number;
  /** Update rigid fittings in the actor's metre-sized coordinate frame. */
  sync(): void;
  dispose(): void;
}

interface Part { geometry: THREE.BufferGeometry; color: number }

/** A few merged accessories and one pelvis-following lower garment give the wardrobe
 * real silhouettes. Geometry is in the normalized actor's metre coordinates,
 * never in the imported skeleton's centimetres. */
export function createWardrobeGarments(
  model: THREE.Object3D, wardrobe: ResolvedCharacterWardrobe,
  rest: ReadonlyMap<string, THREE.Matrix4>, restPositions: ReadonlyMap<string, THREE.Vector3>,
): WardrobeGarments {
  const group = model.parent instanceof THREE.Group ? model.parent : model;
  const meshes: THREE.Object3D[] = [], geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const followers: { mesh: THREE.Mesh; bone: THREE.Bone; restInverse: THREE.Matrix4 }[] = [];
  const bones = new Map<string, THREE.Bone>();
  model.traverse(node => { if (node instanceof THREE.Bone) bones.set(node.name, node); });
  const bodyMesh = wardrobeBodyMesh(model);
  const head = bodyMesh
    ? bindBonePoint(bodyMesh, 'Head', actorFromBind(bodyMesh, group)) ?? restPositions.get('Head')
    : restPositions.get('Head');
  // Body height choices are applied to the actor root. The rest-position ratio
  // only fits the different authored male/female skeletons.
  const heightScale = wardrobe.heightScale;
  const unit = head ? head.y / (1.58 * heightScale) : 1;
  const width = wardrobe.body.widthScale, depth = wardrobe.body.depthScale;
  const shoulder = wardrobe.body.shoulderScale;
  const skin = wardrobe.skinColor;
  let headWidthFit = 1;
  if (head) {
    // Imported heads differ considerably. Measure the face below the source
    // hat line so short hair does not become a second, wider head.
    const bounds = new THREE.Box3(), point = new THREE.Vector3();
    model.traverse(node => {
      if (!(node instanceof THREE.SkinnedMesh)) return;
      const joint = node.skeleton.bones.findIndex(bone => bone.name === 'Head');
      const indices = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight');
      if (joint < 0 || !indices || !weights) return;
      for (let i = 0; i < indices.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) if (indices.getComponent(i, j) === joint) weight += weights.getComponent(i, j);
        if (weight < .8) continue;
        node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld);
        if (point.y >= head.y - .055 * unit && point.y <= head.y + .055 * unit) bounds.expandByPoint(point);
      }
    });
    if (!bounds.isEmpty()) headWidthFit = THREE.MathUtils.clamp(
      (bounds.max.x - bounds.min.x) / (.19 * unit * wardrobe.face.width), .68, 1.15);
  }

  function merged(parts: Part[]): THREE.BufferGeometry {
    const prepared = parts.map(({ geometry, color }) => {
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      const value = new THREE.Color(color), count = flat.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) value.toArray(colors, i * 3);
      flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return flat;
    });
    const result = mergeGeometries(prepared, false)!;
    prepared.forEach(geometry => geometry.dispose());
    geometries.push(result);
    return result;
  }
  function accessory(parts: Part[], name: string, boneName: string): void {
    const bone = bones.get(boneName), bind = rest.get(boneName);
    if (!parts.length || !bone || !bind) { parts.forEach(p => p.geometry.dispose()); return; }
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 });
    materials.push(material);
    const geometry = merged(parts);
    if (boneName === 'Head' && head) {
      geometry.translate(-head.x, -head.y, -head.z);
      geometry.scale(wardrobe.face.width * headWidthFit, heightScale * wardrobe.face.length,
        (wardrobe.face.width + wardrobe.face.length) / 2 * headWidthFit);
      geometry.translate(head.x, head.y, head.z);
    } else geometry.scale(1, heightScale, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `wardrobe-${name}`; mesh.userData.wardrobe = true;
    mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    mesh.raycast = () => {};
    // Keep vertices in the normalized actor's metre-sized frame. Convert the
    // bone's current pose relative to its rest pose each frame, rather than
    // baking large source-rig inverse scales into the clothing vertices.
    mesh.matrixAutoUpdate = false;
    group.add(mesh); meshes.push(mesh);
    followers.push({ mesh, bone, restInverse: bind.clone().invert() });
  }
  function ellipsoid(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): Part {
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    geometry.scale(sx, sy, sz); geometry.translate(x, y, z);
    return { geometry, color };
  }
  function cylinder(x: number, y: number, z: number, rt: number, rb: number, h: number,
    sx: number, sz: number, color: number, segments = 16): Part {
    const geometry = new THREE.CylinderGeometry(rt, rb, h, segments);
    geometry.scale(sx, 1, sz); geometry.translate(x, y, z);
    return { geometry, color };
  }

  if (head) {
    const parts: Part[] = [], hair = wardrobe.hair, hat = wardrobe.headwear;
    const x = head.x, y = head.y, z = head.z;
    // The scalp cap replaces the source hat's removed crown. Even a bald
    // identity keeps a closed head rather than exposing a hole under a brim.
    const hairColor = hair.style === 'bald' || hair.style === 'balding' ? skin : hair.color;
    const scalp = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * .6);
    scalp.scale(.098 * unit, .10 * unit, .10 * unit);
    scalp.translate(x, y + .065 * unit, z - .006 * unit);
    parts.push({ geometry: scalp, color: hairColor });
    if (hair.style === 'bob' || hair.style === 'wave' || hair.style === 'curl') {
      parts.push(ellipsoid(x, y + .02 * unit, z - .058 * unit,
        .108 * unit, .11 * unit, .063 * unit, hair.color));
      for (const side of [-1, 1]) parts.push(ellipsoid(x + side * .091 * unit, y + .038 * unit, z - .029 * unit,
        .021 * unit, .078 * unit, .044 * unit, hair.color));
    }
    if (hair.style === 'bun') parts.push(ellipsoid(x, y + .085 * unit, z - .132 * unit,
      .067 * unit, .06 * unit, .045 * unit, hair.color));
    if (hair.style === 'short') parts.push(ellipsoid(x, y + .167 * unit, z + .033 * unit,
      .083 * unit, .026 * unit, .072 * unit, hair.color));
    if (hair.style === 'slick') {
      parts.push(ellipsoid(x, y + .16 * unit, z - .028 * unit,
        .088 * unit, .022 * unit, .095 * unit, hair.color));
      parts.push(ellipsoid(x + .035 * unit, y + .159 * unit, z + .044 * unit,
        .05 * unit, .016 * unit, .047 * unit, new THREE.Color(hair.color).multiplyScalar(.75).getHex()));
    }
    if (hair.style === 'parted' || hair.style === 'wave' || hair.style === 'curl')
      parts.push(ellipsoid(x - .035 * unit, y + .169 * unit, z + .018 * unit,
        .07 * unit, .023 * unit, .085 * unit, hair.color));
    if (hair.style === 'balding') {
      for (const side of [-1, 1]) parts.push(ellipsoid(x + side * .086 * unit, y + .068 * unit, z - .034 * unit,
        .014 * unit, .043 * unit, .048 * unit, hair.color));
      parts.push(ellipsoid(x, y + .087 * unit, z - .096 * unit,
        .087 * unit, .049 * unit, .026 * unit, hair.color));
    }
    const brim = .17 * unit * hat.brimScale, crown = .113 * unit * hat.crownScale;
    const bottom = y + .11 * unit, dark = new THREE.Color(hat.color).multiplyScalar(.48).getHex();
    switch (hat.kind) {
      case 'fedora': case 'trilby':
        parts.push(cylinder(x, bottom, z, brim, brim, .014 * unit, 1, .86, hat.color));
        parts.push(cylinder(x, bottom + .043 * unit, z, crown * .72, crown, .083 * unit, 1, .9, hat.color));
        parts.push(cylinder(x, bottom + .015 * unit, z, crown * 1.006, crown * 1.006, .025 * unit, 1, .9, dark));
        break;
      case 'bowler':
        parts.push(cylinder(x, bottom, z, brim, brim, .017 * unit, 1, .88, hat.color));
        parts.push(ellipsoid(x, bottom + .045 * unit, z, crown, .104 * unit, crown * .9, hat.color));
        parts.push(cylinder(x, bottom + .014 * unit, z, crown, crown, .022 * unit, 1, .92, dark));
        break;
      case 'flatCap':
        parts.push(ellipsoid(x, bottom + .022 * unit, z, .131 * unit, .052 * unit, .139 * unit, hat.color));
        parts.push(ellipsoid(x, bottom - .012 * unit, z + .104 * unit, .11 * unit, .009 * unit, .073 * unit, dark));
        break;
      case 'straw':
        parts.push(cylinder(x, bottom, z, brim, brim, .014 * unit, 1, .9, hat.color));
        parts.push(cylinder(x, bottom + .049 * unit, z, crown, crown, .10 * unit, 1, .9, hat.color));
        parts.push(cylinder(x, bottom + .016 * unit, z, crown * 1.015, crown * 1.015, .027 * unit, 1, .9, dark));
        break;
      case 'cloche':
        parts.push(ellipsoid(x, bottom + .008 * unit, z, .117 * unit, .088 * unit, .113 * unit, hat.color));
        parts.push(cylinder(x, bottom - .02 * unit, z + .008 * unit, brim * .91, brim, .018 * unit, 1, .86, hat.color));
        break;
      case 'beret':
        parts.push(ellipsoid(x - .035 * unit, bottom + .026 * unit, z, .156 * unit, .055 * unit, .139 * unit, hat.color));
        parts.push(cylinder(x, bottom - .012 * unit, z, crown, crown, .023 * unit, 1, .9, dark));
        break;
      case 'brimmed':
        parts.push(cylinder(x, bottom, z, brim * 1.1, brim * 1.12, .014 * unit, 1, .9, hat.color));
        parts.push(ellipsoid(x, bottom + .055 * unit, z, crown, .075 * unit, crown * .94, hat.color));
        break;
      case 'pillbox':
        parts.push(cylinder(x + .024 * unit, bottom + .047 * unit, z, crown * .88, crown * .98, .075 * unit, 1, .9, hat.color));
        break;
      case 'uniformCap':
        parts.push(cylinder(x, bottom + .03 * unit, z, crown * 1.13, crown, .072 * unit, 1, .95, hat.color));
        parts.push(ellipsoid(x, bottom, z + .105 * unit, .115 * unit, .012 * unit, .082 * unit, dark));
        parts.push(ellipsoid(x, bottom + .031 * unit, z + .107 * unit, .018 * unit, .023 * unit, .006 * unit, 0xc8ad63));
        break;
      case 'fireHelmet':
        parts.push(ellipsoid(x, bottom + .04 * unit, z - .015 * unit, .134 * unit, .105 * unit, .143 * unit, hat.color));
        parts.push(cylinder(x, bottom - .015 * unit, z - .026 * unit, brim * 1.03, brim * 1.03, .018 * unit, 1, 1.08, hat.color));
        parts.push(ellipsoid(x, bottom + .05 * unit, z + .123 * unit, .034 * unit, .048 * unit, .009 * unit, 0xbca265));
        break;
      case 'none': break;
    }
    accessory(parts, 'headwear', 'Head');
  }

  const collarParts: Part[] = [];
  const collarY = 1.445 * unit, collarZ = .12 * unit;
  const accent = wardrobe.outfit.accentColor;
  if (wardrobe.outfit.collar === 'fur') {
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * .16 + i / 8 * Math.PI * 1.68;
      collarParts.push(ellipsoid(Math.sin(angle) * .17 * shoulder, collarY - .02 * unit,
        Math.cos(angle) * .105 * depth, .066 * unit, .053 * unit, .052 * unit,
        new THREE.Color(accent).multiplyScalar(i % 2 ? .83 : 1).getHex()));
    }
  } else if (wardrobe.outfit.collar === 'scarf') {
    collarParts.push(cylinder(0, collarY + .018 * unit, 0, .088 * unit, .10 * unit, .07 * unit, 1, 1, accent));
    const geometry = new THREE.BoxGeometry(.073 * unit, .25 * unit, .024 * unit);
    geometry.rotateZ(-.12); geometry.translate(-.046 * unit, collarY - .12 * unit, .15 * depth);
    collarParts.push({ geometry, color: accent });
  } else if (wardrobe.outfit.collar === 'bow') {
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape(); shape.moveTo(side * .005, 0);
      shape.lineTo(side * .045, .021); shape.lineTo(side * .043, -.023); shape.lineTo(side * .005, 0);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: .006, bevelEnabled: false });
      geometry.scale(unit, unit, unit); geometry.translate(0, collarY - .026 * unit, collarZ + .017 * unit);
      collarParts.push({ geometry, color: accent });
    }
    collarParts.push(ellipsoid(0, collarY - .026 * unit, collarZ + .019 * unit,
      .011 * unit, .014 * unit, .007 * unit, accent));
  } else if (wardrobe.outfit.collar === 'tie') {
    const geometry = new THREE.ConeGeometry(.025 * unit, .19 * unit, 4);
    geometry.rotateX(Math.PI); geometry.scale(1, 1, .24);
    geometry.translate(0, collarY - .12 * unit, collarZ + .027 * unit);
    collarParts.push({ geometry, color: accent });
  }
  if (collarParts.length) accessory(collarParts, 'collar', 'Spine');

  const shell = ['coat', 'dress', 'robe'].includes(wardrobe.outfit.silhouette);
  const openCoat = wardrobe.body.sex === 'male' && wardrobe.outfit.silhouette === 'coat';
  let bodyHem = Infinity;
  let bodyTop = -Infinity;
  if (shell) {
    const hips = bones.get('Hips'), left = bones.get('LeftUpLeg'), right = bones.get('RightUpLeg'), spine = bones.get('Spine');
    if (hips && left && right && spine) {
      const isDress = wardrobe.outfit.silhouette === 'dress', isRobe = wardrobe.outfit.silhouette === 'robe';
      const hem = wardrobe.outfit.length === 'ankle' ? .19 : wardrobe.outfit.length === 'knee' ? .49 : .77;
      bodyHem = hem * unit * heightScale;
      // Keep a generous overlap: a triangle straddling the crop boundary must
      // not leave an open waistband when hips and spine bend differently.
      bodyTop = 1.00 * unit * heightScale;
      const rings = [
        { y: hem, w: isRobe ? .29 : isDress ? .25 : .247, d: isRobe ? .24 : isDress ? .20 : .18 },
        { y: .83, w: isDress ? .221 : .215, d: .172 },
        { y: 1.03, w: isDress ? .17 : .197, d: .137 },
        { y: 1.10, w: isDress ? .17 : .185, d: .137 },
      ].filter((r, i) => i === 0 || r.y > hem + .015);
      const sides = 24, pos: number[] = [], indices: number[] = [];
      const colors: number[] = [], color = new THREE.Color();
      const belly = wardrobe.body.belly;
      rings.forEach((ring, row) => {
        // A man's overcoat has two front panels around visible trousers. A
        // closed circular extension reads as a skirt at the street camera.
        // The opening meets at the waist and widens below the fastening.
        const opening = openCoat ? (1 - THREE.MathUtils.smoothstep(ring.y, .84, 1.10)) * .75 : 0;
        for (let n = 0; n <= sides; n++) {
          const angle = opening + n / sides * (Math.PI * 2 - opening * 2);
          const fold = 1 + .027 * Math.cos(angle * 12);
          const x = Math.sin(angle) * ring.w * width * fold;
          const bellyWeight = Math.max(0, 1 - Math.abs(ring.y - 1.02) / .42);
          const z = Math.cos(angle) * ring.d * depth * fold + Math.max(0, Math.cos(angle)) * belly * bellyWeight;
          pos.push(x * unit, ring.y * unit * heightScale, z * unit);
          // Match the restrained albedo gain of the painted source torso;
          // an unshaded palette colour made skirts look like a separate apron.
          color.setHex(wardrobe.outfit.coatColor).multiplyScalar(.70 + .12 * Math.max(0, Math.cos(angle - .4)));
          color.toArray(colors, colors.length);
          if (row && n) { const a = row * (sides + 1) + n, b = a - sides - 1; indices.push(a - 1, b - 1, b, a - 1, b, a); }
        }
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(indices); geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
      geometries.push(geometry);
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: THREE.DoubleSide });
      const pattern = wardrobe.outfit.pattern;
        material.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGarmentPoint;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGarmentPoint=position;');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGarmentPoint;')
            .replace('#include <color_fragment>', `#include <color_fragment>
              float brush=sin(atan(vGarmentPoint.x,vGarmentPoint.z)*12.0)*.026+sin(vGarmentPoint.y*84.0+vGarmentPoint.x*31.0)*.009;
              diffuseColor.rgb*=.98+brush;
              ${pattern === 'pinstripe'
                ? 'float stitch=1.0-smoothstep(.02,.085,abs(fract(vGarmentPoint.x*35.0)-.5)); diffuseColor.rgb*=.94+stitch*.22;'
                : pattern === 'check'
                  ? 'vec2 grid=abs(fract(vGarmentPoint.xy*18.0)-.5); float stitch=1.0-smoothstep(.025,.09,min(grid.x,grid.y)); diffuseColor.rgb*=.92+stitch*.18;'
                  : pattern === 'tweed' ? 'float stitch=sin(vGarmentPoint.x*610.0+vGarmentPoint.y*480.0)*sin(vGarmentPoint.y*590.0-vGarmentPoint.x*360.0); diffuseColor.rgb*=.98+stitch*.07;' : ''}
            `);
        };
        material.customProgramCacheKey = () => `wardrobe-garment-${pattern}-v1`;
      materials.push(material);
      // Convert the actor-metre shell into this GLB body's bind geometry space.
      // Transfer nearby skin weights and share its exact Skeleton/bindMatrix.
      // No duplicate skeleton and no pelvis-following rigid cylinder.
      if (!bodyMesh) {
        geometry.dispose(); geometries.pop();
        return { meshes, hidesSourceHat: false, hidesSourceBody: false,
          bodyHem: Infinity, bodyTop: -Infinity, sync() {}, dispose() {
            meshes.forEach(mesh => mesh.removeFromParent());
            geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
          } };
      }
      const mesh = skinGarmentToBody(geometry, material, group, bodyMesh);
      mesh.name = `wardrobe-${wardrobe.outfit.silhouette}`; mesh.userData.wardrobe = true;
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false; mesh.raycast = () => {};
      meshes.push(mesh);
    }
  }
  let disposed = false;
  return {
    meshes, hidesSourceHat: !!head && bones.has('Head'),
    // The original trouser body remains behind the open male coat. Closed
    // skirts/dresses replace the covered source geometry as before.
    // Keep the source body intact: skinned garments overlap it in movement.
    hidesSourceBody: false, bodyHem, bodyTop,
    sync() {
      if (disposed || !followers.length) return;
      group.updateWorldMatrix(true, false);
      const actorInverse = group.matrixWorld.clone().invert();
      for (const follower of followers) {
        follower.bone.updateWorldMatrix(true, false);
        follower.mesh.matrix.multiplyMatrices(actorInverse, follower.bone.matrixWorld)
          .multiply(follower.restInverse);
        follower.mesh.matrixWorldNeedsUpdate = true;
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      meshes.forEach(mesh => mesh.removeFromParent());
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    },
  };
}
