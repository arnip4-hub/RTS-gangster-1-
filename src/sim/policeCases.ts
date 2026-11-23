import { campaignMinute, FULL_DAY_MINUTES } from './calendar';
import { caseEvidenceStrength, caseHasWarrant, activeCaseStatements, addCaseEvidence, ensurePoliceFile,
  refreshCaseIdentity, refreshPoliceWanted } from './caseEvidence';
import { CELL, ORDERS } from './constants';
import { isWeekend, policeOnDuty } from './duty';
import { addMessage } from './events';
import { clearDestination, setDestination, stepPerson } from './movement';
import type { Rng } from './rng';
import { trafficContext } from './traffic';
import { alight } from './transport';
import type { CrimeRecord, ID, OrderType, Person, PoliceTask, WorldState } from './types';
import { buildingDoor, dist } from './world';
import { canObservePerson } from './witnessStatements';
import { pavementBeside } from './vehicleNavigation';
import { plateRegistration } from './licensePlates';
import { recordServiceCase, recordServiceMistake, serviceQuality } from './publicService';

const MAX_ACTIVE_TASKS = 8;
const ARREST_DISTANCE = 5;
const KNOWN_POSITION_MINUTES = 120;

function stableRoll(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % 100;
}

function logWitnessInterview(w: WorldState, crime: CrimeRecord, officer: Person,
  statement: NonNullable<CrimeRecord['police']>['statements'][number], now: number): void {
  statement.interviewedAt = now;
  statement.reliability = Math.max(20, Math.min(100, statement.reliability + (serviceQuality(officer) - 50) * .14));
  addCaseEvidence(w, crime, { kind: 'statement', strength: 0, witnessId: statement.witnessId,
    collectedAt: now, note: `Interview recorded with witness ${statement.witnessId}` });
  if (statement.plate) {
    const registration = plateRegistration(w, statement.plate);
    const registered = registration?.registeredPersonId == null ? undefined : w.people[registration.registeredPersonId];
    addCaseEvidence(w, crime, { kind: 'plate', strength: registration ? 8 : 2,
      personId: registration?.registeredPersonId, vehicleKey: registration?.vehicleKey, plate: statement.plate,
      collectedAt: now, note: registration
        ? `Plate ${statement.plate} matched the city vehicle register${registered ? ` to ${registered.name}` : ''}. It does not establish who was driving.`
        : `Witness noted plate ${statement.plate}; no current city registration matched.` });
  }
}

function politicalPressureSource(w: WorldState, gangId: ID): Person | undefined {
  return [w.people[w.mayorId], w.people[w.policeChiefId]].find(p => p?.status === 'active' &&
    (p.bribedBy === gangId || (p.opinion[gangId] ?? 0) >= 60));
}

function fileCrime(w: WorldState, id: ID): CrimeRecord | undefined { return w.crimes.find(c => c.id === id); }
function officers(w: WorldState): Person[] {
  return [...new Set([...w.policeIds, ...w.fbiIds])].map(id => w.people[id]).filter((p): p is Person => !!p);
}
function terminal(w: WorldState, crime: CrimeRecord): boolean {
  return Object.values(w.cases).some(c => c.sourceCrimeId === crime.id && ['appealing', 'dismissed', 'acquitted', 'convicted'].includes(c.status));
}

/** Loaded old reports retain their known scene and any established court
 * identity. They do not invent a new identification from simulation truth. */
