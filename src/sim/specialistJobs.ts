import type { ApiResult } from './api';
import { blockPavement, cityBlockAt } from './cityLayout';
import { newId } from './citygen';
import { CELL } from './constants';
import { addMessage } from './events';
import { clearDestination, setDestination, stepPerson } from './movement';
import { bribePrice, completeOfficialBribe, completePoliceEmployment, isBribableOfficial } from './officials';
import { availableSpecialist } from './specialists';
import { trafficContext } from './traffic';
import { dismount, sendHome, startStaffJourney, vehicleOf } from './transport';
import type { Gang, ID, Person, SpecialistJob, Vec2, WorldState } from './types';
import { allBuildings, buildingDoor, dist } from './world';
import { quitGangPayroll } from './payrollMark';

export const SPECIALIST_JOB_NAMES = { audit: 'Audit', bribeOfficials: 'Bribe Officials', employPolice: 'Employ Police', investigateCrime: 'Investigate case' };
export const specialistJobActive = (j: SpecialistJob) => ['queued', 'travelling', 'working'].includes(j.state);
const roleFor = (j: Pick<SpecialistJob, 'type'>) => j.type === 'audit' ? 'accountant' : 'lawyer';
const workMinutes = (j: SpecialistJob) => j.type === 'audit' ? 30 : 5;
export const CRIME_INQUIRY_REQUIRED_MINUTES = 30;
const CRIME_INQUIRY_PROGRESS_PER_GAME_MINUTE = 1;

/** The inspection is followed by bookkeeping at HQ until Friday's report. */
export function reservedAudit(w: WorldState, gangId: ID): SpecialistJob | undefined {
  return Object.values(w.specialistJobs ?? {}).find(j => j.gangId === gangId && j.week === w.week &&
    j.type === 'audit' && (specialistJobActive(j) || j.state === 'done'));
}

export function specialistTargetEligible(w: WorldState, gangId: ID, type: SpecialistJob['type'], p: Person): boolean {
  if (type === 'investigateCrime') return false;
  if (p.status !== 'active' && !(type === 'audit' && p.status === 'onTrial')) return false;
  if (type === 'bribeOfficials') return isBribableOfficial(p);
  if (type === 'employPolice') return p.role === 'police' && p.employedBy == null && !quitGangPayroll(p, gangId);
  if (p.gangId !== gangId || !['hood', 'lieutenant'].includes(p.role)) return false;
  return (w.gangs[gangId]?.teamIds.some(id => w.teams[id]?.lieutenantId === p.id) ?? false) ||
    allBuildings(w).some(b => b.ownerGangId === gangId && b.managerId === p.id);
}

function availableLawyerForJob(w: WorldState, gang: Gang): Person | undefined {
  const lawyer = availableSpecialist(w, gang, 'lawyer');
  if (!lawyer) return undefined;
  const alreadyWorking = Object.values(w.specialistJobs ?? {}).some(j => j.gangId === gang.id &&
    j.actorId === lawyer.id && specialistJobActive(j) && j.type === 'investigateCrime');
  return alreadyWorking ? undefined : lawyer;
}

