import * as THREE from 'three';
import type { Person } from '../sim/types';
import { InstancePool } from './pool';
import { patchInstancedUv } from './materialUv';

const IMAGE = `${import.meta.env.BASE_URL}art/city/illustrated-people-atlas.png`;
const CELL = 256, COLUMNS = 4, ROWS = 12, HEIGHT = 2.58;

/** Stable costume choice without adding visual state to the save format. */
export function illustratedPersonRow(person: Pick<Person, 'id' | 'female' | 'role'>): number {
  if (person.role === 'policeChief') return person.female ? 9 : 6;
  if (person.role === 'police') return person.female ? 9 : 2;
  if (person.role === 'fbiHead') return person.female ? 7 : 11;
  if (person.role === 'fbi') return person.female ? 7 : person.id % 2 ? 3 : 11;
  if (person.role === 'boss' || person.role === 'lieutenant' || person.role === 'hood')
    return person.female ? [1, 5][Math.abs(person.id) % 2] : [0, 8][Math.abs(person.id) % 2];
  const n = Math.abs(person.id) % 3;
  return person.female ? [1, 5, 10][n] : [0, 4, 8][n];
}

/** Atlas cells run front, back, screen-left, screen-right. */
function screenDirection(facing: number, cameraX: number, cameraZ: number, rightX: number, rightZ: number): number {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const front = fx * cameraX + fz * cameraZ, side = fx * rightX + fz * rightZ;
  return Math.abs(front) >= Math.abs(side) ? (front >= 0 ? 0 : 1) : (side < 0 ? 2 : 3);
}

export function illustratedScreenDirection(facing: number, camera: THREE.Camera): number {
  const towardCamera = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  towardCamera.y = 0;
  towardCamera.normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return screenDirection(facing, towardCamera.x, towardCamera.z, right.x, right.z);
}

interface Figure { person: Pick<Person, 'id' | 'female' | 'role'>; x: number; y: number; z: number; facing: number; phase: number; moving: boolean }

/** Painted, camera-facing people in one draw batch; actors remain for special animations. */
export class IllustratedPeople {
  readonly sprites: InstancePool;
  readonly shadows: InstancePool;
  ready = false;
  error: string | null = null;
  private figures: Figure[] = [];
  private texture: THREE.Texture | null = null;
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
    plane.dispose();
    this.sprites.mesh.name = 'illustrated-people';
    this.sprites.mesh.visible = false;
    scene.add(this.sprites.mesh);

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
    try {
      texture = await new THREE.TextureLoader().loadAsync(IMAGE);
      if (this.disposed) { texture.dispose(); return; }
      if (texture.image.width !== CELL * COLUMNS || texture.image.height !== CELL * ROWS)
        throw Error('Illustrated people atlas has an unexpected size');
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      (this.sprites.mesh.material as THREE.MeshBasicMaterial).map = texture;
      (this.sprites.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      this.texture = texture;
      this.ready = true;
      this.onReady();
    } catch (error) {
      texture?.dispose();
      if (!this.disposed) this.error = String(error);
    }
  }

  setVisible(visible: boolean): void {
    this.sprites.mesh.visible = visible && this.ready;
    this.shadows.mesh.visible = visible && this.ready;
  }

  setDusk(dusk: number): void {
    const material = this.sprites.mesh.material as THREE.MeshBasicMaterial;
    const strength = 1 - .55 * dusk;
    material.color.setRGB(strength, strength * (1 - .07 * dusk), strength * (1 - .12 * dusk));
  }

  reset(): void { this.figures.length = 0; }

  push(person: Figure['person'], x: number, y: number, z: number, facing: number, phase: number, moving: boolean): void {
    if (this.ready && this.figures.length < this.sprites.capacity)
      this.figures.push({ person, x, y, z, facing, phase, moving });
  }

  /** Recompute orientation for each main or Tagged camera. */
  draw(camera: THREE.Camera): void {
    if (!this.ready) return;
    this.sprites.reset(); this.shadows.reset();
    this.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.cameraBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
    this.cameraBack.y = 0;
    this.cameraBack.normalize();
    this.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const figure of this.figures) {
      const row = illustratedPersonRow(figure.person);
      const column = screenDirection(figure.facing, this.cameraBack.x, this.cameraBack.z,
        this.cameraRight.x, this.cameraRight.z);
      const bounce = figure.moving ? Math.abs(Math.sin(figure.phase)) * .035 : 0;
      this.spriteDummy.position.set(figure.x, figure.y + (.975 - .5) * HEIGHT * this.cameraUp.y + bounce, figure.z);
      this.spriteDummy.quaternion.copy(camera.quaternion);
      this.spriteDummy.scale.set(HEIGHT, HEIGHT, 1);
      this.spriteDummy.updateMatrix();
      this.uv.set(1 / COLUMNS, 1 / ROWS, column / COLUMNS, (ROWS - 1 - row) / ROWS);
      this.sprites.push(this.spriteDummy.matrix, undefined, this.uv);
      this.shadowDummy.position.set(figure.x, figure.y + .02, figure.z);
      this.shadowDummy.rotation.set(0, 0, 0);
      this.shadowDummy.scale.set(.42, 1, .31);
      this.shadowDummy.updateMatrix();
      this.shadows.push(this.shadowDummy.matrix);
    }
    this.sprites.commit(); this.shadows.commit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sprites.mesh.removeFromParent(); this.shadows.mesh.removeFromParent();
    this.sprites.dispose(); this.shadows.dispose();
    this.texture?.dispose();
  }
}