export function normalizeRtsPolice(w: WorldState): void {
  if (!w.options.continuousTime) return;
  const now = campaignMinute(w);
  for (const crime of w.crimes) {
    if (!crime.reported || crime.charge || crime.police) continue;
    // Proceedings already opened in an older release keep their saved court
    // record. An empty new file would erase that evidence or invent a fresh
    // police identification; the court migration handles their deadlines.
    if (Object.values(w.cases).some(c => c.sourceCrimeId === crime.id)) continue;
    const f = ensurePoliceFile(w, crime);
    f.openedAt = crime.reportedAt ?? now;
    // Old witness IDs establish contactable observers, not an omniscient face ID.
    f.statements = crime.witnesses.filter(id => !!w.people[id]).map(id => ({ witnessId: id,
      observation: 'description', confidence: 45, reliability: 65,
      observedAt: f.openedAt, reportedAt: f.openedAt }));
  }
  for (const p of officers(w)) {
    // Legacy FBI tasks were assigned from secret stock/crew information.
    // New leads can be established separately by the Bureau's migration.
    if (p.fbiAssignment) { delete p.fbiAssignment; clearDestination(p); p.inVehicle = false; }
    if (p.policeTask && !fileCrime(w, p.policeTask.crimeId)) { delete p.policeTask; clearDestination(p); p.inVehicle = false; }
  }
  for (const p of Object.values(w.people)) {
    // Beta saves predating custody journeys kept people arrested in the street.
    if (p.status === 'arrested' && p.custody && !p.custody.transport)
      bookDetainee(w, p, w.people[p.custody.officerId]);
    if (p.status !== 'arrested' || p.custody) continue;
    const court = Object.values(w.cases).find(c => c.defendantId === p.id && ['awaiting', 'onTrial'].includes(c.status));
    if (court) { p.status = 'onTrial'; continue; }
    // An unsupported old desk arrest is not a licence to manufacture charges.
    p.status = 'active'; clearDestination(p);
  }
  refreshPoliceWanted(w);
}

function onPayroll(officer: Person, suspect: Person): boolean {
  return suspect.gangId != null && (officer.employedBy === suspect.gangId || officer.bribedBy === suspect.gangId);
}

function directObservation(w: WorldState, crime: CrimeRecord, officer: Person, suspect: Person): boolean {
  const now = campaignMinute(w);
  return !!crime.reported && activeCaseStatements(w, crime).some(s => s.witnessId === officer.id &&
    s.observation === 'direct' && s.suspectId === suspect.id && s.confidence >= 80 && now - s.observedAt <= 15);
}

/** A warrant or an officer's own recent observation supplies grounds; actual
 * approach supplies custody. Each person is considered separately. */
export function tryCaseArrest(w: WorldState, rng: Rng, officer: Person, suspect: Person, crimeId?: ID): boolean {
  if (!w.options.continuousTime || officer.status !== 'active' || !['police', 'fbi'].includes(officer.role) ||
      officer.role === 'police' && !policeOnDuty(w, officer) || suspect.status !== 'active' ||
      suspect.id === officer.id || dist(officer.pos, suspect.pos) > ARREST_DISTANCE ||
      !canObservePerson(w, officer, suspect, ARREST_DISTANCE)) return false;
  const candidates = crimeId == null ? w.crimes : w.crimes.filter(c => c.id === crimeId);
  const crime = candidates.find(c => !c.charge && c.reported && c.police && !terminal(w, c) &&
    (caseHasWarrant(w, c, suspect.id) || directObservation(w, c, officer, suspect)));
  if (!crime) return false;
  const f = crime.police!, severity = ORDERS[crime.kind as OrderType]?.severity ?? 8;
  if (f.arrestAttemptAfter != null && f.arrestAttemptAfter > campaignMinute(w)) return false;
  if (onPayroll(officer, suspect) && severity < 9) return false;
  // A dangerous stop can fail; failures produce a local pursuit, not an
  // automatic arrest of everyone named on the crew list.
  const resists = suspect.orderId != null && w.orders[suspect.orderId]?.opts.priority;
  if (rng.chance(resists ? .12 : .03)) {
    f.arrestAttemptAfter = campaignMinute(w) + 20;
    if (suspect.gangId != null && w.gangs[suspect.gangId]?.isPlayer)
      addMessage(w, 'police', `${suspect.name} escaped an attempted arrest.`, suspect.pos, suspect.id);
    return false;
  }
  alight(w, suspect); clearDestination(suspect);
  alight(w, officer); clearDestination(officer);
  suspect.status = 'arrested'; suspect.buildingId = null; suspect.orderId = null; suspect.streetOrder = null;
  const now = campaignMinute(w);
  suspect.custody = { crimeId: crime.id, officerId: officer.id, arrestedAt: now, reviewAt: now + 360,
    releaseAt: now + FULL_DAY_MINUTES, transport: 'scene' };
  // Keep the arresting officer physically present for a brief handcuffing beat.
  // The police task is saved so the following journey survives a reload.
  officer.policeTask = { crimeId: crime.id, kind: 'arrest', phase: 'securing', target: { ...officer.pos },
    until: now + 720, workLeft: 2, suspectId: suspect.id };
  f.suspectId = suspect.id; f.identityConfidence = Math.max(f.identityConfidence, 85);
  delete f.warrantAt; delete f.warrantExpiresAt;
  f.prosecutorDecision = 'pending'; f.reviewDueAt = suspect.custody.reviewAt;
  f.stage = 'arrested'; f.lastKnownPos = { ...suspect.pos }; f.lastSeenAt = now;
  recordPoliceObservation(w, crime.id, officer.id);
  crime.investigatedAt = now;
  if (suspect.gangId != null && w.gangs[suspect.gangId]?.isPlayer)
    addMessage(w, 'police', `${suspect.name} has been arrested; the prosecutor will review this case.`, suspect.pos, suspect.id);
  w.weekLog.push(`${suspect.name} was arrested on case ${crime.id}.`);
  refreshPoliceWanted(w);
  return true;
}

