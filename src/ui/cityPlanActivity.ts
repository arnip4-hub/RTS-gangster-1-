import { peopleList } from '../sim/entityLists';
import { previewStreetPosition } from '../render/previewActorMotion';
import { bossInsideOffice, streetPersonVisible, workingInside } from '../render/characterPresentation';
import { carsAt } from '../sim/traffic';
import type { ID, Vec2, WorldState } from '../sim/types';

export interface CityPlanActivityMarker {
  kind: 'car' | 'civilian' | 'police' | 'gang';
  pos: Vec2;
  gangId?: ID;
}

const POLICE_ROLES = new Set(['police', 'policeChief', 'fbi', 'fbiHead']);
const SEEN_NEAR_OWN_METRES = 80;

/** Live street positions only. A known rival is identified by colour when one
 * of our people is nearby; the city plan never reveals a distant rival crew. */
export function cityPlanActivity(w: WorldState, viewerId: ID, subMinute = 0): CityPlanActivityMarker[] {
  if (w.phase !== 'week') return [];
  const markers: CityPlanActivityMarker[] = [];
  for (const car of carsAt(w, w.minute + subMinute)) markers.push({ kind: 'car', pos: { x: car.x, y: car.y } });
  for (const car of Object.values(w.vehicleFleet ?? {})) {
    if (car.driverId != null || car.destination) markers.push({ kind: 'car', pos: car.pos });
  }

  const people = peopleList(w);
  const onStreet = (p: typeof people[number]) => p.status === 'active' && streetPersonVisible(p, null) &&
    !bossInsideOffice(p) && !workingInside(w, p) &&
    // Residents and off-duty officers do not form a cloud of dots at home.
    (p.gangId != null || !!p.dest || p.path.length > 0 || p.inVehicle || !!p.emergencyResponse) &&
    !(p.buildingId != null && !p.dest && !p.orderId && !p.streetOrder && !p.inVehicle);
  const own = people.filter(p => p.gangId === viewerId && onStreet(p));
  const known = new Set(w.gangs[viewerId]?.knownPeople ?? []);
  const markedVehicles = new Set<string>();
  for (const p of people) {
    if (!onStreet(p)) continue;
    const police = POLICE_ROLES.has(p.role);
    const rival = p.gangId != null && p.gangId !== viewerId;
    const identified = rival && known.has(p.id) && own.some(observer =>
      Math.hypot(observer.pos.x - p.pos.x, observer.pos.y - p.pos.y) <= SEEN_NEAR_OWN_METRES);
    const kind = police ? 'police' : p.gangId === viewerId || identified ? 'gang' : 'civilian';
    // One coloured occupant represents a carload; ordinary passengers are
    // represented by the car instead of a stack of dots at one location.
    if (p.inVehicle) {
      if (kind === 'civilian') continue;
      if (p.vehicleKey && markedVehicles.has(p.vehicleKey)) continue;
      if (p.vehicleKey) markedVehicles.add(p.vehicleKey);
    }
    const pos = previewStreetPosition(p, w, subMinute, { x: 0, y: 0 });
    markers.push({ kind, pos, ...(kind === 'gang' ? { gangId: p.gangId! } : {}) });
  }
  return markers;
}
