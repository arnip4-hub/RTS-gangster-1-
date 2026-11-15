import * as THREE from 'three';
import type { CharacterWardrobe } from './characterWardrobe';

/** A mask is stored on the shared rest geometry rather than sampled from an
 * actor's animated pose every frame. Texture colour refines the skin mask so
 * eyes, eyebrows, shirt cuffs and hair retain their authored detail. */
export function prepareWardrobeMask(mesh: THREE.SkinnedMesh): void {
  if (mesh.geometry.hasAttribute('aWardrobe')) return;
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) return;
  const mask = new Float32Array(indices.count * 4);
  const points = new Float32Array(indices.count * 3);
  const bodyMask = new Float32Array(indices.count);
  const oldSkirt = new Float32Array(indices.count);
  const head = mesh.skeleton.bones.find(b => b.name === 'Head')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0,1.60,0);
  const headY = head.y, headUnit = headY / 1.60;
  const hipY = mesh.skeleton.bones.find(b => b.name === 'Hips')?.getWorldPosition(new THREE.Vector3()).y ?? .95;
  const legAxes = ['Left', 'Right'].flatMap(side => {
    const knee = mesh.skeleton.bones.find(b => b.name === side + 'Leg');
    const foot = mesh.skeleton.bones.find(b => b.name === side + 'Foot');
    return knee && foot ? [{ knee: knee.getWorldPosition(new THREE.Vector3()), foot: foot.getWorldPosition(new THREE.Vector3()) }] : [];
  });
  const point = new THREE.Vector3();
  for (let i = 0; i < indices.count; i++) {
    let exposed = 0, legs = 0, clothing = 0, body = 0;
    for (let j = 0; j < 4; j++) {
      const name = mesh.skeleton.bones[indices.getComponent(i, j)]?.name ?? '';
      const weight = weights.getComponent(i, j);
      if (/^(Head|Neck|(?:Left|Right)Hand)$/.test(name)) exposed += weight;
      if (/^(Hips|(?:Left|Right)(?:UpLeg|Leg))$/.test(name)) legs += weight;
      if (/^(Hips|Spine\d*|(?:Left|Right)(?:UpLeg|Leg|Arm|ForeArm|Shoulder))$/.test(name)) clothing += weight;
      if (/^(Hips|Spine\d*|(?:Left|Right)(?:UpLeg|Leg))$/.test(name)) body += weight;
    }
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
    points.set(point.toArray(), i * 3);
    mask[i * 4] = THREE.MathUtils.smoothstep(exposed, .55, .95);
    mask[i * 4 + 1] = THREE.MathUtils.smoothstep(legs, .5, .95) * (1 - THREE.MathUtils.smoothstep(point.y, hipY - .04, hipY + .14));
    mask[i * 4 + 2] = THREE.MathUtils.smoothstep(clothing, .5, .95);
    const brim = exposed > .55 && point.y > headY + .015 * headUnit &&
      (Math.abs(point.x - head.x) > .132 * headUnit || Math.abs(point.z - head.z) > .145 * headUnit);
    mask[i * 4 + 3] = point.y > headY + .075 * headUnit || brim ? 1 : 0;
    bodyMask[i] = THREE.MathUtils.smoothstep(body, .7, .99);
    if (point.y > .17 * headUnit && point.y < .78 * headUnit && body > .5 && legAxes.length) {
      let distance = Infinity;
      for (const { knee, foot } of legAxes) {
        if (Math.abs(foot.y - knee.y) < .05) continue;
        const along = THREE.MathUtils.clamp((point.y - knee.y) / (foot.y - knee.y), -.25, 1.25);
        const x = THREE.MathUtils.lerp(knee.x, foot.x, along), z = THREE.MathUtils.lerp(knee.z, foot.z, along);
        distance = Math.min(distance, Math.hypot(point.x - x, point.z - z));
      }
      // A real calf follows one shin; the old skirt's wide fins sit outside
      // both leg axes. The measure is independent of its painted colour.
      if (Number.isFinite(distance)) oldSkirt[i] = THREE.MathUtils.smoothstep(distance / headUnit, .075, .115);
    }
  }
  mesh.geometry.setAttribute('aWardrobe', new THREE.Float32BufferAttribute(mask, 4));
  mesh.geometry.setAttribute('aWardrobePoint', new THREE.Float32BufferAttribute(points, 3));
  mesh.geometry.setAttribute('aWardrobeBody', new THREE.Float32BufferAttribute(bodyMask, 1));
  mesh.geometry.setAttribute('aWardrobeOldSkirt', new THREE.Float32BufferAttribute(oldSkirt, 1));
}

/** Values belong to one rig; pooled rigs may safely take another identity. */
export class WardrobeMaterialState {
  readonly enabled = { value: 0 };
  readonly coat = { value: new THREE.Color() };
  readonly trousers = { value: new THREE.Color() };
  readonly skin = { value: new THREE.Color() };
  readonly pattern = { value: 0 };
  readonly bareLegs = { value: 0 };
  readonly outerHem = { value: 0 };