export function queueSpecialistJob(w: WorldState, gangId: ID, type: SpecialistJob['type'], targetPersonId: ID | null, blockIds: ID[] = []): ApiResult {
  if (type === 'investigateCrime') return { ok: false, error: 'Choose a reported crime from the lawyer’s investigations.' };
  const gang = w.gangs[gangId];
  if (!gang) return { ok: false, error: 'No such gang.' };
  const actor = type === 'bribeOfficials' ? availableLawyerForJob(w, gang) : availableSpecialist(w, gang, roleFor({ type }));
  if (!actor) return { ok: false, error: `You need an available ${roleFor({ type })}.` };
  const blocks = [...new Set(blockIds.map(id => w.blocks[id]?.layout?.mergedInto ?? id))];
  if (blocks.some(id => !w.blocks[id])) return { ok: false, error: 'Choose valid blocks for the tour.' };
  const target = targetPersonId == null ? null : w.people[targetPersonId];
  if (targetPersonId != null && (!target || !specialistTargetEligible(w, gangId, type, target)))
    return { ok: false, error: 'That person is not an available target for this order.' };
  if (!target && (type !== 'employPolice' || !blocks.length)) return { ok: false, error: 'Choose a target or tour area.' };
  const price = type === 'bribeOfficials' ? bribePrice(w, target!, gangId) : 0;
  if (price > gang.cash) return { ok: false, error: `That will cost ${price.toLocaleString('en-US')}.` };
  const pending = Object.values(w.specialistJobs ?? {}).filter(j => j.gangId === gangId && j.week === w.week && specialistJobActive(j));
  const audit = type === 'audit' ? reservedAudit(w, gangId) : null;
  if (audit && audit.state !== 'queued') return { ok: false, error: 'Audit reserves the accountant for the whole week. The report is due at week\'s end.' };
  if (pending.filter(j => j.actorId === actor.id).length >= 16 && !audit) return { ok: false, error: 'That specialist already has a full job list.' };
  if (type === 'employPolice' && pending.some(j => j.type === type && j.targetPersonId === targetPersonId && j.blockIds.join() === blocks.join()))
    return { ok: true, message: 'That police visit is already scheduled.' };
  const job: SpecialistJob = { id: audit?.id ?? newId(w), gangId, actorId: actor.id, week: w.week, type,
    targetPersonId, blockIds: blocks, state: 'queued', quotedPrice: price, workLeft: 0, visitedPersonIds: [],
    completed: 0, patrolIndex: 0, targetPos: null, result: '' };
  (w.specialistJobs ??= {})[job.id] = job;
  if (type === 'audit') w.auditTargets[gangId] = targetPersonId!;
  return { ok: true, message: `${SPECIALIST_JOB_NAMES[type]} scheduled for ${actor.name}${price ? '; payment is due at the visit' : ''}.` };
}

/** A lawyer makes one short visit to the police station to open a report. */
export function queueCrimeInquiry(w: WorldState, gangId: ID, crimeId: ID): ApiResult {
  const gang = w.gangs[gangId], crime = w.crimes.find(c => c.id === crimeId);
  if (!gang || !crime || crime.gangId !== gangId || !crime.reported || crime.charge)
    return { ok: false, error: 'Choose a reported crime against your gang.' };
  const actor = availableLawyerForJob(w, gang);
  if (!actor) return { ok: false, error: 'You need an available lawyer.' };
  if (crime.investigatorKnown && (!w.options.continuousTime || crime.police?.disclosureKnown))
    return { ok: true, message: 'Your lawyer already obtained this case file.' };
  if (Object.values(w.specialistJobs ?? {}).some(j => j.gangId === gangId && j.crimeId === crimeId && specialistJobActive(j)))
    return { ok: true, message: 'Your lawyer is already reviewing that file.' };
  const job: SpecialistJob = { id: newId(w), gangId, actorId: actor.id, week: w.week,
    type: 'investigateCrime', crimeId, targetPersonId: null, blockIds: [], state: 'queued',
    quotedPrice: 0, workLeft: 0, progressMinutes: 0, visitedPersonIds: [], completed: 0, patrolIndex: 0,
    targetPos: null, result: '' };
  (w.specialistJobs ??= {})[job.id] = job;
  return { ok: true, message: `${actor.name} will inspect the police file at the station.` };
}

function home(w: WorldState, gang: Gang, actor: Person): void {
  const office = allBuildings(w).find(b => b.ownerGangId === gang.id && b.isHQ);
  if (office && actor.status === 'active') {
    sendHome(w,actor);
  } else clearDestination(actor);
}

function finish(w: WorldState, j: SpecialistJob, state: 'done' | 'failed' | 'cancelled', message: string): void {
  j.state = state; j.result = message;
  const gang = w.gangs[j.gangId], actor = w.people[j.actorId];
  if (actor && gang && actor.gangId === gang.id && !actor.streetOrder) home(w, gang, actor);
  if (j.type === 'audit' && state !== 'done') delete w.auditTargets[j.gangId];
  // The player's report: a rival's lawyer and accountant work in private.
  if (gang?.isPlayer) w.weekLog.push(`${SPECIALIST_JOB_NAMES[j.type]}: ${message}`);
  if (gang?.isPlayer) addMessage(w, state === 'failed' ? 'failed' : 'waiting', message, actor?.pos, actor?.id);
}

export function cancelSpecialistJob(w: WorldState, gangId: ID, jobId: ID): ApiResult {
  const j = w.specialistJobs?.[jobId];
  if (!j || j.gangId !== gangId || !specialistJobActive(j)) return { ok: false, error: 'That job is not pending.' };
  const wasQueued = j.state === 'queued';
  if (wasQueued) {
    j.state = 'cancelled'; j.result = 'Order cancelled.';
    if (j.type === 'audit') delete w.auditTargets[gangId];
  } else finish(w, j, 'cancelled', 'Order cancelled.');
  return { ok: true, message: 'Order cancelled.' };
}

