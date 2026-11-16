import { campaignMinute, FULL_DAY_MINUTES } from './calendar';
import { caseEvidenceStrength, ensurePoliceFile, addCaseEvidence, refreshCaseIdentity, refreshPoliceWanted } from './caseEvidence';
import { availableOfficial, ensureCourtOfficials } from './courtOfficials';
import { addMessage, addNews } from './events';
import { clearDestination } from './movement';
import { placeInPrison } from './prison';
import type { Rng } from './rng';
import { availableSpecialist } from './specialists';
import type { CourtCase, CrimeRecord, ID, Person, WorldState } from './types';
import { peopleList } from './entityLists';
import { describeCrime } from './systems/law';

/** Game-time deadlines; none of these change the agreed RTS clock rate. */
export const RTS_CHARGE_THRESHOLD = 55;
export const RTS_IDENTITY_THRESHOLD = 65;
export const RTS_COURT_REVIEW_MINUTES = 15;
export const RTS_REASSIGNMENT_DELAY = 12 * 60;

const openStatus = (c: CourtCase) => c.status === 'awaiting' || c.status === 'onTrial';

/** A legacy hearing keeps an explicit future deadline and its existing file. */
export function normalizeRtsCourts(w: WorldState): void {
  if (!w.options.continuousTime) return;
  const now = campaignMinute(w);
  for (const c of Object.values(w.cases)) {
    if (!openStatus(c)) { c.reviewAt ??= now + 2 * FULL_DAY_MINUTES; continue; }
    c.openedAt ??= now;
    c.trialAt ??= now + Math.max(1, c.weeksToTrial) * FULL_DAY_MINUTES;
    c.reviewAt ??= now;
  }
}

/** Disclosed account books are an actual evidentiary lead, not a fresh murder
 * or a gang-wide courtroom bonus. Their source remains the accountant's file. */
export function recordTaxDisclosures(w: WorldState, crimes: CrimeRecord[]): void {
  if (!w.options.continuousTime) return;
  const now = campaignMinute(w);
  const desk = Object.values(w.buildings).find(b => b.typeId === 'courthouse');
  const pos = desk ? w.lots[desk.lotId].center : { x: 0, y: 0 };
  for (const crime of crimes) {
    crime.reportedAt ??= now;
    const file = ensurePoliceFile(w, crime, pos, 'fbi');
    addCaseEvidence(w, crime, { kind: 'financial', strength: 45 + crime.arrestRisk * 20,
      personId: crime.perpetratorId, collectedAt: now,
      note: 'Account books disclosed by the accountant identify unpaid tax.' });
    file.suspectId = crime.perpetratorId;
    file.identityConfidence = Math.max(file.identityConfidence, 85);
    file.stage = 'identified';
  }
}

/** Release ends this detention; it does not invent a different charge from the
 * simulation's private history. A fresh lead is needed before another attempt. */
function releaseCustody(w: WorldState, person: Person, crime: CrimeRecord | undefined, reason: string): void {
  const now = campaignMinute(w), file = crime?.police;
  delete person.custody;
  if (person.status === 'arrested' || person.status === 'onTrial') person.status = 'active';
  clearDestination(person);
  if (file && file.stage !== 'closed') {
    delete file.warrantAt;
    delete file.warrantExpiresAt;
    file.arrestAttemptAfter = now + FULL_DAY_MINUTES;
    file.stage = file.prosecutorDecision === 'decline' ? 'cold' : 'investigating';
  }
  if (person.gangId != null && w.gangs[person.gangId]?.isPlayer)
    addMessage(w, 'police', `${person.name} was released: ${reason}.`, person.pos, person.id);
}

function chooseJurors(w: WorldState, rng: Rng): ID[] {
  const candidates = peopleList(w).filter(p => p.role === 'owner' && p.status === 'active');
  const ids: ID[] = [];
  while (ids.length < 6 && candidates.length) ids.push(candidates.splice(rng.int(0, candidates.length - 1), 1)[0].id);
  return ids;
}

function assignProsecutor(w: WorldState, rng: Rng, crime: CrimeRecord): Person | undefined {
  const file = crime.police!;
  const current = file.prosecutorId == null ? undefined : availableOfficial(w, file.prosecutorId, 'da');
  if (current) return current;
  const active = w.daIds.filter(id => availableOfficial(w, id, 'da'));
  if (!active.length) return undefined;
  file.prosecutorId = rng.pick(active);
  return w.people[file.prosecutorId];
}

