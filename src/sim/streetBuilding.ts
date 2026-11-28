import type { Person, WorldState } from './types';
import { buildingDoor } from './world';

/** A held visitor leaves through the door before resuming work or a new route. */
export function leaveStreetBuilding(w: WorldState, p: Person): void {
  if (p.streetOrder?.type !== 'enterBuilding' || p.buildingId == null) return;
  const building = w.buildings[p.buildingId];
  if (building) p.pos = { ...buildingDoor(w, building) };
  p.buildingId = null;
}