export function cancelSpecialistVisits(w: WorldState, actorId: ID): void {
  for (const j of Object.values(w.specialistJobs ?? {})) if (j.actorId === actorId && specialistJobActive(j)) {
    if (j.type === 'investigateCrime') {
      // This casework is not a personal visit to the person being moved or
      // recalled. Preserve the courthouse visit and its progress.
      continue;
    } else cancelSpecialistJob(w, j.gangId, j.id);
  }
}

export function setSpecialistWaiting(w: WorldState, gangId: ID, jobId: ID, waiting: boolean): ApiResult {
  const j = w.specialistJobs?.[jobId], actor = j && w.people[j.actorId];
  if (!j || j.gangId !== gangId || !actor || !specialistJobActive(j) || j.state === 'queued') return { ok: false, error: 'That visit is not in progress.' };
  j.paused = waiting;
  clearDestination(actor);
  if (!waiting && j.state === 'working') j.state = 'travelling';
  return { ok: true, message: waiting ? 'Waiting for further instructions.' : 'The visit will continue.' };
}

/** People a specialist is on the way to see (or seeing): they wait for them. */
export function specialistVisitTargets(w: WorldState): Set<ID> {
  const people = new Set<ID>();
  for (const j of Object.values(w.specialistJobs ?? {})) if ((j.week === w.week || j.type === 'investigateCrime') && specialistJobActive(j) &&
    !j.paused && (j.state === 'working' || j.state === 'travelling') && j.targetPersonId != null) people.add(j.targetPersonId);
  return people;
}

export function specialistParticipants(w: WorldState): Set<ID> {
  const people = new Set<ID>();
  for (const j of Object.values(w.specialistJobs ?? {})) if ((j.week === w.week || j.type === 'investigateCrime') && specialistJobActive(j)) {
    people.add(j.actorId);
    if (!j.paused && j.state === 'working' && j.targetPersonId != null) people.add(j.targetPersonId);
  }
  return people;
}

/** Original saves can already contain an accountant's scheduled audit. */
export function beginSpecialistJobs(w: WorldState): void {
  for (const [id, j] of Object.entries(w.specialistJobs ?? {}))
    if (j.type !== 'investigateCrime' && j.week < w.week - 1) delete w.specialistJobs![Number(id)];
  for (const [gangId, target] of Object.entries(w.auditTargets)) {
    if (!Object.values(w.specialistJobs ?? {}).some(j => j.week === w.week && j.gangId === Number(gangId) && j.type === 'audit'))
      queueSpecialistJob(w, Number(gangId), 'audit', target);
  }
}

function visitPosition(w: WorldState, p: Person): Vec2 {
  const b = p.buildingId == null ? null : w.buildings[p.buildingId];
  if (!p.dest && p.orderId == null && p.streetOrder == null) {
    if (b) return buildingDoor(w, b);
    // Undeployed crew can retain their HQ position without a buildingId.
    const office = p.gangId == null ? null : allBuildings(w).find(site => site.isHQ && site.ownerGangId === p.gangId && dist(w.lots[site.lotId].center, p.pos) < 2);
    if (office) return buildingDoor(w, office);
  }
  return p.pos;
}

/** Preserve the next crossing when the person we are visiting moves. */
function approach(w: WorldState, actor: Person, j: SpecialistJob, to: Vec2, minutes: number): boolean {
  if (dist(actor.pos, to) <= 3) { dismount(w,actor); clearDestination(actor); return true; }
  if(!j.targetPos){startStaffJourney(w,actor,to);j.targetPos={...to};}
  if (!actor.dest) { setDestination(w, actor, to); j.targetPos = { ...to }; }
  else if (j.targetPos && dist(j.targetPos, to) > 10) {
    // Still walking to the staff car: aim the car, not the walk, at the new
    // spot — re-routing the walker here left the car behind for the journey.
    const car = vehicleOf(w, actor);
    if (car?.boarding && !actor.inVehicle) { car.destination = { ...to }; j.targetPos = { ...to }; }
    else {
    const next = actor.path[0];
    if (next) {
      const route = { ...actor, pos: { x: next.x, y: next.y } };
      setDestination(w, route, to); actor.dest = route.dest; actor.path = [{ ...next }, ...route.path];
    } else setDestination(w, actor, to);
    j.targetPos = { ...to };
    }
  }
  if (stepPerson(actor, minutes, trafficContext(w))) {
    if (actor.inVehicle) { dismount(w,actor); clearDestination(actor); }
    if (dist(actor.pos, to) <= 3) return true;
  }
  return false;
}

