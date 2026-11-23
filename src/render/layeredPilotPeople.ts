import * as THREE from 'three';
import { InstancePool } from './pool';
import { patchInstancedUv } from './materialUv';
import { illustratedPose } from './illustratedAction';
import { illustratedScreenDirection, illustratedWalkFrame } from './illustratedPeople';
import { resolveCharacterWardrobe } from './characterWardrobe';
import { ILLUSTRATED_2D_LAYER_ORDER } from './illustratedCharacterSpec';
import type { IllustratedCharacterRenderer, IllustratedFigureOptions, IllustratedFigurePerson } from './illustratedCharacterRenderer';

const ART = `${import.meta.env.BASE_URL}art/city/layered-pilot`;
const EFFECTS = `${import.meta.env.BASE_URL}art/city/illustrated-action-effects.png`;
const HEIGHT = 2.58, WIDTH = HEIGHT * 256 / 384;
const DIRECTIONS = ['front', 'back', 'left', 'right'];
const LAYERS = ILLUSTRATED_2D_LAYER_ORDER;
const WALK_FRAMES = 4, SHEET_COLUMNS = 5;

type Figure = { person: IllustratedFigurePerson; x: number; y: number; z: number; facing: number;
  phase: number; moving: boolean; options: IllustratedFigureOptions };
interface PilotManifest {
  version: number;
  cell: { width: number; height: number };
  directions: string[];
  frames: number;
  layers: string[];
  atlas: { columns: number; rows: number };
}

/** No silent assumptions about the binary artist output: a bad atlas is an opt-in preview failure. */
export function validLayeredPilotManifest(value: unknown): value is PilotManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<PilotManifest>;
  return m.version === 1 && m.cell?.width === 256 && m.cell.height === 384 &&
    m.frames === WALK_FRAMES && m.atlas?.columns === SHEET_COLUMNS && m.atlas.rows === 4 &&
    Array.isArray(m.directions) && m.directions.join('|') === DIRECTIONS.join('|') &&
    Array.isArray(m.layers) && m.layers.join('|') === LAYERS.join('|');
}

/** Column zero is a hand-authored *standing* pose; columns 1..4 animate walking. */
export function layeredPilotFrame(phase: number, moving: boolean): number {
  return moving ? 1 + illustratedWalkFrame(phase) : 0;
}

/** First character uses eight independently painted vector parts, with five poses per view. */
export class LayeredPilotPeople implements IllustratedCharacterRenderer {
  readonly layers: InstancePool[] = [];
  readonly shadows: InstancePool;
  readonly effects: InstancePool;
  ready = false;
  error: string | null = null;
  private figures: Figure[] = [];
  private textures: THREE.Texture[] = [];
  private effectTexture: THREE.Texture | null = null;
  private disposed = false;
  private visible = false;
  private dusk = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly shadowDummy = new THREE.Object3D();
  private readonly fxDummy = new THREE.Object3D();
  private readonly uv = new THREE.Vector4();
  private readonly tint = new THREE.Color();
  private readonly cameraBack = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();