/** Actual scene work collects incident evidence and interviews reachable
 * witnesses. A body or an examined room alone never identifies its killer. */
export function recordPoliceObservation(w: WorldState, crimeId: ID, officerId: ID): void {
  if (!w.options.continuousTime) return;
  const c = fileCrime(w, crimeId), p = w.people[officerId];
  if (!c?.reported || !p || p.status !== 'active' || !['police', 'fbi'].includes(p.role)) return;
  const f = ensurePoliceFile(w, c);
  if (dist(p.pos, f.pos) > 14) return;
  const now = campaignMinute(w);
  if (f.sceneExaminedAt == null) {
    f.sceneExaminedAt = now;
    const quality = serviceQuality(p);
    const madeError = stableRoll(`${c.id}:${p.id}:scene`) < Math.max(0, Math.round((55 - quality) * .48));
    addCaseEvidence(w, c, { kind: 'scene', strength: madeError ? 11 : Math.min(20, 12 + quality * .08),
      collectedAt: now, buildingId: c.buildingId ?? undefined,
      note: madeError ? 'Scene examination recorded; supervisor review pending' : 'Scene examined by responding officer' });
    recordServiceCase(p);
    if (madeError) {
      f.proceduralError = { officerId: p.id, at: now, dueAt: now + 3 * 60 };
      recordServiceMistake(p);
    }
  }
  for (const statement of activeCaseStatements(w, c)) {
    const witness = w.people[statement.witnessId];
    if (statement.interviewedAt != null || !canObservePerson(w, p, witness, 14)) continue;
    logWitnessInterview(w, c, p, statement, now);
  }
  refreshCaseIdentity(w, c);
  if (f.suspectId != null) {
    const suspect = w.people[f.suspectId];
    if (suspect?.status === 'active' && canObservePerson(w, p, suspect, 35)) {
      f.lastKnownPos = { ...suspect.pos }; f.lastSeenAt = now;
      if (suspect.buildingId != null) f.lastKnownBuildingId = suspect.buildingId;
    }
  }
}

function availableOfficer(w: WorldState, p: Person, arrest: boolean): boolean {
  if (p.status !== 'active' || !['police', 'fbi'].includes(p.role) || p.policeTask || p.emergencyResponse ||
    p.streetOrder || p.orderId != null || p.burningEscape?.week === w.week || p.shockReaction) return false;
  if (p.role === 'police') return policeOnDuty(w, p);
  return arrest || !isWeekend(w);
}

function leaveBuilding(w: WorldState, p: Person): void {
  const b = p.buildingId == null ? undefined : w.buildings[p.buildingId];
  if (b) p.pos = buildingDoor(w, b);
  p.buildingId = null;
}

function routeTask(w: WorldState, p: Person, task: PoliceTask): void {
  leaveBuilding(w, p); clearDestination(p);
  p.inVehicle = dist(p.pos, task.target) > 45;
  setDestination(w, p, task.target);
}

function station(w: WorldState, p: Person) {
  return Object.values(w.buildings).find(b => b.typeId === (p.role === 'fbi' ? 'fbiHQ' : 'policeHQ') && b.state !== 'destroyed');
}

/** Release at the police door instead of leaving an acquitted person indoors. */
export function leavePoliceCustody(w: WorldState, person: Person): void {
  const building = person.buildingId == null ? undefined : w.buildings[person.buildingId];
  if (building && ['policeHQ', 'fbiHQ'].includes(building.typeId)) {
    person.pos = buildingDoor(w, building);
    person.buildingId = null;
  }
  person.inVehicle = false;
  clearDestination(person);
}