export function tickSpecialistJobs(w: WorldState, minutes: number): void {
  const activeActors = new Set<ID>();
  for (const j of Object.values(w.specialistJobs ?? {})) {
    if (j.type === 'investigateCrime' && j.week < w.week && specialistJobActive(j)) {
      j.week = w.week;
    }
    // A courthouse visit can cross a weekly settlement while travelling;
    // preserve the actual travel/work state until it is complete.
    if ((j.week !== w.week && j.type !== 'investigateCrime') || !specialistJobActive(j)) continue;
    const gang = w.gangs[j.gangId];
    if (j.type === 'investigateCrime' && j.actorId < 0) {
      const replacement = availableLawyerForJob(w, gang);
      if (!replacement) continue;
      j.actorId = replacement.id; j.state = 'queued'; j.targetPos = null;
    }
    let actor = gang && availableSpecialist(w, gang, roleFor(j));
    if (j.type === 'investigateCrime' && actor && activeActors.has(actor.id)) {
      const alternate = Object.values(w.specialistJobs ?? {}).some(other => other !== j && other.gangId === j.gangId &&
        other.type === 'investigateCrime' && specialistJobActive(other) && other.actorId === actor!.id);
      if (alternate) { j.actorId = -1; continue; }
    }
    if (actor && activeActors.has(actor.id)) {
      const pendingLongInquiry = Object.values(w.specialistJobs ?? {}).find(other => other !== j && other.gangId === j.gangId &&
        other.type === 'investigateCrime' && specialistJobActive(other) && other.actorId === actor.id);
      if (pendingLongInquiry && j.type !== 'investigateCrime') continue;
      if (j.type === 'investigateCrime' && j.actorId !== actor.id) { j.actorId = -1; continue; }
    }
    if (j.type === 'investigateCrime' && (!gang || !actor || actor.id !== j.actorId || actor.status !== 'active')) {
      // A file inquiry is independent office work: preserve progress if its
      // lawyer temporarily becomes unavailable.
      if (j.state === 'travelling') j.state = 'queued';
      j.paused = !actor || actor.status !== 'active';
      continue;
    }
    if (!actor || actor.id !== j.actorId || actor.streetOrder ||
      j.type !== 'investigateCrime' && (actor.burningEscape?.week === w.week || actor.emergencyResponse)) {
      finish(w, j, 'failed', 'The specialist is no longer available for this job.'); continue;
    }
    activeActors.add(actor.id);
    if (j.paused) continue;
    if (j.state === 'queued') {
      j.state = 'travelling'; actor.buildingId = null; clearDestination(actor);
      const office = allBuildings(w).find(b => b.ownerGangId === gang.id && b.isHQ && dist(w.lots[b.lotId].center, actor.pos) < 2);
      if (office) actor.pos = buildingDoor(w, office);
      actor.inVehicle=false;
    }
    if (j.type === 'investigateCrime') {
      const crime = w.crimes.find(c => c.id === j.crimeId && c.gangId === gang.id);
      const station = allBuildings(w).find(b => b.typeId === 'policeHQ' && b.state !== 'destroyed')
        ?? allBuildings(w).find(b => b.typeId === 'courthouse');
      if (!crime || !station) { finish(w, j, 'failed', 'The case file is no longer available.'); continue; }
      const desk = buildingDoor(w, station);
      if (j.state === 'travelling') {
        if (approach(w, actor, j, desk, minutes)) { j.state = 'working'; j.workLeft = 0; }
        continue;
      }
      j.progressMinutes = Math.min(CRIME_INQUIRY_REQUIRED_MINUTES,
        (j.progressMinutes ?? 0) + minutes * CRIME_INQUIRY_PROGRESS_PER_GAME_MINUTE);
      if (j.progressMinutes < CRIME_INQUIRY_REQUIRED_MINUTES) {
        j.result = `At the police station: ${Math.floor(j.progressMinutes)}/${CRIME_INQUIRY_REQUIRED_MINUTES} minutes.`;
        continue;
      }
      if (crime.investigatorId != null && w.people[crime.investigatorId]?.status !== 'active')
        crime.investigatorId = w.policeIds.find(id => w.people[id]?.status === 'active');
      crime.investigatorKnown = true;
      if (crime.police) crime.police.disclosureKnown = true;
      for (const c of Object.values(w.cases)) if (c.sourceCrimeId === crime.id && c.gangId === gang.id) {
        c.investigatorId = crime.investigatorId;
        c.investigatorKnown = true;
        c.knowsWitnesses = true;
      }
      const officer = crime.investigatorId == null ? undefined : w.people[crime.investigatorId];
      finish(w, j, 'done', officer ? `Police file reviewed: ${officer.name} is handling the investigation.`
        : 'Police file reviewed: no lead officer is currently assigned.');
      continue;
    }
    const areaTour = j.type === 'employPolice' && j.blockIds.length > 0;
    if (j.type === 'employPolice') {
      const total = j.completed;
      if (total >= (gang.staffVehicles?.lawyer ? 8 : 4)) { finish(w, j, 'done', 'The lawyer has reached this tour\'s police employment capacity.'); continue; }
    }
    let target = j.targetPersonId == null ? undefined : w.people[j.targetPersonId];
    if (areaTour) {
      const inArea = (p: Person) => j.blockIds.includes(cityBlockAt(w, Math.floor(p.pos.x / CELL), Math.floor(p.pos.y / CELL))?.id ?? -1);
      if (!target || !specialistTargetEligible(w, gang.id, j.type, target) || !inArea(target)) {
        const previous = target;
        target = w.policeIds.map(id => w.people[id]).filter(p => p && specialistTargetEligible(w, gang.id, j.type, p) && inArea(p) && !j.visitedPersonIds.includes(p.id))
          .sort((a, b) => dist(actor.pos, a.pos) - dist(actor.pos, b.pos) || a.id - b.id)[0];
        j.targetPersonId = target?.id ?? null; j.state = 'travelling'; j.workLeft = 0;
        if (previous || target) { j.targetPos = null; clearDestination(actor); }
      }
      if (!target) {
        // No early success just because Monday's snapshot had no police here.
        // Walk the selected beats and continue looking throughout the week.
        if (!actor.dest) setDestination(w, actor, blockPavement(w.blocks[j.blockIds[j.patrolIndex % j.blockIds.length]], actor.id + j.patrolIndex));
        if (stepPerson(actor, minutes, trafficContext(w))) j.patrolIndex++;
        continue;
      }
    }
    if (!target || !specialistTargetEligible(w, gang.id, j.type, target)) { finish(w, j, 'failed', 'The person to visit is no longer available.'); continue; }
    // A live order or emergency can move the subject during a meeting.
    // Resume pursuit without discarding the inspection already performed.
    if (j.state === 'working' && dist(actor.pos, visitPosition(w, target)) > 3) j.state = 'travelling';
    if (j.state === 'travelling') {
      if (approach(w, actor, j, visitPosition(w, target), minutes)) { j.state = 'working'; if (j.workLeft <= 0) j.workLeft = workMinutes(j); }
      continue;
    }
    j.workLeft = Math.max(0, j.workLeft - minutes);
    if (j.workLeft > 0) continue;
    const result = j.type === 'bribeOfficials' ? completeOfficialBribe(w, gang.id, target, j.quotedPrice)
      : j.type === 'employPolice' ? completePoliceEmployment(w, gang.id, target)
      : { ok: true as const, message: `${target.name}'s books were inspected. The Audit report will be ready at week's end.` };
    if (!result.ok) { finish(w, j, 'failed', result.error); continue; }
    j.completed++; j.visitedPersonIds.push(target.id);
    if (areaTour) {
      j.result = `${j.completed} officer${j.completed === 1 ? '' : 's'} employed on the tour.`;
      if (gang.isPlayer) addMessage(w, 'waiting', result.message ?? j.result, actor.pos, actor.id);
      j.targetPersonId = null; j.targetPos = null; j.state = 'travelling'; clearDestination(actor);
    } else finish(w, j, 'done', result.message ?? 'Visit completed.');
  }
}

export function settleSpecialistJobs(w: WorldState): void {
  for (const j of Object.values(w.specialistJobs ?? {})) if ((j.week === w.week || j.type === 'investigateCrime') && specialistJobActive(j)) {
    // Visits already in progress continue into the next RTS week. An audit is
    // still tied to this week's books and must close with its report.
    if (w.options.continuousTime && j.type !== 'audit') continue;
    if (j.type === 'employPolice' && j.completed > 0) finish(w, j, 'done', `${j.completed} officers employed before the end of the week.`);
    else finish(w, j, 'failed', 'The visit was not completed before the end of the week.');
  }
}