  constructor(scene: THREE.Scene, capacity: number, private onReady: () => void) {
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const [index, slot] of LAYERS.entries()) {
      const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: .17,
        depthTest: true, depthWrite: true });
      patchInstancedUv(material);
      const pool = new InstancePool(plane, material, capacity, { uv: true, color: true, dynamic: true });
      pool.mesh.name = `layered-pilot-${slot}`;
      // The quads face the same way. Explicit order and a tiny camera-space
      // offset preserve hat-over-hair, sleeves-over-arms, etc. without Z-fighting.
      pool.mesh.renderOrder = 10 + index;
      pool.mesh.visible = false;
      scene.add(pool.mesh);
      this.layers.push(pool);
    }
    plane.dispose();
    const shadowGeometry = new THREE.CircleGeometry(1, 20);
    shadowGeometry.rotateX(-Math.PI / 2);
    this.shadows = new InstancePool(shadowGeometry, new THREE.MeshBasicMaterial({
      color: 0x101016, transparent: true, opacity: .22, depthWrite: false,
    }), capacity, { dynamic: true });
    this.shadows.mesh.name = 'layered-pilot-shadows';
    this.shadows.mesh.visible = false;
    scene.add(this.shadows.mesh);
    const effectPlane = new THREE.PlaneGeometry(1, 1);
    const effectMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide,
      alphaTest: .18, transparent: true, depthWrite: false });
    patchInstancedUv(effectMaterial);
    this.effects = new InstancePool(effectPlane, effectMaterial, capacity * 2, { uv: true, dynamic: true });
    effectPlane.dispose();
    this.effects.mesh.name = 'layered-pilot-action-effects';
    this.effects.mesh.visible = false;
    scene.add(this.effects.mesh);
  }

  async load(): Promise<void> {
    const pending: THREE.Texture[] = [];
    try {
      const response = await fetch(`${ART}/manifest.json`);
      if (!response.ok) throw Error(`Layered pilot manifest: HTTP ${response.status}`);
      const report: unknown = await response.json();
      if (!validLayeredPilotManifest(report)) throw Error('Layered pilot manifest version or layout mismatch');
      const images = await Promise.all([...LAYERS.map(slot => `${ART}/${slot}.png`), EFFECTS]
        .map(path => new THREE.TextureLoader().loadAsync(path)));
      pending.push(...images);
      if (this.disposed) { images.forEach(t => t.dispose()); return; }
      for (let index = 0; index < LAYERS.length; index++) {
        const texture = images[index];
        if (texture.image?.width !== 256 * SHEET_COLUMNS || texture.image?.height !== 384 * DIRECTIONS.length)
          throw Error(`Layered pilot atlas ${LAYERS[index]} has unexpected size`);
      }
      if (images[LAYERS.length].image?.width !== 256 || images[LAYERS.length].image?.height !== 192)
        throw Error('Layered pilot action effects have unexpected size');
      for (const texture of images) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
      }
      for (const [index, pool] of this.layers.entries()) {
        const mat = pool.mesh.material as THREE.MeshBasicMaterial;
        mat.map = images[index]; mat.needsUpdate = true;
      }
      const effect = this.effects.mesh.material as THREE.MeshBasicMaterial;
      effect.map = images[LAYERS.length]; effect.needsUpdate = true;
      this.textures = images.slice(0, LAYERS.length);
      this.effectTexture = images[LAYERS.length];
      this.ready = true;
      this.setVisible(this.visible);
      this.setDusk(this.dusk);
      this.onReady();
    } catch (err) {
      pending.forEach(x => x.dispose());
      if (!this.disposed) this.error = String(err);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const layer of this.layers) layer.mesh.visible = visible && this.ready;
    this.shadows.mesh.visible = visible && this.ready;
    this.effects.mesh.visible = visible && this.ready;
  }
  setDusk(dusk: number): void {
    this.dusk = dusk;
    for (const pool of this.layers) {
      const strength = 1 - .55 * dusk;
      (pool.mesh.material as THREE.MeshBasicMaterial).color.setRGB(strength,
        strength * (1 - .07 * dusk), strength * (1 - .12 * dusk));
    }
  }
  reset(): void { this.figures.length = 0; }
  push(person: IllustratedFigurePerson, x: number, y: number, z: number, facing: number,
    phase: number, moving: boolean, options: IllustratedFigureOptions = {}): void {
    if (this.ready && this.figures.length < this.layers[0].capacity)
      this.figures.push({person,x,y,z,facing,phase,moving,options});
  }

  draw(camera: THREE.Camera): void {
    if (!this.ready) return;
    for (const layer of this.layers) layer.reset();
    this.shadows.reset(); this.effects.reset();
    this.cameraBack.set(0,0,1).applyQuaternion(camera.quaternion);
    this.cameraUp.set(0,1,0).applyQuaternion(camera.quaternion);
    this.cameraRight.set(1,0,0).applyQuaternion(camera.quaternion);
    const feet = (358 / 384 - .5) * HEIGHT * this.cameraUp.y;
    for (const fig of this.figures) {
      const direction = illustratedScreenDirection(fig.facing, camera);
      const pose = illustratedPose(fig.options.action, fig.options.heldWeapon, fig.options.carrying);
      const frame = layeredPilotFrame(fig.phase, fig.moving && pose.collapse === 0);
      const wardrobe = resolveCharacterWardrobe(fig.person);
      // A deliberate prototype costume: the source silhouette is a suit,
      // NOT an assertion that every available wardrobe has yet been painted.
      const colors = [wardrobe.hair.color, wardrobe.skinColor, wardrobe.outfit.trousersColor,
        wardrobe.skinColor, wardrobe.outfit.coatColor, wardrobe.skinColor,
        wardrobe.hair.color, wardrobe.headwear.color];
      this.uv.set(1 / SHEET_COLUMNS, 1 / DIRECTIONS.length,
        frame / SHEET_COLUMNS, (DIRECTIONS.length - 1 - direction) / DIRECTIONS.length);
      const collapse = pose.collapse;
      const lift = feet * (1 - collapse) + .2 * collapse;
      for (const [layerIndex, pool] of this.layers.entries()) {
        // A one-millimetre spacing toward the camera keeps the overlay order
        // reproducible on different GPUs and in the Tagged camera.
        const depth = layerIndex * .0012;
        this.dummy.position.set(fig.x + this.cameraBack.x * depth,
          fig.y + lift + this.cameraBack.y * depth,
          fig.z + this.cameraBack.z * depth);
        this.dummy.quaternion.copy(camera.quaternion);
        this.dummy.rotateZ(pose.tilt);
        this.dummy.scale.set(WIDTH, HEIGHT * (1 - collapse * .65), 1);
        this.dummy.updateMatrix();
        this.tint.setHex(colors[layerIndex]).multiplyScalar(pose.darken);
        pool.push(this.dummy.matrix, this.tint, this.uv);
      }
      this.shadowDummy.position.set(fig.x, fig.y+.02, fig.z);
      this.shadowDummy.rotation.set(0,0,0);
      this.shadowDummy.scale.set(.43,1,.3);
      this.shadowDummy.updateMatrix();
      this.shadows.push(this.shadowDummy.matrix);
      if (pose.burst != null) {
        const ix = pose.burst;
        this.fxDummy.position.set(fig.x + this.cameraRight.x * .3 + this.cameraUp.x * .9,
          fig.y + this.cameraRight.y * .3 + this.cameraUp.y * .9,
          fig.z + this.cameraRight.z * .3 + this.cameraUp.z * .9);
        this.fxDummy.quaternion.copy(camera.quaternion);
        this.fxDummy.scale.set(.36,.36,1);
        this.fxDummy.updateMatrix();
        this.uv.set(.25,1/3,ix%4/4,(2-Math.floor(ix/4))/3);
        this.effects.push(this.fxDummy.matrix, undefined, this.uv);
      }
    }
    this.layers.forEach(layer=>layer.commit());
    this.shadows.commit(); this.effects.commit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of this.layers) { layer.mesh.removeFromParent(); layer.dispose(); }
    this.shadows.mesh.removeFromParent(); this.effects.mesh.removeFromParent();
    this.shadows.dispose(); this.effects.dispose();
    this.textures.forEach(t=>t.dispose());
    this.effectTexture?.dispose();
    this.textures = []; this.effectTexture = null; this.ready = false;
  }
}