/** An officer may be interrupted, but a lawful detention must never remain
 * stranded as an arrested actor on the pavement. */
function bookDetainee(w: WorldState, suspect: Person, officer?: Person): void {
  if (suspect.status !== 'arrested' || !suspect.custody) return;
  const home = officer ? station(w, officer) : undefined;
  suspect.custody.transport = 'station';
  suspect.inVehicle = false;
  clearDestination(suspect);
  if (home) {
    suspect.buildingId = home.id;
    suspect.pos = { ...w.lots[home.lotId].center };
  }
}

function finishCustodyDelivery(w: WorldState, officer: Person, suspect: Person): void {
  const home = station(w, officer);
  bookDetainee(w, suspect, officer);
  officer.inVehicle = false;
  if (home) {
    officer.buildingId = home.id;
    officer.pos = { ...w.lots[home.lotId].center };
  }
  delete officer.policeTask;
  clearDestination(officer);
}

function returnOfficer(w: WorldState, p: Person): void {
  const t = p.policeTask, home = station(w, p);
  if (!t || !home) { delete p.policeTask; p.inVehicle = false; clearDestination(p); return; }
  t.phase = 'returning'; t.target = buildingDoor(w, home); t.until = campaignMinute(w) + 720;
  routeTask(w, p, t);
}

function finishInterview(w: WorldState, crime: CrimeRecord, officer: Person, witnessId: ID): void {
  const f = crime.police!, now = campaignMinute(w), witness = w.people[witnessId];
  if (!witness || witness.status !== 'active') return;
  const home = witness.homeBuildingId == null ? undefined : w.buildings[witness.homeBuildingId];
  const atHome = !!home && witness.buildingId === home.id && dist(officer.pos, buildingDoor(w, home)) <= 8;
  if (!atHome && !canObservePerson(w, officer, witness, 14)) return;
  for (const s of activeCaseStatements(w, crime)) if (s.witnessId === witnessId && s.interviewedAt == null) {
    logWitnessInterview(w, crime, officer, s, now);
  }
  recordServiceCase(officer);
  refreshCaseIdentity(w, crime); f.nextReviewAt = now;
}

