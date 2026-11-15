import * as THREE from 'three';
import type { Person, WeaponId } from '../sim/types';
import { InstancePool } from './pool';
import { patchInstancedUv } from './materialUv';
import { appearanceIndex, personSkinGroup } from './personAppearance';
import { illustratedPose } from './illustratedAction';
import type { CharacterAction } from './characterActions';

const IMAGE = `${import.meta.env.BASE_URL}art/city/illustrated-people-atlas.png`;
const CELL = 128, COLUMNS = 4, ROWS = 32, HEIGHT = 2.58;
const WALK_CELL = 80, WALK_PER_PAGE = 11, WALK_PAGES = 3;
const ICON_IMAGE = `${import.meta.env.BASE_URL}art/city/illustrated-action-effects.png`;
const ICON_CELL = 64, ICON_COLUMNS = 4, ICON_ROWS = 3;
const walkRows = (page: number) => Math.min(WALK_PER_PAGE, ROWS - page * WALK_PER_PAGE) * 4;
const walkImage = (page: number) => `${import.meta.env.BASE_URL}art/city/illustrated-people-walk-${page + 1}.png`;

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

interface FigureOptions { action?: CharacterAction; heldWeapon?: WeaponId; carrying?: boolean; rowOverride?: number }
interface Figure { person: Pick<Person, 'id' | 'portrait' | 'female' | 'role'>; x: number; y: number; z: number; facing: number; phase: number; moving: boolean; options: FigureOptions }

/** Painted, camera-facing people in one draw batch; actors remain for special animations. */
export class IllustratedPeople {
  readonly sprites: InstancePool;
  readonly walkingSprites: InstancePool[];
  readonly effects: InstancePool;
  readonly shadows: InstancePool;
  ready = false;
  error: string | null = null;
  private figures: Figure[] = [];
  private texture: THREE.Texture | null = null;
  private walkTextures: THREE.Texture[] = [];
  private iconTexture: THREE.Texture | null = null;
  private disposed = false;
  private spriteDummy = new THREE.Object3D();
  private shadowDummy = new THREE.Object3D();
  private effectDummy = new THREE.Object3D();
  private tint = new THREE.Color();
  private uv = new THREE.Vector4();
  private cameraUp = new THREE.Vector3();
  private cameraBack = new THREE.Vector3();
  private cameraRight = new THREE.Vector3();

