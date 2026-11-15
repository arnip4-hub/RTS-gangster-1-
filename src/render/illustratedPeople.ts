import * as THREE from 'three';
import type { Person } from '../sim/types';
import { InstancePool } from './pool';
import { patchInstancedUv } from './materialUv';
import { appearanceIndex, personSkinGroup } from './personAppearance';

const IMAGE = `${import.meta.env.BASE_URL}art/city/illustrated-people-atlas.png`;
const WALK_IMAGE = `${import.meta.env.BASE_URL}art/city/illustrated-people-walk-atlas.png`;
const CELL = 128, COLUMNS = 4, ROWS = 32, HEIGHT = 2.58;
const WALK_ROWS = 12;

/** Stable costume choice without adding visual state to the save format. */
export function illustratedPersonRow(person: Pick<Person, 'id' | 'portrait' | 'female' | 'role'>): number {
  const tone = personSkinGroup(person), variant = appearanceIndex(person);
  if (person.role === 'policeChief') return person.female ? 9 : 6;
  if (person.role === 'police') return person.female ? (tone ? 21 : 9) : (tone ? 20 : 2);
  if (person.role === 'fbiHead') return person.female ? 7 : 3;
  if (person.role === 'fbi') return person.female ? [7, 31, 22][tone] : [3, 23, 11][tone];
  if (person.role === 'mayor') return person.female ? 12 : 15;
  if (person.role === 'judge') return person.female && tone === 0 ? 29
    : person.female ? [12, 13, 17][tone] : [14, 23, 26][tone];
  if (person.role === 'da' || person.role === 'lawyer')
    return person.female ? [12, 13, 17][tone] : [14, 23, 26][tone];
  if (person.role === 'reporter' && !person.female && tone === 2) return 30;
  if (person.role === 'boss' || person.role === 'lieutenant' || person.role === 'hood')
    return person.female ? [1, 28, 5][tone] : [0, 18, 8][tone];
  if (person.female) {
    // Row 16 is reserved for a future actual night-worker occupation; a
    // passing nightlife customer must not be labelled as one by costume.
    const choices = tone === 0 ? [1, 10, 12, 19] : tone === 1 ? [13, 25, 28] : [5, 17, 27];
    return choices[Math.floor(variant / 3) % choices.length];
  }
  const choices = tone === 0 ? [0, 4, 14] : tone === 1 ? [18, 24] : [8, 26];
  return choices[Math.floor(variant / 3) % choices.length];
}

/** Atlas cells run front, back, screen-left, screen-right. */
function screenDirection(facing: number, cameraX: number, cameraZ: number, rightX: number, rightZ: number): number {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const front = fx * cameraX + fz * cameraZ, side = fx * rightX + fz * rightZ;
  return Math.abs(front) >= Math.abs(side) ? (front >= 0 ? 0 : 1) : (side < 0 ? 2 : 3);
}

