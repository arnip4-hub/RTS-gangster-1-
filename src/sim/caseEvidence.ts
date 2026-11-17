import { campaignMinute } from './calendar';
import { ORDERS } from './constants';
import type { CourtCase, CrimeRecord, ID, OrderType, PoliceEvidence, PoliceFile, WitnessStatement, WorldState } from './types';
import { buildingDoor } from './world';

const cap = (n: number) => Math.max(0, Math.min(100, n));
const finished = new Set(['acquitted', 'convicted', 'dismissed']);

/** A police file can hold an unreported witness memory without making it known
 * to the authorities. In particular, this helper never identifies the culprit. */
export function ensurePoliceFile(w: WorldState, crime: CrimeRecord, pos?: PoliceFile['pos'], agency: PoliceFile['agency'] = 'police'): PoliceFile {
  if (crime.police) {
    if (agency === 'fbi') crime.police.agency = agency;
    return crime.police;
  }
  const now = campaignMinute(w), b = crime.buildingId == null ? undefined : w.buildings[crime.buildingId];
  const victim = crime.victimId == null ? undefined : w.people[crime.victimId];
  const scene = pos ?? (b ? buildingDoor(w, b) : victim?.status === 'dead' ? victim.pos : undefined);
  return crime.police = {
    agency, stage: 'reported', openedAt: now, pos: scene ? { ...scene } : { x: 0, y: 0 },
    statements: [], evidence: [], identityConfidence: 0,
    nextReviewAt: now + 30, lastLeadAt: now,
  };
}

/** A statement is usable only after it reaches police, while its witness can
 * give evidence. Court interference is specific to the corresponding file. */
export function activeCaseStatements(w: WorldState, crime: CrimeRecord, court?: CourtCase): WitnessStatement[] {
  const now = campaignMinute(w);
  return (crime.police?.statements ?? []).filter(s => {
    const p = w.people[s.witnessId];
    return s.reportedAt != null && s.reportedAt <= now && !s.withdrawn && p?.status === 'active' &&
      !court?.bribedWitnessIds?.includes(s.witnessId) && !court?.silencedWitnessIds?.includes(s.witnessId);
  });
}

function liveEvidence(w: WorldState, crime: CrimeRecord, court?: CourtCase): PoliceEvidence[] {
  const now = campaignMinute(w);
  return (crime.police?.evidence ?? []).filter(e => e.collectedAt <= now &&
    (e.kind === 'financial' || e.kind === 'scene' || e.witnessId == null || w.people[e.witnessId]?.status === 'active' &&
      !court?.bribedWitnessIds?.includes(e.witnessId) && !court?.silencedWitnessIds?.includes(e.witnessId) &&
      !crime.police?.statements.some(s => s.witnessId === e.witnessId && s.withdrawn)));
}

/** Strength of this file, with no contribution from gang-wide heat or unrelated
 * crimes. Statements are scored once, rather than baked in and counted again. */
export function caseEvidenceStrength(w: WorldState, crime: CrimeRecord, court?: CourtCase): number {
  if (!crime.reported || !crime.police) return 0;
  const accused = court?.defendantId ?? crime.police.suspectId;
  const statements = activeCaseStatements(w, crime, court).filter(s => accused == null || s.suspectId == null || s.suspectId === accused).map(s => {
    const observation = s.observation === 'sound' ? .08 : s.suspectId == null ? .12 : s.interviewedAt == null ? .35 : .55;
    return cap(s.confidence) * cap(s.reliability) / 100 * observation;
  }).sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0);
  // Statement evidence is an interview marker: the original statement above
  // supplies its weight. Scene clues prove an incident, never its perpetrator.
  const physical = liveEvidence(w, crime, court).filter(e => e.kind !== 'statement' && (accused == null || e.personId == null || e.personId === accused))
    .reduce((a, e) => a + cap(e.strength), 0);
  return cap(Math.min(85, statements) + Math.min(75, physical));
}

/** New evidence can revive a cold investigation, but it cannot silently undo a
 * completed court verdict. Identical observations do not grow a case forever. */
export function addCaseEvidence(w: WorldState, crime: CrimeRecord, evidence: PoliceEvidence): void {
  const file = ensurePoliceFile(w, crime);
  const duplicate = file.evidence.some(e => e.kind === evidence.kind && e.note === evidence.note &&
    e.personId === evidence.personId && e.witnessId === evidence.witnessId && e.buildingId === evidence.buildingId);
  if (duplicate) return;
  file.evidence.push({ ...evidence, strength: cap(evidence.strength) });
  if (file.evidence.length > 64) file.evidence.splice(0, file.evidence.length - 64);
  file.lastLeadAt = Math.max(file.lastLeadAt, evidence.collectedAt);
  file.nextReviewAt = Math.min(file.nextReviewAt, campaignMinute(w));
  const concluded = Object.values(w.cases).some(c => c.sourceCrimeId === crime.id && finished.has(c.status));
  if (!concluded && (file.stage === 'cold' || file.stage === 'closed' && file.prosecutorDecision === 'decline')) {
    file.stage = 'investigating'; delete file.coldAt;
  }
}

