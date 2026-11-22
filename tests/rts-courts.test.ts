import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { caseEvidenceStrength, ensurePoliceFile, addCaseEvidence } from '../src/sim/caseEvidence';
import { completeOfficialBribe } from '../src/sim/officials';
import { FULL_DAY_MINUTES, FULL_WEEK_MINUTES, campaignMinute } from '../src/sim/calendar';
import { normalizeRtsCourts, recordTaxDisclosures, tickRtsCourts } from '../src/sim/rtsCourts';
import { Sim } from '../src/sim/sim';
import { weeklyLaw } from '../src/sim/systems/law';
import type { CrimeRecord } from '../src/sim/types';

afterEach(() => vi.restoreAllMocks());

/** Court fixtures start at an actual recorded detention; police travel and
 * identification are tested separately by the core investigation suites. */
function fixture(strength = 70) {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10, startMoney: 1_000_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.phase = 'week'; w.minute = 0;
  const defendant = w.people[team.memberIds[0]], officer = w.people[w.policeIds[0]];
  for (const p of Object.values(w.people)) if (['judge', 'da', 'owner'].includes(p.role)) p.opinion[gang.id] = -50;
  const crime: CrimeRecord = { id: w.sequences.crime++, week: w.week, gangId: gang.id,
    perpetratorId: defendant.id, kind: 'raid', buildingId: null, victimId: null,
    witnesses: [], arrestRisk: .4, reported: true, reportedAt: 0, investigatorId: officer.id };
  w.crimes.push(crime);
  const file = ensurePoliceFile(w, crime, defendant.pos);
  addCaseEvidence(w, crime, { kind: 'direct', strength, collectedAt: 0, personId: defendant.id, note: 'Recorded identification at the incident.' });
  file.suspectId = defendant.id; file.identityConfidence = 90; file.stage = 'arrested';
  defendant.status = 'arrested';
  defendant.custody = { crimeId: crime.id, officerId: officer.id, arrestedAt: 0, reviewAt: 360, releaseAt: 1440 };
  const review = (minute = 360) => { w.minute = minute; tickRtsCourts(w, sim.rng); };
  const court = () => Object.values(w.cases).find(c => c.defendantId === defendant.id)!;
  return { sim, w, gang, defendant, officer, crime, file, review, court };
}

describe('RTS custody and prosecutor review', () => {
  it('charges only the arrest source rather than a worse unreported crime', () => {
    const s = fixture();
    s.w.crimes.push({ ...s.crime, id: s.w.sequences.crime++, kind: 'kill', reported: false, arrestRisk: .99, police: undefined });
    s.review(359); expect(s.court()).toBeUndefined();
    s.review();
    expect(s.court().sourceCrimeId).toBe(s.crime.id);
    expect(s.court().crime).toBe('armed robbery');
    expect(s.file.prosecutorDecision).toBe('charge');
    expect(s.defendant.status).toBe('onTrial');
    expect(s.court().trialAt).toBeGreaterThan(campaignMinute(s.w));
  });

  it('declines an unidentified suspect even with strong incident evidence', () => {
    const s = fixture(); s.file.identityConfidence = 40;
    s.file.evidence = [{ kind: 'scene', strength: 70, collectedAt: 0, note: 'An incident without an identified culprit.' }];
    s.review();
    expect(s.file.prosecutorDecision).toBe('decline');
    expect(s.defendant.status).toBe('active');
    expect(s.defendant.custody).toBeUndefined();
    expect(s.court()).toBeUndefined();
  });

  it('requests further investigation then releases the suspect at the charging deadline', () => {
    const s = fixture(40);
    s.review();
    expect(s.file.prosecutorDecision).toBe('investigate');
    expect(s.defendant.status).toBe('arrested');
    s.review(1440);
    expect(s.defendant.status).toBe('active');
    expect(s.court()).toBeUndefined();
    expect(s.file.warrantAt).toBeUndefined();
    expect(s.file.arrestAttemptAfter).toBe(2880);
  });

  it('processes an independent arrest without another report, and never invents racketeering', () => {
    const s = fixture(); s.w.crimes = [];
    s.review();
    expect(s.defendant.status).toBe('active');
    expect(s.court()).toBeUndefined();
    s.defendant.status = 'arrested'; delete s.defendant.custody;
    s.review(400);
    expect(s.defendant.status).toBe('active');
    expect(Object.keys(s.w.cases)).toHaveLength(0);
  });

  it('weekly settlement does not waive the custody review deadline', () => {
    const s = fixture(); s.w.minute = 0;
    weeklyLaw(s.w, s.sim.rng);
    expect(s.defendant.status).toBe('arrested');
    expect(s.court()).toBeUndefined();
  });
});