function stepTasks(w: WorldState, rng: Rng, minutes: number): void {
  const now = campaignMinute(w), traffic = trafficContext(w);
  for (const p of officers(w)) {
    const t = p.policeTask;
    if (!t) continue;
    const c = fileCrime(w, t.crimeId);
    if (t.phase === 'securing' || t.phase === 'delivering') {
      const suspect = t.suspectId == null ? undefined : w.people[t.suspectId];
      if (p.status !== 'active' || !suspect || suspect.status !== 'arrested' ||
          suspect.custody?.crimeId !== t.crimeId || suspect.custody.officerId !== p.id || !c?.police) {
        if (p.status === 'active') returnOfficer(w, p);
        else { delete p.policeTask; p.inVehicle = false; clearDestination(p); }
        continue;
      }
      if (t.phase === 'securing') {
        t.workLeft = Math.max(0, t.workLeft - minutes);
        if (t.workLeft > 0) continue;
        const home = station(w, p);
        if (!home) { finishCustodyDelivery(w, p, suspect); continue; }
        t.phase = 'delivering';
        t.target = buildingDoor(w, home);
        t.until = now + 720;
        routeTask(w, p, t);
        suspect.custody.transport = p.inVehicle ? 'vehicle' : 'escorted';
        suspect.pos = { ...p.pos };
        continue;
      }
      // The detainee stays with the officer, rather than remaining at the
      // arrest coordinates as an independent vehicle or stationary sprite.
      const arrived = !p.dest || stepPerson(p, minutes, traffic);
      suspect.pos = { ...p.pos };
      if (arrived || now >= t.until) finishCustodyDelivery(w, p, suspect);
      continue;
    }
    if (p.status !== 'active' || p.orderId != null || p.streetOrder || !c?.police || c.police.stage === 'closed' && t.phase !== 'returning') {
      if (p.status === 'active') returnOfficer(w, p); else { delete p.policeTask; p.inVehicle = false; clearDestination(p); }
      continue;
    }
    if (now >= t.until && t.phase !== 'returning') { returnOfficer(w, p); continue; }
    if (t.phase === 'returning') {
      if (!p.dest || stepPerson(p, minutes, traffic)) {
        p.inVehicle = false; const home = station(w, p);
        if (home) { p.buildingId = home.id; p.pos = { ...w.lots[home.lotId].center }; }
        delete p.policeTask; clearDestination(p);
      }
      continue;
    }
    const f = c.police;
    if (t.kind === 'arrest' && t.suspectId != null) {
      const suspect = w.people[t.suspectId];
      if (!suspect || suspect.status !== 'active' || !caseHasWarrant(w, c, suspect.id) && !directObservation(w, c, p, suspect)) { returnOfficer(w, p); continue; }
      // Read the live position only after a local visual sighting. Otherwise
      // the officer goes to the last reported location and may find nobody.
      if (canObservePerson(w, p, suspect, 35)) {
        f.lastKnownPos = { ...suspect.pos }; f.lastSeenAt = now; t.target = { ...suspect.pos };
        t.workLeft = 15;
        if (dist(p.pos, suspect.pos) <= ARREST_DISTANCE) {
          if (tryCaseArrest(w, rng, p, suspect, c.id)) continue;
          continue;
        }
        if (p.inVehicle && dist(p.pos, suspect.pos) < 15) { alight(w, p); clearDestination(p); }
        if (!p.dest || dist(p.dest, t.target) > 4) setDestination(w, p, t.target);
      }
    }
    if (t.phase === 'travelling') {
      if (p.dest && !stepPerson(p, minutes, traffic)) continue;
      alight(w, p); clearDestination(p);
      t.phase = t.kind === 'arrest' ? 'searching' : 'working';
    }
    if (t.phase === 'searching') {
      if (p.dest && !stepPerson(p, minutes, traffic)) continue;
      t.workLeft = Math.max(0, t.workLeft - minutes);
      if (t.workLeft > 0) continue;
      // Search a few actual pavement positions around the report. Never read
      // a hidden suspect's current destination or choose waypoints near him.
      const offsets = [[18, 0], [0, 18], [-18, 0], [0, -18], [30, 18], [-30, -18]];
      const index = t.searchPoint ?? 0;
      if (index >= offsets.length) { returnOfficer(w, p); continue; }
      const origin = f.lastKnownPos ?? f.pos, [dx, dy] = offsets[index];
      t.searchPoint = index + 1; t.workLeft = 15;
      t.target = pavementBeside(w, { x: Math.max(1, Math.min(w.gridW * CELL - 1, origin.x + dx)),
        y: Math.max(1, Math.min(w.gridH * CELL - 1, origin.y + dy)) });
      setDestination(w, p, t.target);
      continue;
    }
    t.workLeft = Math.max(0, t.workLeft - minutes);
    if (t.workLeft > 0) continue;
    if (t.kind === 'interview' && t.witnessId != null) finishInterview(w, c, p, t.witnessId);
    else recordPoliceObservation(w, c.id, p.id);
    returnOfficer(w, p);
  }
}

function assignTask(w: WorldState, c: CrimeRecord, active: Person[]): boolean {
  const f = c.police!, now = campaignMinute(w);
  if (active.filter(p => p.policeTask).length >= MAX_ACTIVE_TASKS || active.some(p => p.policeTask?.crimeId === c.id)) return false;
  const warrant = caseHasWarrant(w, c);
  const urgent = warrant || f.raidDueAt != null && f.raidDueAt <= now;
  const agent = active.filter(p => p.role === (f.agency === 'fbi' ? 'fbi' : 'police') && availableOfficer(w, p, urgent) &&
      !(f.obstructionUntil != null && now >= f.obstructionUntil && f.suspectId != null && onPayroll(p, w.people[f.suspectId])))
    .sort((a, b) => dist(a.pos, f.pos) - dist(b.pos, f.pos) || a.id - b.id)[0];
  if (!agent) return false;
  const s = activeCaseStatements(w, c).find(s => s.interviewedAt == null);
  const witness = s ? w.people[s.witnessId] : null;
  const home = witness?.homeBuildingId == null ? null : w.buildings[witness.homeBuildingId];
  let task: PoliceTask;
  if (warrant) {
    task = { crimeId: c.id, kind: 'arrest', phase: 'travelling', target: { ...(f.lastKnownPos ?? f.pos) },
      until: now + 360, workLeft: 15, suspectId: f.suspectId };
  } else if (s && witness) {
    task = { crimeId: c.id, kind: 'interview', phase: 'travelling', target: home ? buildingDoor(w, home) : { ...f.pos },
      until: now + 360, workLeft: 20, witnessId: witness.id };
  } else {
    task = { crimeId: c.id, kind: 'surveillance', phase: 'travelling', target: { ...f.pos },
      until: now + 360, workLeft: f.agency === 'fbi' ? 60 : 20 };
  }
  if (c.investigatorId !== agent.id) { c.investigatorId = agent.id; c.investigatorKnown = false; f.disclosureKnown = false; }
  serviceQuality(agent);
  agent.policeTask = task; routeTask(w, agent, task); return true;
}