/** Each person is reviewed against the file that actually caused detention. */
function reviewCustody(w: WorldState, rng: Rng): void {
  const now = campaignMinute(w);
  for (const person of peopleList(w)) {
    if (person.status !== 'arrested') continue;
    if (Object.values(w.cases).some(c => c.defendantId === person.id && openStatus(c))) continue;
    const custody = person.custody;
    if (!custody) {
      // Unexplained arrests in a legacy save cannot generate a new default charge.
      releaseCustody(w, person, undefined, 'no recorded grounds for detention');
      continue;
    }
    const crime = w.crimes.find(c => c.id === custody.crimeId);
    const file = crime?.police;
    if (crime && file) refreshCaseIdentity(w, crime);
    if (!crime || !file || !crime.reported || file.suspectId !== person.id || person.gangId == null) {
      if (file) file.prosecutorDecision = 'decline';
      releaseCustody(w, person, crime, 'the arrest file does not identify this suspect');
      continue;
    }
    if (now < custody.reviewAt && now < custody.releaseAt) continue;
    const prosecutor = assignProsecutor(w, rng, crime);
    if (!prosecutor) {
      if (now >= custody.releaseAt) releaseCustody(w, person, crime, 'the charging deadline expired');
      else custody.reviewAt = Math.min(custody.releaseAt, now + 60);
      continue;
    }
    file.chargingReviewedAt = now;
    file.reviewDueAt = now + 2 * 60;
    const strength = caseEvidenceStrength(w, crime);
    if (file.identityConfidence < RTS_IDENTITY_THRESHOLD || strength < 25 || file.stage === 'closed') {
      file.prosecutorDecision = 'decline';
      releaseCustody(w, person, crime, 'the prosecutor declined the evidence');
      continue;
    }
    if (strength < RTS_CHARGE_THRESHOLD) {
      file.prosecutorDecision = 'investigate';
      file.nextReviewAt = Math.min(file.nextReviewAt, now + 30);
      if (now >= custody.releaseAt) releaseCustody(w, person, crime, 'further investigation is needed');
      else custody.reviewAt = Math.min(custody.releaseAt, now + 2 * 60);
      continue;
    }
    const gang = w.gangs[person.gangId];
    const judges = w.judgeIds.filter(id => availableOfficial(w, id, 'judge'));
    if (!gang || !judges.length) {
      if (now >= custody.releaseAt) releaseCustody(w, person, crime, 'the charging deadline expired');
      else custody.reviewAt = Math.min(custody.releaseAt, now + 60);
      continue;
    }
    file.prosecutorDecision = 'charge';
    file.chargedAt = now;
    file.stage = 'charged';
    const witnessIds = [...new Set([...file.statements.filter(s => s.reportedAt != null && s.reportedAt <= now && !s.withdrawn)
      .map(s => s.witnessId), ...file.evidence.map(e => e.witnessId).filter((id): id is ID => id != null)])];
    const court: CourtCase = {
      id: w.sequences.court++, defendantId: person.id, gangId: gang.id,
      crime: describeCrime(crime.kind), sourceCrimeId: crime.id,
      investigatorId: crime.investigatorId, investigatorKnown: crime.investigatorKnown,
      judgeId: rng.pick(judges), daId: prosecutor.id, witnessIds, jurorIds: chooseJurors(w, rng),
      weeksToTrial: 0, status: 'awaiting', knowsWitnesses: false, knowsJurors: false,
      judgeBribed: false, strength, openedAt: now, trialAt: now + rng.int(1, 2) * FULL_DAY_MINUTES,
      reviewAt: now + RTS_COURT_REVIEW_MINUTES,
    };
    w.cases[court.id] = court;
    person.status = 'onTrial';
    if (gang.isPlayer) addMessage(w, 'police', `${prosecutor.name} charged ${person.name} with ${court.crime}.`, person.pos, person.id);
  }
}

function closeCase(w: WorldState, court: CourtCase, status: CourtCase['status']): void {
  court.status = status;
  court.reviewAt = campaignMinute(w) + 2 * FULL_DAY_MINUTES;
  const source = court.sourceCrimeId == null ? undefined : w.crimes.find(c => c.id === court.sourceCrimeId);
  if (source?.police) {
    source.police.stage = 'closed';
    delete source.police.warrantAt;
    delete source.police.warrantExpiresAt;
  }
  const defendant = w.people[court.defendantId];
  if (defendant) {
    delete defendant.custody;
    if (status !== 'convicted' && ['arrested', 'onTrial'].includes(defendant.status)) defendant.status = 'active';
  }
}