  set(wardrobe?: CharacterWardrobe): void {
    this.enabled.value = wardrobe ? 1 : 0;
    if (!wardrobe) { this.outerHem.value = 0; return; }
    this.coat.value.setHex(wardrobe.outfit.coatColor);
    this.trousers.value.setHex(wardrobe.outfit.trousersColor);
    this.skin.value.setHex(wardrobe.skinColor);
    this.pattern.value = ['plain', 'pinstripe', 'tweed', 'check'].indexOf(wardrobe.outfit.pattern);
    this.bareLegs.value = wardrobe.body.sex === 'female' ? 1 : 0;
  }

  patch(shader: Parameters<THREE.Material['onBeforeCompile']>[0]): void {
    Object.assign(shader.uniforms, {
      paintedWardrobe: this.enabled,
      paintedCoat: this.coat,
      paintedTrousers: this.trousers,
      paintedSkin: this.skin,
      paintedPattern: this.pattern,
      paintedBareLegs: this.bareLegs,
      paintedOuterHem: this.outerHem,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aWardrobe;
        attribute vec3 aWardrobePoint;
        attribute float aWardrobeBody;
        attribute float aWardrobeOldSkirt;
        varying vec4 vWardrobe;
        varying vec3 vWardrobePoint;
        varying float vWardrobeBody;`)
      .replace('varying float vWardrobeBody;', 'varying float vWardrobeBody;\n varying float vWardrobeOldSkirt;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWardrobe = aWardrobe;
        vWardrobePoint = aWardrobePoint;
        vWardrobeBody = aWardrobeBody;
        vWardrobeOldSkirt = aWardrobeOldSkirt;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vWardrobe;
        varying vec3 vWardrobePoint;
        varying float vWardrobeBody;
        varying float vWardrobeOldSkirt;
        uniform float paintedWardrobe;
        uniform vec3 paintedCoat;
        uniform vec3 paintedTrousers;
        uniform vec3 paintedSkin;
        uniform float paintedPattern;`)
      .replace('uniform float paintedPattern;', 'uniform float paintedPattern;\n uniform float paintedBareLegs;')
      .replace('uniform float paintedBareLegs;', 'uniform float paintedBareLegs;\n uniform float paintedOuterHem;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (paintedWardrobe > 0.5) {
          vec3 sourcePaint = diffuseColor.rgb;
          float sourceLight = dot(sourcePaint, vec3(.2126, .7152, .0722));
          // Warm authored skin is recoloured only on head/neck/hand vertices.
          // Neutral white eyes and shirt cuffs, dark pupils and hair survive.
          float warmSkin = smoothstep(.018, .075, sourcePaint.r - sourcePaint.g)
            * smoothstep(.008, .055, sourcePaint.g - sourcePaint.b)
            * smoothstep(.035, .12, sourceLight);
          // The old woman's authored skirt can protrude around a shorter new
          // skirt during a stride. Its cloth is removed below the waist per
          // fragment; real calf skin and leather shoes remain intact.
          if (paintedBareLegs > .5 && paintedOuterHem > 0.0
            && vWardrobePoint.y > .17 && vWardrobePoint.y < .90
            && vWardrobeBody > .25 && (warmSkin < .15 || vWardrobeOldSkirt > .45)) discard;
          float calf = paintedBareLegs * clamp(vWardrobe.y, 0.0, 1.0)
            * smoothstep(.12, .22, vWardrobePoint.y)
            * (1.0 - smoothstep(.65, .85, vWardrobePoint.y));
          float skinAmount = clamp(max(vWardrobe.x, calf), 0.0, 1.0) * warmSkin
            * (1.0 - clamp(vWardrobe.w, 0.0, 1.0));
          vec3 skinPaint = paintedSkin * clamp(.70 + sourceLight * .85, .72, 1.18);
          diffuseColor.rgb = mix(diffuseColor.rgb, skinPaint, skinAmount);
          float whiteShirt = smoothstep(.40, .68, sourceLight);
          float clothAmount = clamp(vWardrobe.z, 0.0, 1.0) * (1.0 - skinAmount) * (1.0 - whiteShirt);
          vec3 clothPaint = mix(paintedCoat, paintedTrousers, clamp(vWardrobe.y, 0.0, 1.0));
          // The painted albedo supplies folds; identity colours remain wool,
          // not metallic highlights or a flat luminous replacement.
          clothPaint *= .62 + .92 * sqrt(clamp(sourceLight, 0.0, 1.0));
          float weave = 0.0;
          if (paintedPattern > .5 && paintedPattern < 1.5)
            weave = smoothstep(.90, .98, sin(vWardrobePoint.x * 150.0)) * .15;
          else if (paintedPattern > 1.5 && paintedPattern < 2.5)
            weave = sin((vWardrobePoint.x + vWardrobePoint.y) * 280.0)
              * sin((vWardrobePoint.x - vWardrobePoint.y) * 260.0) * .065;
          else if (paintedPattern > 2.5)
            weave = (smoothstep(.88, .97, sin(vWardrobePoint.x * 66.0))
              + smoothstep(.88, .97, sin(vWardrobePoint.y * 66.0))) * .10;
          // Fade fine weave once a pattern is smaller than a screen pixel.
          weave *= 1.0 - smoothstep(.008, .035, length(fwidth(vWardrobePoint.xy)));
          clothPaint *= 1.0 + weave;
          diffuseColor.rgb = mix(diffuseColor.rgb, clothPaint, clothAmount * .94);
        }`);
  }
}