/** Identification follows received observations, never CrimeRecord's true
 * perpetratorId. Sound and clothing descriptions do not identify a person. */
export function refreshCaseIdentity(w: WorldState, crime: CrimeRecord, court?: CourtCase): void {
  const file = crime.police;
  if (!file || !crime.reported) return;
  const ratings = new Map<ID, number[]>();
  for (const s of activeCaseStatements(w, crime, court)) {
    if (s.suspectId == null || !w.people[s.suspectId] || !['face', 'direct'].includes(s.observation)) continue;
    const list = ratings.get(s.suspectId) ?? [];
    list.push(cap(s.confidence) * (.65 + cap(s.reliability) / 100 * .35)); ratings.set(s.suspectId, list);
  }
  for (const e of liveEvidence(w, crime, court)) {
    if (e.personId == null || !w.people[e.personId] || !['financial', 'rescue', 'direct', 'informant'].includes(e.kind)) continue;
    const list = ratings.get(e.personId) ?? [];
    // Named accounting records or a rescued victim's identification are a
    // specific link, unlike a visitor merely seen near a building.
    const confidence = ['financial', 'rescue', 'direct'].includes(e.kind) ? 85 : Math.min(75, e.strength + 35);
    list.push(confidence); ratings.set(e.personId, list);
  }
  // A plate points to its registered driver, not necessarily the person who
  // committed the crime. It is a lead only and cannot establish identity alone.
  for (const e of liveEvidence(w, crime, court)) {
    if (e.kind !== 'plate' || e.personId == null || !w.people[e.personId]) continue;
    const list = ratings.get(e.personId) ?? [];
    list.push(40);
    ratings.set(e.personId, list);
  }
  const candidates = [...ratings].map(([id, values]) => {
    values.sort((a, b) => b - a);
    return { id, confidence: cap(values[0] + Math.min(12, (values.length - 1) * 6)) };
  }).sort((a, b) => b.confidence - a.confidence || a.id - b.id);
  const best = candidates[0];
  if (!best || best.confidence < 45) {
    file.identityConfidence = best?.confidence ?? 0;
    delete file.suspectId; delete file.warrantAt; delete file.warrantExpiresAt;
    if (file.stage === 'wanted') file.stage = 'investigating';
    return;
  }
  if (file.suspectId != null && file.suspectId !== best.id) {
    delete file.warrantAt; delete file.warrantExpiresAt; delete file.lastKnownPos; delete file.lastKnownBuildingId; delete file.lastSeenAt;
  }
  file.suspectId = best.id;
  // Contradictory identifications require corroboration, rather than selecting
  // the lower person ID as an arbitrarily certain accusation.
  file.identityConfidence = candidates[1] && best.confidence - candidates[1].confidence < 10 ? Math.min(60, best.confidence) : best.confidence;
  if (file.identityConfidence < 65) {
    delete file.warrantAt; delete file.warrantExpiresAt;
    if (file.stage === 'wanted') file.stage = 'investigating';
  }
}

export function caseHasWarrant(w: WorldState, crime: CrimeRecord, personId?: ID): boolean {
  const f = crime.police, now = campaignMinute(w);
  return !!(crime.reported && f && f.suspectId != null && (personId == null || f.suspectId === personId) &&
    f.warrantAt != null && f.warrantAt <= now && (f.warrantExpiresAt == null || f.warrantExpiresAt > now) &&
    !['closed', 'charged', 'arrested'].includes(f.stage));
}

/** The UI's wanted score is now a projection of issued, identified warrants.
 * An unreported event never marks a man, or the rest of his crew, as wanted. */
export function refreshPoliceWanted(w: WorldState): void {
  if (!w.options.continuousTime) return;
  const scores = new Map<ID, number>(), federal = new Set<ID>();
  for (const c of w.crimes) {
    if (!caseHasWarrant(w, c)) continue;
    const id = c.police!.suspectId!;
    const severity = ORDERS[c.kind as OrderType]?.severity ?? 8;
    scores.set(id, Math.max(scores.get(id) ?? 0, Math.min(100, 35 + severity * 5)));
    if (c.police!.agency === 'fbi') federal.add(id);
  }
  for (const p of Object.values(w.people)) {
    if (p.gangId == null) continue;
    p.wanted = scores.get(p.id) ?? 0;
    if (federal.has(p.id)) p.fbiWarrant = true; else delete p.fbiWarrant;
  }
}