function progressRtsCases(w: WorldState, rng: Rng): void {
  const now = campaignMinute(w);
  for (const court of Object.values(w.cases)) {
    if (!openStatus(court)) continue;
    if (court.reviewAt != null && now < court.reviewAt) continue;
    court.reviewAt = now + RTS_COURT_REVIEW_MINUTES;
    const defendant = w.people[court.defendantId], gang = w.gangs[court.gangId];
    if (!defendant || !gang || defendant.status === 'dead') { closeCase(w, court, 'dismissed'); continue; }
    const source = court.sourceCrimeId == null ? undefined : w.crimes.find(c => c.id === court.sourceCrimeId);
    let reassigned = false;
    if (!availableOfficial(w, court.judgeId, 'judge')) {
      const available = w.judgeIds.filter(id => availableOfficial(w, id, 'judge'));
      if (!available.length) continue;
      court.judgeId = rng.pick(available); court.judgeBribed = false; reassigned = true;
    }
    if (!availableOfficial(w, court.daId, 'da')) {
      const available = w.daIds.filter(id => availableOfficial(w, id, 'da'));
      if (!available.length) continue;
      court.daId = rng.pick(available); reassigned = true;
      if (source?.police) source.police.prosecutorId = court.daId;
    }
    if (court.investigatorId != null && w.people[court.investigatorId]?.status !== 'active') {
      const existing = source?.investigatorId;
      const pool = source?.police?.agency === 'fbi' ? w.fbiIds : w.policeIds;
      court.investigatorId = existing != null && w.people[existing]?.status === 'active'
        ? existing : pool.find(id => w.people[id]?.status === 'active');
      court.investigatorKnown = false; reassigned = true;
      if (source) { source.investigatorId = court.investigatorId; source.investigatorKnown = false; }
    }
    const seated = new Set(court.jurorIds);
    for (let i = 0; i < court.jurorIds.length; i++) {
      if (w.people[court.jurorIds[i]]?.status === 'active') continue;
      const candidates = peopleList(w).filter(p => p.role === 'owner' && p.status === 'active' && !seated.has(p.id));
      seated.delete(court.jurorIds[i]);
      if (candidates.length) {
        court.jurorIds[i] = rng.pick(candidates).id;
        seated.add(court.jurorIds[i]);
      } else court.jurorIds.splice(i--, 1);
      court.knowsJurors = false; reassigned = true;
    }
    if (reassigned) court.trialAt = Math.max(court.trialAt ?? now, now + RTS_REASSIGNMENT_DELAY);
    if (court.judgeBribed || (w.people[court.judgeId].opinion[gang.id] ?? 0) > 55) {
      closeCase(w, court, 'dismissed');
      if (gang.isPlayer) addMessage(w, 'police', `${defendant.name} walked free — case dismissed.`);
      continue;
    }
    // Legacy cases keep their existing snapshot. Newly charged cases always use
    // the current, source-specific file so lost testimony is not baked in.
    if (source?.police) {
      refreshCaseIdentity(w, source, court);
      court.strength = caseEvidenceStrength(w, source, court);
    }
    if (source?.police && (source.police.suspectId !== defendant.id || source.police.identityConfidence < RTS_IDENTITY_THRESHOLD || court.strength < 25)) {
      closeCase(w, court, 'dismissed');
      if (gang.isPlayer) addMessage(w, 'police', `${defendant.name}'s case collapsed after its evidence was reviewed.`);
      continue;
    }
    if (now < (court.trialAt ?? now + FULL_DAY_MINUTES)) { court.status = 'onTrial'; continue; }
    const da = w.people[court.daId], lawyer = availableSpecialist(w, gang, 'lawyer');
    const friendlyJurors = court.jurorIds.filter(id => court.bribedJurorIds?.includes(id) || (w.people[id]?.opinion[gang.id] ?? 0) > 25).length;
    let prosecution = court.strength * .9 + da.skills.intelligence * 5;
    const investigator = court.investigatorId == null ? undefined : w.people[court.investigatorId];
    if (investigator?.employedBy === gang.id || investigator?.bribedBy === gang.id) prosecution *= .82;
    const defence = (lawyer?.skills.intelligence ?? .5) * 10 + friendlyJurors * 7 + 10;
    const convicted = prosecution * rng.range(.85, 1.15) > defence * rng.range(.85, 1.15);
    closeCase(w, court, convicted ? 'convicted' : 'acquitted');
    if (convicted) {
      defendant.status = 'jailed';
      defendant.jailWeeks = defendant.role === 'boss' ? 999 : rng.int(2, 6);
      placeInPrison(w, defendant);
      w.weekLog.push(`${defendant.name} was convicted of ${court.crime}.`);
      if (gang.isPlayer) addMessage(w, 'police', `${defendant.name} was convicted and jailed.`);
      addNews(w, { section: 'law', headline: 'GUILTY VERDICT RETURNED', body: `${defendant.name} was found guilty of ${court.crime}.`, gangId: gang.id });
    } else {
      w.weekLog.push(`${defendant.name} was acquitted.`);
      if (gang.isPlayer) addMessage(w, 'police', `${defendant.name} was acquitted.`);
    }
  }
}

/** New arrests are processed without waiting for another crime report. Only
 * active hearings need scheduled work; custody deadlines are checked each minute. */
export function tickRtsCourts(w: WorldState, rng: Rng): void {
  if (!w.options.continuousTime || w.phase !== 'week') return;
  if (w.minute % 60 === 0 || !w.judgeIds.some(id => availableOfficial(w, id, 'judge')) ||
    !w.daIds.some(id => availableOfficial(w, id, 'da'))) ensureCourtOfficials(w, rng);
  normalizeRtsCourts(w);
  reviewCustody(w, rng);
  progressRtsCases(w, rng);
  const now = campaignMinute(w);
  for (const court of Object.values(w.cases)) if (!openStatus(court) && court.reviewAt != null && now >= court.reviewAt)
    delete w.cases[court.id];
  if (w.minute % RTS_COURT_REVIEW_MINUTES === 0) refreshPoliceWanted(w);
}

