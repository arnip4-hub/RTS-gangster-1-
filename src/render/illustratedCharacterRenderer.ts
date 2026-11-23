import type * as THREE from 'three';
import type { Person, WeaponId } from '../sim/types';
import type { CharacterAction } from './characterActions';
import { IllustratedPeople } from './illustratedPeople';
import { LayeredPilotPeople } from './layeredPilotPeople';

/** Shared contract: player-facing 2D sprites and an opt-in layered pilot. */
export type IllustratedFigurePerson = Pick<Person, 'id' | 'portrait' | 'female' | 'role'>;
export interface IllustratedFigureOptions {
  action?: CharacterAction;
  heldWeapon?: WeaponId;
  carrying?: boolean;
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
  draw(camera: THREE.Camera): void;
  dispose(): void;
}

export interface PilotSelection {
  /** Explicit developer-only URL flag; never stored in a save. */
  enabled: boolean;
  /** Only the selected male player crew member uses the prototype costume. */
  selectedId: () => number | null;
}

/** Legacy art always remains ready as fallback, including missing pilot assets. */
export class IllustratedPeopleWithPilot implements IllustratedCharacterRenderer {
  readonly legacy: IllustratedPeople;
  readonly pilot: LayeredPilotPeople;
  constructor(scene: THREE.Scene, capacity: number, onReady: () => void,
    private selection: PilotSelection) {
    this.legacy = new IllustratedPeople(scene, capacity, onReady);
    this.pilot = new LayeredPilotPeople(scene, 1, onReady);
  }
  get ready(): boolean { return this.legacy.ready; }
  get error(): string | null { return this.legacy.error ?? this.pilot.error; }
  async load(): Promise<void> { await Promise.all([this.legacy.load(), this.pilot.load()]); }
  setVisible(visible: boolean): void {
    this.legacy.setVisible(visible);
    this.pilot.setVisible(visible);
  }
  setDusk(dusk: number): void { this.legacy.setDusk(dusk); this.pilot.setDusk(dusk); }
  reset(): void { this.legacy.reset(); this.pilot.reset(); }
  push(person: IllustratedFigurePerson, x: number, y: number, z: number,
    facing: number, phase: number, moving: boolean, options: IllustratedFigureOptions = {}): void {
    const selected = person.id === this.selection.selectedId();
    const pilotEligible = selected && !person.female && options.rowOverride == null &&
      (person.role === 'boss' || person.role === 'lieutenant' || person.role === 'hood');
    if (pilotEligible && this.pilot.ready) this.pilot.push(person, x, y, z, facing, phase, moving, options);
    else this.legacy.push(person, x, y, z, facing, phase, moving, options);
  }
  draw(camera: THREE.Camera): void { this.legacy.draw(camera); this.pilot.draw(camera); }
  dispose(): void { this.pilot.dispose(); this.legacy.dispose(); }
}

export function createIllustratedCharacterRenderer(scene: THREE.Scene, capacity: number,
  onReady: () => void, pilot?: PilotSelection): IllustratedCharacterRenderer {
  if (pilot?.enabled) return new IllustratedPeopleWithPilot(scene, capacity, onReady, pilot);
  return new IllustratedPeople(scene, capacity, onReady);
}
