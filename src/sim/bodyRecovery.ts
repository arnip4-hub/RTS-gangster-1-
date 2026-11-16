import { campaignMinute } from './calendar';
import { buildingDoor, dist } from './world';
import { parkingSpot, vehicleRoute } from './vehicleNavigation';
import type { CrimeRecord, Person, Vec2, WorldState } from './types';
import { addCaseEvidence, ensurePoliceFile } from './caseEvidence';
import { addNews } from './events';
import { hasWitnessLineOfSight } from './witnessStatements';

const HEARSE_METRES_PER_MINUTE = 9;
const COVER_RADIUS = 12;
const DEATH_KINDS = new Set(['kill', 'streetKill', 'shootout', 'assault', 'streetAssault', 'bomb', 'torch', 'suspiciousDeath']);
const BODY_DISCOVERERS = new Set(['citizen', 'owner', 'reporter', 'clergy', 'firefighter']);

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
  let civilianReportsLeft = w.minute % 5 === 0 ? 8 : 0;
  let civilians: Person[] | undefined;
  let station: Vec2 | undefined;
  for (const p of Object.values(w.people)) {
    if (p.status !== 'dead' || !p.bodyRecovery || p.bodyRecovery.coveredAt != null) continue;
    const officer = officers.find(officer => officer.buildingId == null && dist(officer.pos, p.pos) <= COVER_RADIUS);
    if (!officer) {
      if (civilianReportsLeft <= 0) continue;
      const existing = crimeForBody(w, p);
      if (existing?.reported || existing?.police?.statements.some(s => s.description?.startsWith('Found a body') &&
          !s.withdrawn && w.people[s.witnessId]?.status === 'active')) continue;
      civilians ??= Object.values(w.people).filter(q => q.status === 'active' && q.buildingId == null &&
        !q.inVehicle && q.tram?.phase !== 'riding' && q.tramTrip?.phase !== 'riding' && BODY_DISCOVERERS.has(q.role));
      const discoverer = civilians.filter(q => dist(q.pos, p.pos) <= COVER_RADIUS && hasWitnessLineOfSight(w, q.pos, p.pos))
        .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos) || a.id - b.id)[0];
      civilianReportsLeft--;
      if (discoverer) {
        const crime = existing ?? newBodyInquiry(w, p);
        const file = ensurePoliceFile(w, crime, p.pos);
        const delay = 5 + ((Math.imul(p.id, 31) ^ discoverer.id) >>> 0) % 26;
        file.statements.push({ witnessId: discoverer.id, observation: 'description', confidence: 95,
          reliability: 85, observedAt: now, reportedAt: now + delay,
          description: 'Found a body in the street; did not see who caused the death.' });
      }
      continue;
    }
    reportDiscoveredBody(w, p, officer);
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

/** Finding a victim proves that something happened; it does not reveal who
 * caused it. An unexplained death can have a file with no known offender. */
function reportDiscoveredBody(w: WorldState, victim: Person, officer: Person): void {
  const crime = crimeForBody(w, victim) ?? newBodyInquiry(w, victim);
  if (!crime.reported && crime.leadOnly) addNews(w, { section: 'crime', headline: 'BODY FOUND; POLICE OPEN INQUIRY',
    body: `Police discovered the body of ${victim.name}. The circumstances are under investigation; no suspect has been named.`, gangId: null });
  crime.reported = true;
  crime.reportedAt ??= campaignMinute(w);
  crime.investigatorId ??= officer.id;
  ensurePoliceFile(w, crime, victim.pos);
  addCaseEvidence(w, crime, { kind: 'scene', strength: 18, collectedAt: campaignMinute(w),
    note: 'Police documented a body at the scene. The offender is not identified by the discovery.' });
}

function crimeForBody(w: WorldState, victim: Person): CrimeRecord | undefined {
  return [...w.crimes].reverse().find(c => !c.charge && c.victimId === victim.id && DEATH_KINDS.has(c.kind));
}

function newBodyInquiry(w: WorldState, victim: Person): CrimeRecord {
  const crime: CrimeRecord = { id: w.sequences.crime++, week: w.week, gangId: 0, perpetratorId: 0,
    kind: 'suspiciousDeath', buildingId: null, victimId: victim.id, witnesses: [],
    arrestRisk: 0, reported: false, leadOnly: true };
  w.crimes.push(crime);
  return crime;
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
