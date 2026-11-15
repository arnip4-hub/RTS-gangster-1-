import { campaignMinute } from './calendar';
import { buildingDoor, dist } from './world';
import { parkingSpot, vehicleRoute } from './vehicleNavigation';
import type { Person, Vec2, WorldState } from './types';

const HEARSE_METRES_PER_MINUTE = 9;
const COVER_RADIUS = 12;

function routeLength(points: Vec2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  return length;
}

/** Police must actually be present before a street victim is covered. The
 *  coroner then drives from the police station along the normal road network. */
export function tickBodyRecovery(w: WorldState): void {
  if (!w.options.continuousTime || w.phase !== 'week') return;
  const now = campaignMinute(w);
  const officers = w.policeIds.map(id => w.people[id]).filter((p): p is Person =>
    !!p && p.status === 'active' && p.role === 'police' && !p.inVehicle);
  if (!officers.length) return;
  let station: Vec2 | undefined;
  for (const p of Object.values(w.people)) {
    if (p.status !== 'dead' || !p.bodyRecovery || p.bodyRecovery.coveredAt != null) continue;
    if (!officers.some(officer => dist(officer.pos, p.pos) <= COVER_RADIUS)) continue;
    station ??= (() => {
      const policeHQ = Object.values(w.buildings).find(b => b.typeId === 'policeHQ' && b.state !== 'destroyed');
      return policeHQ ? buildingDoor(w, policeHQ) : officers[0].pos;
    })();
    const destination = parkingSpot(w, p.pos, []);
    const route = vehicleRoute(w, station, destination, (p.id & 1) === 0);
    const points = [route.start, ...route.path];
    const travel = Math.max(3, Math.ceil(routeLength(points) / HEARSE_METRES_PER_MINUTE));
    p.bodyRecovery.coveredAt = now;
    p.bodyRecovery.hearseStartAt = now + 5;
    p.bodyRecovery.hearseArriveAt = now + 5 + travel;
    p.bodyRecovery.collectedAt = now + 5 + travel + 6;
    p.bodyRecovery.hearseRoute = points;
  }
}

export function bodySceneStage(p: Person, now: number): 'body' | 'sheet' | 'gone' {
  const recovery = p.bodyRecovery;
  if (!recovery || recovery.coveredAt == null || now < recovery.coveredAt) return 'body';
  if (recovery.collectedAt == null || now < recovery.collectedAt) return 'sheet';
  return 'gone';
}

/** The same black coroner van drives in, pauses while loading, and leaves. */
export function hearseAt(p: Person, now: number): { pos: Vec2; facing: number } | null {
  const recovery = p.bodyRecovery;
  const points = recovery?.hearseRoute;
  const start = recovery?.hearseStartAt, arrival = recovery?.hearseArriveAt, collected = recovery?.collectedAt;
  if (!points?.length || start == null || arrival == null || collected == null) return null;
  const travel = arrival - start;
  if (now < start || now > collected + travel) return null;
  const back = now >= collected;
  const fraction = now < arrival ? (now - start) / travel : back ? 1 - (now - collected) / travel : 1;
  const total = routeLength(points);
  let remaining = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], leg = dist(a, b);
    if (remaining <= leg || i === points.length - 1) {
      const t = leg ? Math.min(1, remaining / leg) : 0;
      const pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const facing = Math.atan2((back ? -1 : 1) * (b.x - a.x), (back ? -1 : 1) * (b.y - a.y));
      return { pos, facing };
    }
    remaining -= leg;
  }
  return { pos: points[0], facing: 0 };
}