/** One bounded file review at a time; actual journeys continue minute by
 * minute. Old and cold files survive week boundaries and can receive leads. */
export function tickPoliceCases(w: WorldState, rng: Rng, minutes = 1): void {
  if (!w.options.continuousTime || w.phase !== 'week' || minutes <= 0) return;
  const now = campaignMinute(w);
  stepTasks(w, rng, minutes);
  // Saved games, interrupted officers and cancelled assignments must not
  // leave someone arrested on the street indefinitely.
  for (const suspect of Object.values(w.people)) {
    if (suspect.status !== 'arrested' || !suspect.custody ||
        !['scene', 'escorted', 'vehicle'].includes(suspect.custody.transport ?? '')) continue;
    const officer = w.people[suspect.custody.officerId], task = officer?.policeTask;
    if (officer?.status === 'active' && task?.kind === 'arrest' &&
        task.suspectId === suspect.id && ['securing', 'delivering'].includes(task.phase)) continue;
    bookDetainee(w, suspect, officer);
  }
  const active = officers(w);
  // An officer who personally sees an attack need not wait for a desk review.
  for (const c of w.crimes) if (c.reported && c.police && !c.charge && !['closed', 'charged', 'arrested'].includes(c.police.stage)) {
    for (const s of activeCaseStatements(w, c)) {
      if (s.observation !== 'direct' || s.suspectId == null || now - s.observedAt > 15) continue;
      const officer = w.people[s.witnessId], suspect = w.people[s.suspectId];
      if (!officer || !suspect) continue;
      if (tryCaseArrest(w, rng, officer, suspect, c.id)) continue;
      if (suspect.status === 'active' && s.confidence >= 80 && directObservation(w, c, officer, suspect) &&
          availableOfficer(w, officer, true) && canObservePerson(w, officer, suspect, 35)) {
        const f = c.police;
        refreshCaseIdentity(w, c); f.lastKnownPos = { ...suspect.pos }; f.lastSeenAt = now;
        officer.policeTask = { crimeId: c.id, kind: 'arrest', phase: 'travelling', target: { ...suspect.pos },
          until: now + 30, workLeft: 15, suspectId: suspect.id };
        if (c.investigatorId !== officer.id) { c.investigatorId = officer.id; c.investigatorKnown = false; f.disclosureKnown = false; }
        serviceQuality(officer);
        routeTask(w, officer, officer.policeTask);
      }
    }
  }
  // Reviewing hourly is independent of the weekly settlement and its resets.
  const due = w.crimes.filter(c => c.reported && !c.charge && c.police &&
    (!['closed', 'charged', 'arrested'].includes(c.police.stage) ||
      c.police.stage === 'arrested' && c.police.prosecutorDecision === 'investigate') && c.police.nextReviewAt <= now)
    .sort((a, b) => a.police!.nextReviewAt - b.police!.nextReviewAt || a.id - b.id).slice(0, 8);
  for (const c of due) {
    const f = c.police!; f.nextReviewAt = now + 60;
    if (terminal(w, c)) { f.stage = 'closed'; continue; }
    const reportedAt = c.reportedAt ?? f.openedAt;
    if (now - reportedAt < 30) { f.nextReviewAt = reportedAt + 30; continue; }
    if (f.stage === 'cold' && now - f.lastLeadAt > 2 * FULL_DAY_MINUTES) continue;
    refreshCaseIdentity(w, c);
    const strength = caseEvidenceStrength(w, c);
    const investigator = c.investigatorId == null ? undefined : w.people[c.investigatorId];
    if (investigator && investigator.status !== 'active') { delete c.investigatorId; c.investigatorKnown = false; f.disclosureKnown = false; }
    const bought = f.suspectId != null && investigator && w.people[f.suspectId] && onPayroll(investigator, w.people[f.suspectId]);
    // Corruption buys time, not permanent immunity. This deadline is saved and
    // is not restarted by each review or by reassigning the same officer.
    if (bought && f.prosecutorDecision !== 'charge') {
      f.obstructionUntil ??= now + 180;
      if (now < f.obstructionUntil) { f.nextReviewAt = f.obstructionUntil; continue; }
    }
    if (f.proceduralError && f.proceduralError.correctedAt == null && now >= f.proceduralError.dueAt) {
      const pool = f.agency === 'fbi' ? w.fbiIds : w.policeIds;
      const reviewer = pool.map(id => w.people[id]).filter((p): p is Person => !!p && p.status === 'active' && p.id !== f.proceduralError!.officerId)
        .sort((a, b) => serviceQuality(b) - serviceQuality(a) || a.id - b.id)[0];
      if (reviewer) {
        f.proceduralError.correctedAt = now;
        f.proceduralError.correctedBy = reviewer.id;
        const scene = f.evidence.find(e => e.kind === 'scene');
        if (scene) { scene.strength = Math.min(20, scene.strength + 7); scene.note = 'Scene evidence corrected after an independent supervisor review'; }
        recordServiceCase(reviewer);
      } else f.proceduralError.dueAt = now + 3 * 60;
    }
    if (f.warrantExpiresAt != null && now >= f.warrantExpiresAt) {
      const issued = f.warrantAt ?? f.openedAt;
      delete f.warrantAt; delete f.warrantExpiresAt;
      if (f.lastLeadAt <= issued) { f.stage = 'cold'; f.coldAt = now; continue; }
    }
    const detained = f.stage === 'arrested';
    if (!detained && f.identityConfidence >= 65 && strength >= 45) {
      if (f.politicalPressure && now < f.politicalPressure.until) { f.nextReviewAt = f.politicalPressure.until; continue; }
      if (!f.politicalPressure) {
        const official = politicalPressureSource(w, c.gangId);
        if (official) {
          f.politicalPressure = { sourceId: official.id, appliedAt: now, until: now + 90 };
          f.nextReviewAt = f.politicalPressure.until;
          continue;
        }
      }
    }
    if (!detained && f.identityConfidence >= 65 && strength >= 45 && (f.arrestAttemptAfter == null || f.arrestAttemptAfter <= now) &&
        (f.prosecutorDecision !== 'investigate' && f.prosecutorDecision !== 'decline' || f.chargingReviewedAt == null || f.lastLeadAt > f.chargingReviewedAt)) {
      if (f.warrantAt == null) {
        f.warrantAt = now; f.warrantExpiresAt = now + 14 * FULL_DAY_MINUTES;
        if (f.suspectId != null && w.people[f.suspectId]?.gangId != null && w.gangs[w.people[f.suspectId].gangId!]?.isPlayer)
          addMessage(w, 'police', `Police issued an arrest warrant for ${w.people[f.suspectId].name}.`, f.lastKnownPos ?? f.pos, f.suspectId);
      }
      f.stage = 'wanted';
    } else if (!detained && !caseHasWarrant(w, c)) {
      delete f.warrantAt; delete f.warrantExpiresAt;
      f.stage = f.identityConfidence >= 65 ? 'identified' : 'investigating';
    }
    if (!detained && now - f.lastLeadAt > 2 * FULL_DAY_MINUTES && !caseHasWarrant(w, c)) { f.stage = 'cold'; f.coldAt = now; continue; }
    // A last known location ages; it is never replaced by the suspect's real
    // hidden position. Searching the stale address can simply fail.
    if (f.lastSeenAt != null && now - f.lastSeenAt > KNOWN_POSITION_MINUTES) delete f.lastKnownBuildingId;
    if (f.arrestAttemptAfter == null || f.arrestAttemptAfter <= now) assignTask(w, c, active);
  }
  refreshPoliceWanted(w);
}
