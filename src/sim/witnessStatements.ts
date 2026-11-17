import { fearOf } from './attitudes';
import { memoryWitnessBonus } from './personalHistory';
import { campaignMinute, hourOfDay } from './calendar';
import { cityBlockAt, lotRect } from './cityLayout';
import { CELL } from './constants';
import type { CrimeParams } from './events';
import { onGangPayroll } from './payrollMark';
import { plateForVehicleKey } from './licensePlates';
import type { Rng } from './rng';
import type { Person, Vec2, WitnessStatement, WorldState } from './types';
import { dist } from './world';
import { peopleList } from './entityLists';

const OBSERVER_ROLES = new Set<Person['role']>([
  'citizen', 'owner', 'police', 'fbi', 'clergy', 'reporter', 'firefighter',
  'mayor', 'policeChief', 'judge', 'da', 'fbiHead', 'snitch',
  'hood', 'lieutenant', 'boss', 'lawyer', 'accountant',
]);

/** A broad-phase block lookup keeps the sight test local even in a large city.
 * The segment is blocked by occupied building footprints, rather than letting
 * a nearby person see through a row of houses. */
export function hasWitnessLineOfSight(w: WorldState, from: Vec2, to: Vec2): boolean {
  const visited = new Set<number>();
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) / CELL));
  const x1 = Math.min(w.gridW - 1, Math.floor(Math.max(from.x, to.x) / CELL));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) / CELL));
  const y1 = Math.min(w.gridH - 1, Math.floor(Math.max(from.y, to.y) / CELL));
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    const block = cityBlockAt(w, gx, gy);
    if (block && !visited.has(block.id)) {
      visited.add(block.id);
      for (const lotId of block.lotIds) {
        const lot = w.lots[lotId], b = lot && w.buildings[lot.buildingId];
        if (!lot || !b || b.cls === 'empty' || b.state === 'empty' || b.state === 'destroyed') continue;
        const r = lotRect(lot);
        // A narrow setback avoids treating a pavement endpoint as inside its wall.
        const insetX = Math.min(1, r.w * .1), insetY = Math.min(1, r.h * .1);
        const rect = { x: r.x + insetX, y: r.y + insetY, w: r.w - insetX * 2, h: r.h - insetY * 2 };
        if (crossesRect(from, to, rect)) return false;
      }
    }
  }
  return true;
}

function crossesRect(a: Vec2, b: Vec2, r: { x: number; y: number; w: number; h: number }): boolean {
  let enter = 0, exit = 1;
  for (const [start, delta, low, high] of [
    [a.x, b.x - a.x, r.x, r.x + r.w], [a.y, b.y - a.y, r.y, r.y + r.h],
  ]) {
    if (Math.abs(delta) < .000001) { if (start < low || start > high) return false; continue; }
    let t0 = (low - start) / delta, t1 = (high - start) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0); exit = Math.min(exit, t1);
    if (enter > exit) return false;
  }
  return exit > .001 && enter < .999;
}

function availableObserver(p: Person): boolean {
  return p.status === 'active' && p.tram?.phase !== 'riding' && p.tramTrip?.phase !== 'riding';
}

export function witnessNight(w: WorldState): boolean {
  const hour = hourOfDay(w.minute, true);
  return hour < 6 || hour >= 20;
}

/** Local observation only: this must not be used to read a suspect's position
 * from the other side of town. Shared by interviews and physical searches. */
export function canObservePerson(w: WorldState, observer: Person, target: Person, maxDistance = 35): boolean {
  if (!availableObserver(observer) || !availableObserver(target)) return false;
  if (observer.buildingId !== target.buildingId && (observer.buildingId != null || target.buildingId != null)) return false;
  const range = witnessNight(w) && observer.buildingId == null ? maxDistance * .6 : maxDistance;
  return dist(observer.pos, target.pos) <= range &&
    (observer.buildingId != null || hasWitnessLineOfSight(w, observer.pos, target.pos));
}

/** Observation memories are made once when the event happens. Their report
 * times are saved, so pausing, saving or crossing Sunday cannot reroll them. */
