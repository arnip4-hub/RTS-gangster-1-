import { campaignMinute } from './calendar';
import type { WorldState } from './types';

/** Shape checking runs first; these checks protect cross-file knowledge and
 * saved journeys without equating an accusation with simulation truth. */
export function validateLawReferences(w: WorldState): void {
  const crimes = new Map(w.crimes.map(c => [c.id, c]));
  const now = campaignMinute(w);
  const person = (id: number | undefined) => id == null || !!w.people[id];
  const building = (id: number | undefined) => id == null || !!w.buildings[id];
  const time = (n: number) => Number.isFinite(n) && n >= 0;
  const score = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  for (const c of w.crimes) {
    const f = c.police;
    if (!f) continue;
    if ((!w.people[c.perpetratorId] && !(c.leadOnly && c.perpetratorId === 0)) ||
        (!w.gangs[c.gangId] && !(c.leadOnly && c.gangId === 0)) ||
        !time(f.openedAt) || f.openedAt > now || !time(f.nextReviewAt) ||
        !time(f.lastLeadAt) || !score(f.identityConfidence) || !person(f.suspectId) ||
        !person(f.prosecutorId) || !building(f.lastKnownBuildingId) ||
        f.statements.length > 256 || f.evidence.length > 256)
      throw Error('Save has an invalid police file.');
    for (const n of [f.lastSeenAt, f.warrantAt, f.warrantExpiresAt, f.coldAt,
      f.obstructionUntil, f.arrestAttemptAfter, f.chargingReviewedAt, f.reviewDueAt, f.chargedAt, f.raidDueAt])
      if (n != null && !time(n)) throw Error('Save has an invalid police deadline.');
    if (f.warrantAt != null && (f.suspectId == null ||
        f.warrantExpiresAt != null && f.warrantExpiresAt < f.warrantAt))
      throw Error('Save has an invalid case warrant.');
    for (const s of f.statements) {
      if (!w.people[s.witnessId] || !person(s.suspectId) || !time(s.observedAt) ||
          !score(s.confidence) || !score(s.reliability) ||
          s.reportedAt != null && (!time(s.reportedAt) || s.reportedAt < s.observedAt) ||
          s.interviewedAt != null && (!time(s.interviewedAt) || s.interviewedAt < s.observedAt))
        throw Error('Save has an invalid witness statement.');
    }
    for (const e of f.evidence) if (!person(e.personId) || !person(e.witnessId) ||
        !building(e.buildingId) || !time(e.collectedAt) || !score(e.strength))
      throw Error('Save has invalid case evidence.');
  }
  for (const p of Object.values(w.people)) {
    const t = p.policeTask;
    if (t && (!['police', 'fbi'].includes(p.role) || !crimes.get(t.crimeId)?.police ||
        !person(t.suspectId) || !person(t.witnessId) || !time(t.until) ||
        !time(t.workLeft) || t.observedAt != null && !time(t.observedAt) ||
        t.searchPoint != null && (!Number.isInteger(t.searchPoint) || t.searchPoint < 0 || t.searchPoint > 16)))
      throw Error('Save has an invalid police task.');
    const h = p.custody;
    if (h && (!crimes.has(h.crimeId) || !w.people[h.officerId] ||
        !['arrested', 'onTrial'].includes(p.status) || !time(h.arrestedAt) ||
        h.arrestedAt > now || h.reviewAt < h.arrestedAt || h.releaseAt < h.reviewAt))
      throw Error('Save has invalid police custody.');
  }
  for (const c of Object.values(w.cases)) {
    if (c.openedAt != null && !time(c.openedAt) || c.trialAt != null && !time(c.trialAt) ||
        c.reviewAt != null && !time(c.reviewAt)) throw Error('Save has an invalid court deadline.');
  }
}