describe('RTS hearings and interference', () => {
  it('finishes on a game-time deadline and ignores unrelated gang evidence', () => {
    const outcome = (evidence: number) => {
      const s = fixture(); s.review();
      s.gang.evidence = evidence;
      vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
      s.review(s.court().trialAt!);
      return s.court().status;
    };
    expect(outcome(100)).toBe(outcome(0));
    expect(['convicted', 'acquitted']).toContain(outcome(0));
  });

  it('recalculates a bought witness contribution instead of retaining it in initial strength', () => {
    const s = fixture(0), witness = Object.values(s.w.people).find(p => p.role === 'citizen')!;
    s.file.evidence = [{ kind: 'scene', strength: 15, collectedAt: 0, note: 'Evidence of an incident.' }];
    s.file.statements = [{ witnessId: witness.id, observation: 'face', confidence: 100, reliability: 100,
      observedAt: 0, reportedAt: 0, interviewedAt: 1, suspectId: s.defendant.id }];
    s.review(); expect(s.court()).toBeDefined();
    expect(s.court().strength).toBe(70);
    s.court().bribedWitnessIds = [witness.id];
    expect(caseEvidenceStrength(s.w, s.crime, s.court())).toBe(15);
    s.review(s.court().trialAt!);
    expect(s.court().status).toBe('dismissed');
    expect(s.defendant.status).toBe('active');
  });

  it('replaces a murdered juror and delays the hearing without retaining the discovered jury list', () => {
    const s = fixture(); s.review();
    const court = s.court(), old = court.jurorIds[0];
    court.knowsJurors = true; s.w.people[old].status = 'dead';
    const due = court.trialAt!;
    s.review(due);
    expect(court.jurorIds).not.toContain(old);
    expect(court.jurorIds).toHaveLength(6);
    expect(court.knowsJurors).toBe(false);
    expect(court.trialAt).toBe(due + 12 * 60);
    expect(court.status).toBe('onTrial');
  });

  it('a judge bribe influences the RTS hearing without automatically dismissing the case', () => {
    const s = fixture(); s.review();
    const court = s.court(); s.file.warrantAt = 0;
    expect(completeOfficialBribe(s.w, s.gang.id, s.w.people[court.judgeId], 100).ok).toBe(true);
    expect(court.judgeBribed).toBe(true);
    expect(court.status).toBe('awaiting');
    expect(s.file.stage).toBe('charged');
    expect(s.defendant.status).toBe('onTrial');
    expect(s.defendant.custody).toBeDefined();
  });

  it('keeps established legacy hearings on an explicit future date', () => {
    const s = fixture(); s.review(); const court = s.court();
    delete court.openedAt; delete court.trialAt; delete court.reviewAt;
    court.weeksToTrial = 2;
    normalizeRtsCourts(s.w);
    expect(court.trialAt).toBe(campaignMinute(s.w) + 2 * FULL_DAY_MINUTES);
    expect(court.sourceCrimeId).toBe(s.crime.id);
  });

  it('does not count a partial prison week as a full week served', () => {
    const s = fixture(); s.review();
    vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
    s.review(s.court().trialAt!);
    expect(s.defendant.status).toBe('jailed');
    s.defendant.jailWeeks = 3;
    s.w.minute = FULL_WEEK_MINUTES;
    weeklyLaw(s.w, s.sim.rng);
    expect(s.defendant.jailWeeks).toBe(3);
    s.w.week++; weeklyLaw(s.w, s.sim.rng);
    expect(s.defendant.jailWeeks).toBe(2);
  });

  it('written tax records survive the accountant being in custody', () => {
    const s = fixture(); const accountant = Object.values(s.w.people).find(p => p.role === 'accountant')!;
    accountant.status = 'arrested';
    s.crime.kind = 'taxEvasion'; s.crime.witnesses = [accountant.id]; delete s.crime.police;
    recordTaxDisclosures(s.w, [s.crime]);
    expect(caseEvidenceStrength(s.w, s.crime)).toBeGreaterThan(45);
  });

  it('does not subtract a sentence week at the first partial RTS Sunday boundary', () => {
    const s = fixture(); s.review();
    vi.spyOn(s.sim.rng, 'range').mockReturnValue(1);
    s.review(s.court().trialAt!);
    expect(s.defendant.status).toBe('jailed');
    s.defendant.jailWeeks = 3;
    s.w.minute = 7 * FULL_DAY_MINUTES;
    weeklyLaw(s.w, s.sim.rng);
    expect(s.defendant.jailWeeks).toBe(3);
    s.w.week++; weeklyLaw(s.w, s.sim.rng);
    expect(s.defendant.jailWeeks).toBe(2);
  });
});