export function illustratedWalkFrame(phase: number): number {
  return Math.floor((((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 4 / (Math.PI * 2));
}

export function illustratedScreenDirection(facing: number, camera: THREE.Camera): number {
  const towardCamera = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  towardCamera.y = 0;
  towardCamera.normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return screenDirection(facing, towardCamera.x, towardCamera.z, right.x, right.z);
}

interface Figure { person: Pick<Person, 'id' | 'portrait' | 'female' | 'role'>; x: number; y: number; z: number; facing: number; phase: number; moving: boolean }

/** Painted, camera-facing people in one draw batch; actors remain for special animations. */
export class IllustratedPeople {
  readonly sprites: InstancePool;
  readonly walkingSprites: InstancePool;
  readonly shadows: InstancePool;
  ready = false;
  error: string | null = null;
  private figures: Figure[] = [];
  private texture: THREE.Texture | null = null;
  private walkTexture: THREE.Texture | null = null;
  private disposed = false;
  private spriteDummy = new THREE.Object3D();
  private shadowDummy = new THREE.Object3D();
  private uv = new THREE.Vector4();
  private cameraUp = new THREE.Vector3();
  private cameraBack = new THREE.Vector3();
  private cameraRight = new THREE.Vector3();

  constructor(scene: THREE.Scene, capacity: number, private onReady: () => void) {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: .24, depthWrite: true });
    patchInstancedUv(material);
    const plane = new THREE.PlaneGeometry(1, 1);
    this.sprites = new InstancePool(plane, material, capacity, { uv: true, dynamic: true });
    const walkMaterial = material.clone();
    patchInstancedUv(walkMaterial);
    this.walkingSprites = new InstancePool(plane, walkMaterial, capacity, { uv: true, dynamic: true });
    plane.dispose();
    this.sprites.mesh.name = 'illustrated-people';
    this.walkingSprites.mesh.name = 'illustrated-people-walking';
    this.sprites.mesh.visible = false;
    this.walkingSprites.mesh.visible = false;
    scene.add(this.sprites.mesh);
    scene.add(this.walkingSprites.mesh);

    const shade = new THREE.CircleGeometry(1, 16);
    shade.rotateX(-Math.PI / 2);
    this.shadows = new InstancePool(shade, new THREE.MeshBasicMaterial({ color: 0x101016,
      transparent: true, opacity: .24, depthWrite: false }), capacity, { dynamic: true });
    this.shadows.mesh.name = 'illustrated-people-shadows';
    this.shadows.mesh.visible = false;
    scene.add(this.shadows.mesh);
  }

  async load(): Promise<void> {
    let texture: THREE.Texture | null = null;
    let walkTexture: THREE.Texture | null = null;
    try {
      [texture, walkTexture] = await Promise.all([
        new THREE.TextureLoader().loadAsync(IMAGE), new THREE.TextureLoader().loadAsync(WALK_IMAGE),
      ]);
      if (this.disposed) { texture.dispose(); walkTexture.dispose(); return; }
      if (texture.image.width !== CELL * COLUMNS || texture.image.height !== CELL * ROWS)
        throw Error('Illustrated people atlas has an unexpected size');
      if (walkTexture.image.width !== CELL * COLUMNS || walkTexture.image.height !== CELL * WALK_ROWS)
        throw Error('Illustrated walk atlas has an unexpected size');
      for (const image of [texture, walkTexture]) {
        image.colorSpace = THREE.SRGBColorSpace;
        image.minFilter = image.magFilter = THREE.LinearFilter;
        image.generateMipmaps = false;
      }
      (this.sprites.mesh.material as THREE.MeshBasicMaterial).map = texture;
      (this.sprites.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      (this.walkingSprites.mesh.material as THREE.MeshBasicMaterial).map = walkTexture;
      (this.walkingSprites.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      this.texture = texture;
      this.walkTexture = walkTexture;
      this.ready = true;
      this.onReady();
    } catch (error) {
      texture?.dispose();
      walkTexture?.dispose();
      if (!this.disposed) this.error = String(error);
    }
  }

  setVisible(visible: boolean): void {
    this.sprites.mesh.visible = visible && this.ready;
    this.walkingSprites.mesh.visible = visible && this.ready;
    this.shadows.mesh.visible = visible && this.ready;
  }

  setDusk(dusk: number): void {
    const material = this.sprites.mesh.material as THREE.MeshBasicMaterial;
    const strength = 1 - .55 * dusk;
    material.color.setRGB(strength, strength * (1 - .07 * dusk), strength * (1 - .12 * dusk));
    (this.walkingSprites.mesh.material as THREE.MeshBasicMaterial).color.copy(material.color);
  }

  reset(): void { this.figures.length = 0; }

  push(person: Figure['person'], x: number, y: number, z: number, facing: number, phase: number, moving: boolean): void {
    if (this.ready && this.figures.length < this.sprites.capacity)
      this.figures.push({ person, x, y, z, facing, phase, moving });
  }

  /** Recompute orientation for each main or Tagged camera. */
  draw(camera: THREE.Camera): void {
    if (!this.ready) return;
    this.sprites.reset(); this.walkingSprites.reset(); this.shadows.reset();
    this.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.cameraBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
    this.cameraBack.y = 0;
    this.cameraBack.normalize();
    this.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const figure of this.figures) {
      const row = illustratedPersonRow(figure.person);
      const column = screenDirection(figure.facing, this.cameraBack.x, this.cameraBack.z,
        this.cameraRight.x, this.cameraRight.z);
      const walkKind = figure.moving && row <= 2 ? row : -1;
      const bounce = walkKind < 0 && figure.moving ? Math.abs(Math.sin(figure.phase)) * .035 : 0;
      this.spriteDummy.position.set(figure.x, figure.y + (.975 - .5) * HEIGHT * this.cameraUp.y + bounce, figure.z);
      this.spriteDummy.quaternion.copy(camera.quaternion);
      this.spriteDummy.scale.set(HEIGHT, HEIGHT, 1);
      this.spriteDummy.updateMatrix();
      if (walkKind >= 0) {
        const walkRow = walkKind * 4 + column;
        this.uv.set(1 / COLUMNS, 1 / WALK_ROWS, illustratedWalkFrame(figure.phase) / COLUMNS,
          (WALK_ROWS - 1 - walkRow) / WALK_ROWS);
        this.walkingSprites.push(this.spriteDummy.matrix, undefined, this.uv);
      } else {
        this.uv.set(1 / COLUMNS, 1 / ROWS, column / COLUMNS, (ROWS - 1 - row) / ROWS);
        this.sprites.push(this.spriteDummy.matrix, undefined, this.uv);
      }
      this.shadowDummy.position.set(figure.x, figure.y + .02, figure.z);
      this.shadowDummy.rotation.set(0, 0, 0);
      this.shadowDummy.scale.set(.42, 1, .31);
      this.shadowDummy.updateMatrix();
      this.shadows.push(this.shadowDummy.matrix);
    }
    this.sprites.commit(); this.walkingSprites.commit(); this.shadows.commit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sprites.mesh.removeFromParent(); this.walkingSprites.mesh.removeFromParent(); this.shadows.mesh.removeFromParent();
    this.sprites.dispose(); this.walkingSprites.dispose(); this.shadows.dispose();
    this.texture?.dispose();
    this.walkTexture?.dispose();
  }
}
