import { campaignMinute } from '../sim/calendar';
import { caseEvidenceStrength, caseHasWarrant } from '../sim/caseEvidence';
import { RTS_CHARGE_THRESHOLD, RTS_IDENTITY_THRESHOLD } from '../sim/rtsCourts';
import type { CrimeRecord, ID, Person, PoliceFile, WorldState } from '../sim/types';

/** File access is learned through the lawyer or the officer actually handling it. */
export function policeFileDisclosed(w: WorldState, crime: CrimeRecord, viewer: ID): boolean {
  const officer = crime.investigatorId == null ? undefined : w.people[crime.investigatorId];
  return !!(crime.police?.disclosureKnown || crime.investigatorKnown ||
    officer?.employedBy === viewer || officer?.bribedBy === viewer);
}

export function activeWarrants(w: WorldState, personId: ID): CrimeRecord[] {
  return w.crimes.filter(crime => caseHasWarrant(w, crime, personId));
}

export function personHasWarrant(w: WorldState, person: Person): boolean {
  return w.options.continuousTime ? activeWarrants(w, person.id).length > 0 : person.wanted >= 50;
}

export function personWantedLabel(w: WorldState, person: Person): string {
  if (!w.options.continuousTime) return `Wanted ${Math.round(person.wanted)}`;
  return personHasWarrant(w, person) ? 'Arrest warrant' : 'No active warrant';
}

const STAGES: Record<PoliceFile['stage'], string> = {
  reported: 'Report received', investigating: 'Investigation in progress', cold: 'Cold case',
  identified: 'Suspect identified', wanted: 'Arrest warrant', arrested: 'In custody',
  charged: 'Charges filed', closed: 'File closed',
};

export function policeStageLabel(file: PoliceFile, at = Infinity): string {
  if (['reported', 'investigating'].includes(file.stage) && file.suspectId == null) {
    return file.statements.some(s => !s.withdrawn && s.reportedAt != null && s.reportedAt <= at && s.observation !== 'sound')
      ? 'Description only · offender unidentified' : 'Offender unidentified';
  }
  return STAGES[file.stage];
}


/** Why this file is where it is. Never names the simulation's true culprit. */
function caseStatusReason(w: WorldState, crime: CrimeRecord, disclosed: boolean): string | null {
  const file = crime.police;
  if (!file) return null;
  const bits: string[] = [];
  const victim = crime.victimId == null ? undefined : w.people[crime.victimId];
  if (victim) bits.push(`Victim: ${victim.name}`);
  if ((crime.shots ?? 0) > 1) bits.push(`${crime.shots} shots in this fight`);
  if (file.statusNote) bits.push(file.statusNote);
  if (!disclosed) return bits.join(' · ') || null;
  const naming = file.statements.filter(s => !s.withdrawn && s.suspectId != null && ['face', 'direct'].includes(s.observation));
  const named = new Set(naming.map(s => s.suspectId));
  if (named.size === 0 && file.suspectId == null) bits.push('No face identification; the offender is not named.');
  else if (named.size > 1 && file.identityConfidence <= 60 && file.identityConfidence > 0)
    bits.push('Two identifications are too close to name one man.');
  else if (file.suspectId != null && file.identityConfidence < RTS_IDENTITY_THRESHOLD)
    bits.push(`Identification ${Math.round(file.identityConfidence)}; a warrant needs ${RTS_IDENTITY_THRESHOLD}.`);
  if (!file.statusNote && (file.prosecutorDecision === 'investigate' || file.prosecutorDecision === 'pending')) {
    const strength = Math.round(caseEvidenceStrength(w, crime));
    if (strength > 0 && strength < RTS_CHARGE_THRESHOLD)
      bits.push(`Evidence ${strength}; charging needs ${RTS_CHARGE_THRESHOLD}.`);
  }
  return [...new Set(bits)].join(' · ') || null;
}

/** Exposing a report never exposes the simulation's true culprit. */
export function policeCaseView(w: WorldState, crime: CrimeRecord, viewer: ID) {
  const file = crime.police;
  const disclosed = policeFileDisclosed(w, crime, viewer);
  const court = Object.values(w.cases).filter(c => c.sourceCrimeId === crime.id && c.gangId === viewer)
    .sort((a, b) => Number(['awaiting', 'onTrial'].includes(b.status)) - Number(['awaiting', 'onTrial'].includes(a.status)) || b.id - a.id)[0];
  const detained = Object.values(w.people).find(p => p.gangId === viewer && p.custody?.crimeId === crime.id &&
    ['arrested', 'onTrial'].includes(p.status));
  const publicWarrant = file?.suspectId != null && w.people[file.suspectId]?.gangId === viewer &&
    activeWarrants(w, file.suspectId).some(c => c.id === crime.id);
  const suspectId = court?.defendantId ?? detained?.id ?? (disclosed || publicWarrant ? file?.suspectId : undefined);
  const future = campaignMinute(w);
  const receivedStatements = file?.statements.filter(s => s.reportedAt != null && s.reportedAt <= future) ?? [];
  const collectedEvidence = file?.evidence.filter(e => e.collectedAt <= future) ?? [];
  const statements = disclosed ? receivedStatements : [];
  return {
    disclosed,
    suspectId,
    suspectName: suspectId == null ? null : w.people[suspectId]?.name ?? null,
    status: disclosed && file ? policeStageLabel(file, future) : court ? ({ awaiting: 'Charges filed', onTrial: 'Charges filed',
      appealing: 'Appeal pending', acquitted: 'Acquitted', convicted: 'Convicted', dismissed: 'Case dismissed' })[court.status] : detained ? 'In custody'
      : publicWarrant ? 'Arrest warrant' : 'Police file · details not disclosed',
    // Heard shots alone do not establish that anyone was killed.
    title: crime.kind === 'Shootout and homicide' ? 'Shootout and homicide'
      : file && !collectedEvidence.some(e => ['scene', 'direct', 'rescue'].includes(e.kind)) &&
      receivedStatements.length > 0 && receivedStatements.every(s => s.observation === 'sound')
      ? 'Reported disturbance' : crime.kind === 'shootout' ? 'Shootout' : crime.kind,
    statements,
    evidence: disclosed ? collectedEvidence : [],
    prosecutorId: disclosed || court ? file?.prosecutorId ?? court?.daId : undefined,
    prosecutorDecision: disclosed ? file?.prosecutorDecision : undefined,
    reason: caseStatusReason(w, crime, disclosed),
    court,
  };
}

export const OBSERVATION_LABELS = {
  sound: 'Heard a disturbance', description: 'Saw a description', face: 'Recognized a face',
  vehicle: 'Saw a vehicle', direct: 'Direct observation',
} as const;

/** A deadline shown in the same 24-hour calendar as the live RTS city. */
export function lawDeadline(w: WorldState, at: number): string {
  const remaining = Math.max(0, Math.ceil(at - campaignMinute(w)));
  if (remaining === 0) return 'due now';
  const day = Math.floor(at / 1440), hour = Math.floor(at % 1440 / 60), minute = Math.floor(at % 60);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const wait = remaining >= 1440 ? `${Math.floor(remaining / 1440)}d${Math.floor(remaining % 1440 / 60) ? ` ${Math.floor(remaining % 1440 / 60)}h` : ''}`
    : remaining >= 60 ? `${Math.floor(remaining / 60)}h${remaining % 60 ? ` ${remaining % 60}m` : ''}` : `${remaining}m`;
  return `${days[day % 7]} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} · in ${wait}`;
}
