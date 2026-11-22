import { campaignMinute, FULL_DAY_MINUTES } from './calendar';
import { caseEvidenceStrength, ensurePoliceFile, addCaseEvidence, refreshCaseIdentity, refreshPoliceWanted } from './caseEvidence';
import { availableOfficial, ensureCourtOfficials } from './courtOfficials';
import { addMessage, addNews } from './events';
import { clearDestination } from './movement';
import { placeInPrison } from './prison';
import type { Rng } from './rng';
import { availableSpecialist } from './specialists';
import { specialistJobActive } from './specialistJobs';
import type { CourtCase, CrimeRecord, ID, Person, WorldState } from './types';
import { peopleList } from './entityLists';
import { describeCrime, sentenceWeeks } from './systems/law';
import { ensurePublicService, recordServiceCase, serviceQuality } from './publicService';

/** Game-time deadlines; none of these change the agreed RTS clock rate. */
export const RTS_CHARGE_THRESHOLD = 55;
export const RTS_IDENTITY_THRESHOLD = 65;
export const RTS_COURT_REVIEW_MINUTES = 15;
export const RTS_REASSIGNMENT_DELAY = 12 * 60;

const openStatus = (c: CourtCase) => c.status === 'awaiting' || c.status === 'onTrial' || c.status === 'appealing';

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

