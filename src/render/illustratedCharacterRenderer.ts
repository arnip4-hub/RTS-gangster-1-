import type * as THREE from 'three';
import type { Person, WeaponId } from '../sim/types';
import type { CharacterAction } from './characterActions';
import { IllustratedPeople } from './illustratedPeople';

/** Public contract between CityRenderer and either illustrated 2D implementation.
 * The legacy atlas renderer remains active until the new layered art passes QA. */
export type IllustratedFigurePerson = Pick<Person, 'id' | 'portrait' | 'female' | 'role'>;

export interface IllustratedFigureOptions {
  action?: CharacterAction;
  heldWeapon?: WeaponId;
  carrying?: boolean;
  /** Legacy atlas compatibility only: not required by the future layered renderer. */
  rowOverride?: number;
}

export interface IllustratedCharacterRenderer {
  readonly ready: boolean;
  readonly error: string | null;
  load(): Promise<void>;
  setVisible(visible: boolean): void;
  setDusk(dusk: number): void;
  reset(): void;
  push(person: IllustratedFigurePerson, x: number, y: number, z: number,
    facing: number, phase: number, moving: boolean, options?: IllustratedFigureOptions): void;
  /** Must support both main camera and the independent Tagged camera. */
  draw(camera: THREE.Camera): void;
  dispose(): void;
}

/** Preserve the proven production renderer while new 2D layered art is authored. */
export function createIllustratedCharacterRenderer(scene: THREE.Scene, capacity: number,
  onReady: () => void): IllustratedCharacterRenderer {
  return new IllustratedPeople(scene, capacity, onReady);
}