export function rtsWitnessStatements(w: WorldState, rng: Rng, params: CrimeParams, severity: number): WitnessStatement[] {
  const now = campaignMinute(w), perp = w.people[params.perpetratorId];
  const victim = params.victimId == null ? undefined : w.people[params.victimId];
  // Planned encounters can keep the owner at his interior anchor while the
  // hood stands at the door. The actual victim can remember that encounter;
  // this does not let other residents look through unrelated walls.
  const directVictim = (p: Person) => p.id === victim?.id && p.status !== 'dead' &&
    ['active', 'beaten'].includes(p.status) && !!perp && dist(perp.pos, params.pos) <= 35;
  const interior = params.buildingId != null && perp?.buildingId === params.buildingId ? params.buildingId
    : victim?.buildingId != null && dist(victim.pos, params.pos) <= 4 ? victim.buildingId : null;
  const loud = params.type === 'shootout' || params.type === 'bomb' || params.type === 'torch';
  const soundRange = loud ? 70 : severity >= 5 ? 26 : 12;
  const visionRange = witnessNight(w) ? 22 : 38;
  const out: WitnessStatement[] = [];
  const possible = peopleList(w).filter(p => p.id !== params.perpetratorId && p.gangId !== params.gangId &&
    OBSERVER_ROLES.has(p.role) && (availableObserver(p) || directVictim(p)) &&
    // A person at home does not see an unrelated street scene through walls.
    (p.buildingId == null || p.buildingId === interior || directVictim(p)) && dist(p.pos, params.pos) <= Math.max(visionRange, soundRange))
    .sort((a, b) => dist(a.pos, params.pos) - dist(b.pos, params.pos) || a.id - b.id).slice(0, 16);
  for (const p of possible) {
    const distance = dist(p.pos, params.pos), official = p.role === 'police' || p.role === 'fbi';
    if (official && severity < 9 && (onGangPayroll(p, params.gangId) || p.bribedBy === params.gangId)) continue;
    const visual = directVictim(p) || distance <= visionRange && (interior != null && p.buildingId === interior ||
      interior == null && p.buildingId == null && hasWitnessLineOfSight(w, p.pos, params.pos));
    if (!visual && distance > soundRange) continue;
    const stealth = perp?.skills.stealth ?? 2.5;
    const noticed = official && visual && distance <= 10 || rng.chance(visual
      ? Math.max(.15, .78 + severity * .012 - stealth * .07 - distance / 150)
      : loud ? .8 : .3);
    if (!noticed) continue;
    const faceRange = witnessNight(w) && interior == null ? 9 : 18;
    const rawConfidence = Math.round(Math.max(15, Math.min(98,
      (visual ? 90 - distance * 1.5 - stealth * 3 + p.skills.intelligence * 2 - (witnessNight(w) && interior == null ? 18 : 0) : 25))));
    const confidence = official && visual && distance <= 10 ? Math.max(90, rawConfidence) : rawConfidence;
    const recognizes = visual && distance <= faceRange && (official || rng.chance(confidence / 100));
    const observation: WitnessStatement['observation'] = recognizes && official ? 'direct' : recognizes ? 'face'
      : visual && perp?.inVehicle && perp.vehicleKey ? 'vehicle' : visual ? 'description' : 'sound';
    // Fear affects willingness to report, not what the witness saw. Recent,
    // attributed family trauma can push a witness toward reporting, but never
    // removes the danger or makes a witness certain to cooperate.
    const willingness = official ? 1 : Math.max(.12, Math.min(.98,
      (severity >= 5 ? .86 : .4) - fearOf(p, params.gangId) / 420 +
      memoryWitnessBonus(p, params.gangId, campaignMinute(w))));
    const reports = official || rng.chance(willingness);
    const reportedAt = reports ? now + (official ? 0 : p.status === 'beaten' ? rng.int(60, 120) : rng.int(5, 30)) : undefined;
    const notedPlate = observation === 'vehicle' && perp?.vehicleKey && rng.chance(Math.max(.12, Math.min(.72, confidence / 130)))
      ? plateForVehicleKey(perp.vehicleKey) : undefined;
    const plate = notedPlate && rng.chance(.55) ? `${notedPlate.slice(0, -2)}??` : notedPlate;
    out.push({ witnessId: p.id, observation, confidence, reliability: Math.round(65 + p.skills.intelligence * 5),
      observedAt: now, ...(reportedAt == null ? {} : { reportedAt }),
      ...(official && reports ? { interviewedAt: now } : {}),
      ...(recognizes ? { suspectId: params.perpetratorId } : {}),
      ...(observation === 'vehicle' && perp?.vehicleKey ? { vehicleKey: perp.vehicleKey } : {}),
      ...(plate ? { plate } : {}),
      description: observation === 'sound' ? 'Heard a disturbance; did not see who caused it.'
        : observation === 'description' ? 'Saw a person at the scene, without a clear facial identification.'
        : observation === 'vehicle' ? 'Saw a vehicle at the scene, without identifying its occupants.'
        : official ? 'Officer directly observed the offender.' : 'Saw the offender’s face at close range.' });
  }
  return out.slice(0, 8);
}