  constructor(scene: THREE.Scene, capacity: number, private onReady: () => void) {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: .24, depthWrite: true });
    patchInstancedUv(material);
    const plane = new THREE.PlaneGeometry(1, 1);
    this.sprites = new InstancePool(plane, material, capacity, { uv: true, color: true, dynamic: true });
    this.walkingSprites = Array.from({ length: WALK_PAGES }, (_, page) => {
      const walkMaterial = material.clone();
      patchInstancedUv(walkMaterial);
      const pool = new InstancePool(plane, walkMaterial, capacity, { uv: true, color: true, dynamic: true });
      pool.mesh.name = `illustrated-people-walking-${page + 1}`;
      pool.mesh.visible = false;
      scene.add(pool.mesh);
      return pool;
    });
    plane.dispose();
    this.sprites.mesh.name = 'illustrated-people';
    this.sprites.mesh.visible = false;
    scene.add(this.sprites.mesh);

    const iconMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: .18,
      transparent: true, depthWrite: false });
    patchInstancedUv(iconMaterial);
    const effectPlane = new THREE.PlaneGeometry(1, 1);
    this.effects = new InstancePool(effectPlane, iconMaterial, capacity * 2,
      { uv: true, dynamic: true });
    effectPlane.dispose();
    this.effects.mesh.name = 'illustrated-people-action-effects';
    this.effects.mesh.visible = false;
    scene.add(this.effects.mesh);

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
    let walkTextures: THREE.Texture[] = [];
    let iconTexture: THREE.Texture | null = null;
    try {
      [texture, ...walkTextures] = await Promise.all([IMAGE, ...Array.from({ length: WALK_PAGES }, (_, page) => walkImage(page)), ICON_IMAGE]
        .map(path => new THREE.TextureLoader().loadAsync(path)));
      iconTexture = walkTextures.pop() ?? null;
      if (this.disposed) { texture.dispose(); walkTextures.forEach(image => image.dispose()); iconTexture?.dispose(); return; }
      if (texture.image.width !== CELL * COLUMNS || texture.image.height !== CELL * ROWS)
        throw Error('Illustrated people atlas has an unexpected size');
      for (let page = 0; page < WALK_PAGES; page++)
        if (walkTextures[page].image.width !== WALK_CELL * COLUMNS ||
            walkTextures[page].image.height !== WALK_CELL * walkRows(page))
          throw Error(`Illustrated walk atlas ${page + 1} has an unexpected size`);
      if (!iconTexture || iconTexture.image.width !== ICON_CELL * ICON_COLUMNS ||
          iconTexture.image.height !== ICON_CELL * ICON_ROWS)
        throw Error('Illustrated action icon atlas has an unexpected size');
      for (const image of [texture, ...walkTextures, iconTexture]) {
        image.colorSpace = THREE.SRGBColorSpace;
        image.minFilter = image.magFilter = THREE.LinearFilter;
        image.generateMipmaps = false;
      }
      (this.sprites.mesh.material as THREE.MeshBasicMaterial).map = texture;
      (this.sprites.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      for (let page = 0; page < WALK_PAGES; page++) {
        const material = this.walkingSprites[page].mesh.material as THREE.MeshBasicMaterial;
        material.map = walkTextures[page];
        material.needsUpdate = true;
      }
      (this.effects.mesh.material as THREE.MeshBasicMaterial).map = iconTexture;
      (this.effects.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      this.texture = texture;
      this.walkTextures = walkTextures;
      this.iconTexture = iconTexture;
      this.ready = true;
      this.onReady();
    } catch (error) {
      texture?.dispose();
      walkTextures.forEach(image => image.dispose());
      iconTexture?.dispose();
      if (!this.disposed) this.error = String(error);
    }
  }

  setVisible(visible: boolean): void {
    this.sprites.mesh.visible = visible && this.ready;
    for (const pool of this.walkingSprites) pool.mesh.visible = visible && this.ready;
    this.effects.mesh.visible = visible && this.ready;
    this.shadows.mesh.visible = visible && this.ready;
  }

  setDusk(dusk: number): void {
    const material = this.sprites.mesh.material as THREE.MeshBasicMaterial;
    const strength = 1 - .55 * dusk;
    material.color.setRGB(strength, strength * (1 - .07 * dusk), strength * (1 - .12 * dusk));
    for (const pool of this.walkingSprites)
      (pool.mesh.material as THREE.MeshBasicMaterial).color.copy(material.color);
  }

  reset(): void { this.figures.length = 0; }

  push(person: Figure['person'], x: number, y: number, z: number, facing: number, phase: number, moving: boolean,
    options: FigureOptions = {}): void {
    if (this.ready && this.figures.length < this.sprites.capacity)
      this.figures.push({ person, x, y, z, facing, phase, moving, options });
  }

  /** Recompute orientation for each main or Tagged camera. */
  draw(camera: THREE.Camera): void {
    if (!this.ready) return;
    this.sprites.reset(); this.walkingSprites.forEach(pool => pool.reset()); this.shadows.reset(); this.effects.reset();
    this.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.cameraBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
    this.cameraBack.y = 0;
    this.cameraBack.normalize();
    this.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (const figure of this.figures) {
      const row = figure.options.rowOverride ?? illustratedPersonRow(figure.person);
      const column = screenDirection(figure.facing, this.cameraBack.x, this.cameraBack.z,
        this.cameraRight.x, this.cameraRight.z);
      const pose = illustratedPose(figure.options.action, figure.options.heldWeapon, figure.options.carrying);
      const walkKind = figure.moving && pose.collapse === 0 ? row : -1;
      const standLift = (.975 - .5) * HEIGHT * this.cameraUp.y;
      this.spriteDummy.position.set(figure.x, figure.y + standLift * (1 - pose.collapse) + .2 * pose.collapse, figure.z);
      this.spriteDummy.quaternion.copy(camera.quaternion);
      this.spriteDummy.rotateZ(pose.tilt);
      this.spriteDummy.scale.set(HEIGHT, HEIGHT, 1);
      this.spriteDummy.updateMatrix();
      const color = this.tint.setRGB(pose.darken, pose.darken * (figure.options.action?.kind === 'burnDeath' ? .74 : 1),
        pose.darken * (figure.options.action?.kind === 'burnDeath' ? .58 : 1));
      if (walkKind >= 0) {
        const page = Math.floor(walkKind / WALK_PER_PAGE);
        const rows = walkRows(page), walkRow = (walkKind % WALK_PER_PAGE) * 4 + column;
        this.uv.set(1 / COLUMNS, 1 / rows, illustratedWalkFrame(figure.phase) / COLUMNS,
          (rows - 1 - walkRow) / rows);
        this.walkingSprites[page].push(this.spriteDummy.matrix, color, this.uv);
      } else {
        this.uv.set(1 / COLUMNS, 1 / ROWS, column / COLUMNS, (ROWS - 1 - row) / ROWS);
        this.sprites.push(this.spriteDummy.matrix, color, this.uv);
      }
      // Action marks belong at the hands/body. Large hovering symbols looked
      // like UI icons and broke the painted street-figure illusion.
      if (pose.burst != null) this.pushEffect(figure, pose.burst, camera,
        pose.burst === 8 ? 0 : .3, pose.burst === 8 ? 1 : 1.22,
        pose.burst === 8 ? .6 : .28);
      this.shadowDummy.position.set(figure.x, figure.y + .02, figure.z);
      this.shadowDummy.rotation.set(0, 0, 0);
      this.shadowDummy.scale.set(.42, 1, .31);
      this.shadowDummy.updateMatrix();
      this.shadows.push(this.shadowDummy.matrix);
    }
    this.sprites.commit(); this.walkingSprites.forEach(pool => pool.commit()); this.shadows.commit(); this.effects.commit();
  }

  private pushEffect(figure: Figure, icon: number, camera: THREE.Camera, right: number, up: number, size: number): void {
    this.effectDummy.position.set(figure.x + this.cameraRight.x * right + this.cameraUp.x * up,
      figure.y + this.cameraRight.y * right + this.cameraUp.y * up,
      figure.z + this.cameraRight.z * right + this.cameraUp.z * up);
    this.effectDummy.quaternion.copy(camera.quaternion);
    this.effectDummy.scale.set(size, size, 1);
    this.effectDummy.updateMatrix();
    this.uv.set(1 / ICON_COLUMNS, 1 / ICON_ROWS, (icon % ICON_COLUMNS) / ICON_COLUMNS,
      (ICON_ROWS - 1 - Math.floor(icon / ICON_COLUMNS)) / ICON_ROWS);
    this.effects.push(this.effectDummy.matrix, undefined, this.uv);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sprites.mesh.removeFromParent(); this.shadows.mesh.removeFromParent(); this.effects.mesh.removeFromParent();
    this.walkingSprites.forEach(pool => { pool.mesh.removeFromParent(); pool.dispose(); });
    this.sprites.dispose(); this.shadows.dispose(); this.effects.dispose();
    this.texture?.dispose();
    this.walkTextures.forEach(image => image.dispose());
    this.iconTexture?.dispose();
  }
}