function conductDetentionInterview(w: WorldState, rng: Rng, crime: CrimeRecord, defendant: Person,
  interviewer: Person, now: number): void {
  const file = crime.police!;
  const quality = serviceQuality(interviewer);
  const resolve = defendant.loyalty * .45 + defendant.skills.intelligence * 7 + defendant.skills.stealth * 2;
  const leadChance = Math.max(.08, Math.min(.4, .22 + (55 - resolve) * .003 + (quality - 50) * .001));
  const outcome: NonNullable<typeof file.interrogation>['outcome'] = rng.chance(leadChance)
    ? 'new-lead' : rng.chance(.34) ? 'inconsistent' : 'no-comment';
  const reliability = Math.max(15, Math.min(95, Math.round(quality + rng.range(-12, 12))));
  file.interrogation = { interviewerId: interviewer.id, at: now, outcome, reliability };
  recordServiceCase(interviewer);
  if (outcome !== 'no-comment') addCaseEvidence(w, crime, { kind: 'interrogation', strength: outcome === 'new-lead' ? 7 : 3,
    personId: defendant.id, collectedAt: now,
    note: outcome === 'new-lead'
      ? 'Detention interview produced a lead for follow-up; it was not an admission.'
      : 'The subject changed part of his account; this is a weak lead, not proof of guilt.' });
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
      if (file) {
        file.prosecutorDecision = 'decline';
        file.statusNote = 'The arrest file does not identify this suspect.';
      }
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
    const interviewer = crime.investigatorId == null ? w.people[custody.officerId] : w.people[crime.investigatorId];
    if (!file.interrogation && interviewer?.status === 'active') conductDetentionInterview(w, rng, crime, person, interviewer, now);
    if (!file.prosecutionReviewedAt) { recordServiceCase(prosecutor); file.prosecutionReviewedAt = now; }
    const strength = caseEvidenceStrength(w, crime);
    if (file.identityConfidence < RTS_IDENTITY_THRESHOLD || strength < 25 || file.stage === 'closed') {
      file.prosecutorDecision = 'decline';
      file.statusNote = file.identityConfidence < RTS_IDENTITY_THRESHOLD
        ? `Identification is ${Math.round(file.identityConfidence)}; charging needs ${RTS_IDENTITY_THRESHOLD}.`
        : `Evidence is ${Math.round(strength)}; the prosecutor declined.`;
      releaseCustody(w, person, crime, 'the prosecutor declined the evidence');
      continue;
    }
    // A bought prosecutor protects the man. A merely friendly one is reluctant.
    if (prosecutor.bribedBy === person.gangId) {
      file.prosecutorDecision = 'decline';
      file.statusNote = 'The prosecutor is sitting on this case.';
      releaseCustody(w, person, crime, 'the prosecutor is sitting on the case');
      continue;
    }
    const reluctant = (prosecutor.opinion[person.gangId] ?? 0) > 55;
    const chargeThreshold = reluctant ? Math.min(75, RTS_CHARGE_THRESHOLD + 12) : RTS_CHARGE_THRESHOLD;
    if (reluctant) file.statusNote = `The prosecutor is reluctant to charge. Evidence is ${Math.round(strength)}; he wants ${chargeThreshold}.`;
    if (strength < chargeThreshold) {
      file.prosecutorDecision = 'investigate';
      if (!reluctant) file.statusNote = `Evidence is ${Math.round(strength)}; charging needs ${chargeThreshold}.`;
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
    const companions = w.crimes.filter(c => c.id !== crime.id && c.kind === 'Shootout and homicide' &&
      c.police?.suspectId === person.id && c.police.prosecutorDecision !== 'charge' &&
      !Object.values(w.cases).some(existing => existing.sourceCrimeId === c.id || existing.companionCrimeIds?.includes(c.id)));
    for (const extra of companions) {
      if (!extra.police) continue;
      extra.police.prosecutorDecision = 'charge';
      extra.police.chargedAt = now;
      extra.police.stage = 'charged';
      extra.police.statusNote = `Charged with case #${crime.id}.`;
    }
    const companionStrength = companions.reduce((n, c) => n + Math.round(caseEvidenceStrength(w, c) * .5), 0);
    const witnessIds = [...new Set([
      ...file.statements.filter(s => s.reportedAt != null && s.reportedAt <= now && !s.withdrawn).map(s => s.witnessId),
      ...file.evidence.map(e => e.witnessId).filter((id): id is ID => id != null),
      ...companions.flatMap(c => c.police?.statements.filter(s => !s.withdrawn).map(s => s.witnessId) ?? []),
    ])];
    const court: CourtCase = {
      id: w.sequences.court++, defendantId: person.id, gangId: gang.id,
      crime: companions.length ? `${describeCrime(crime.kind)} (${companions.length + 1} counts)` : describeCrime(crime.kind),
      sourceCrimeId: crime.id,
      ...(companions.length ? { companionCrimeIds: companions.map(c => c.id) } : {}),
      investigatorId: crime.investigatorId, investigatorKnown: crime.investigatorKnown,
      judgeId: rng.pick(judges), daId: prosecutor.id, witnessIds, jurorIds: chooseJurors(w, rng),
      weeksToTrial: 0, status: 'awaiting', knowsWitnesses: false, knowsJurors: false,
      judgeBribed: false, strength: Math.min(100, strength + companionStrength), openedAt: now, trialAt: now + rng.int(1, 2) * FULL_DAY_MINUTES,
      reviewAt: now + RTS_COURT_REVIEW_MINUTES,
    };
    serviceQuality(prosecutor);
    serviceQuality(w.people[court.judgeId]);
    w.cases[court.id] = court;
    person.status = 'onTrial';
    if (gang.isPlayer) addMessage(w, 'police', `${prosecutor.name} charged ${person.name} with ${court.crime}${companions.length ? `, including #${companions.map(c => c.id).join(', #')}` : ''}.`, person.pos, person.id);
  }
}

function closeCase(w: WorldState, court: CourtCase, status: CourtCase['status']): void {
  court.status = status;
  court.reviewAt = campaignMinute(w) + (status === 'convicted' ? 7 : 2) * FULL_DAY_MINUTES;
  const source = court.sourceCrimeId == null ? undefined : w.crimes.find(c => c.id === court.sourceCrimeId);
  if (source?.police) {
    source.police.stage = 'closed';
    delete source.police.warrantAt;
    delete source.police.warrantExpiresAt;
  }
  const defendant = w.people[court.defendantId];
  if (defendant) {
    delete defendant.custody;
    if (status !== 'convicted' && ['arrested', 'onTrial', 'jailed'].includes(defendant.status)) {
      defendant.status = 'active';
      defendant.jailWeeks = 0;
      delete defendant.prisonId; delete defendant.prisonSince; delete defendant.prisonOperation;
      delete defendant.prisonProtectedUntil;
    }
  }
}

function reviewAppeal(w: WorldState, rng: Rng, court: CourtCase, defendant: Person, gang: NonNullable<WorldState['gangs'][number]>, source?: CrimeRecord): void {
  const now = campaignMinute(w), lawyer = availableSpecialist(w, gang, 'lawyer');
  const judge = w.people[court.judgeId];
  const investigator = court.investigatorId == null ? undefined : w.people[court.investigatorId];
  const error = source?.police?.proceduralError;
  const weakCase = Math.max(0, Math.min(22, (55 - court.strength) * .55));
  const procedural = error ? error.correctedAt == null ? 20 : 8 : 0;
  const judicialConcern = court.judgeBribed || (judge?.opinion[gang.id] ?? 0) > 55 ? 10 : 0;
  const lawyerSkill = (lawyer?.skills.intelligence ?? .5) * 3.5;
  const investigatorConcern = investigator?.employedBy === gang.id || investigator?.bribedBy === gang.id ? 8 : 0;
  const chance = Math.max(.08, Math.min(.68, .12 + weakCase / 100 + procedural / 100 + judicialConcern / 100 +
    lawyerSkill / 100 + investigatorConcern / 100));
  if (rng.chance(chance)) {
    closeCase(w, court, 'acquitted');
    court.appealDecision = 'overturned';
    if (gang.isPlayer) {
      addMessage(w, 'police', `${defendant.name}'s appeal overturned the conviction; he is free.`);
      addNews(w, { section: 'law', headline: 'CONVICTION OVERTURNED', body: `${defendant.name} was released after an appeal exposed weaknesses in the case.`, gangId: gang.id });
    }
  } else {
    court.status = 'convicted'; court.appealDecision = 'upheld';
    court.reviewAt = now + 7 * FULL_DAY_MINUTES;
    if (gang.isPlayer) addMessage(w, 'police', `${defendant.name}'s conviction was upheld on appeal.`);
  }
}

function progressRtsCases(w: WorldState, rng: Rng): void {
  const now = campaignMinute(w);
  for (const court of Object.values(w.cases)) {
    if (!openStatus(court)) continue;
    if (court.reviewAt != null && now < court.reviewAt) continue;
    if (court.status === 'appealing') {
      const defendant = w.people[court.defendantId], gang = w.gangs[court.gangId];
      const source = court.sourceCrimeId == null ? undefined : w.crimes.find(c => c.id === court.sourceCrimeId);
      if (!defendant || !gang || defendant.status === 'dead') closeCase(w, court, 'dismissed');
      else if (now >= (court.appealDueAt ?? now)) reviewAppeal(w, rng, court, defendant, gang, source);
      continue;
    }
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
    const lawyer = availableSpecialist(w, gang, 'lawyer');
    const lawyerBusy = !!lawyer && Object.values(w.specialistJobs ?? {}).some(j =>
      j.actorId === lawyer.id && specialistJobActive(j));
    if (lawyer && lawyerBusy) {
      court.trialAt = now + 60;
      court.status = 'onTrial';
      if (gang.isPlayer) addMessage(w, 'police', `${defendant.name}'s hearing is delayed; counsel is occupied.`);
      continue;
    }
    const da = w.people[court.daId];
    const friendlyJurors = court.jurorIds.filter(id => court.bribedJurorIds?.includes(id) || (w.people[id]?.opinion[gang.id] ?? 0) > 25).length;
    let prosecution = court.strength * .9 + da.skills.intelligence * 5 + (serviceQuality(da) - 50) * .08;
    prosecution *= .88 + (ensurePublicService(da)?.integrity ?? 60) * .0012;
    const investigator = court.investigatorId == null ? undefined : w.people[court.investigatorId];
    if (investigator?.employedBy === gang.id || investigator?.bribedBy === gang.id) prosecution *= .82;
    if (source?.police?.proceduralError && source.police.proceduralError.correctedAt == null) prosecution *= .88;
    const judge = w.people[court.judgeId];
    const judgeIntegrity = judge ? ensurePublicService(judge)?.integrity ?? 60 : 60;
    if (court.judgeBribed) prosecution *= 1 - (.1 + (100 - judgeIntegrity) * .002);
    else if ((judge?.opinion[gang.id] ?? 0) > 55) prosecution *= .9;
    const jurorWeight = 7 * (1 - Math.min(100, court.strength) / 140);
    const defence = (lawyer?.skills.intelligence ?? .5) * 10 + friendlyJurors * jurorWeight + 10;
    const variance = .08 + (100 - (judge ? serviceQuality(judge) : 50)) * .0008;
    const convicted = prosecution * rng.range(1 - variance, 1 + variance) > defence * rng.range(1 - variance, 1 + variance);
    recordServiceCase(da);
    if (judge) recordServiceCase(judge);
    closeCase(w, court, convicted ? 'convicted' : 'acquitted');
    if (convicted) {
      defendant.status = 'jailed';
      defendant.jailWeeks = sentenceWeeks(court.crime, defendant.role === 'boss', rng);
      placeInPrison(w, defendant);
      w.weekLog.push(`${defendant.name} was convicted of ${court.crime}.`);
      if (gang.isPlayer) addMessage(w, 'police', `${defendant.name} was convicted and jailed${defendant.jailWeeks >= 999 ? '' : ` for ${defendant.jailWeeks} weeks`}.`);
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

