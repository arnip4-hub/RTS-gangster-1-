import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { hireRecruit } from '../src/sim/api';
import { tickBodyRecovery } from '../src/sim/bodyRecovery';
import { campaignMinute, FULL_DAY_MINUTES, FULL_WEEK_MINUTES } from '../src/sim/calendar';
import { addCaseEvidence, caseEvidenceStrength, ensurePoliceFile, refreshCaseIdentity, refreshPoliceWanted } from '../src/sim/caseEvidence';
import { recordCrime, tickWitnessReports } from '../src/sim/events';
import { killPerson } from '../src/sim/execution';
import { tickPoliceCases, tryCaseArrest } from '../src/sim/policeCases';
import { Rng } from '../src/sim/rng';
import { tickRtsCourts } from '../src/sim/rtsCourts';
import { Sim } from '../src/sim/sim';
import { weeklyFbi } from '../src/sim/systems/fbi';
import { tickLaw, weeklyLaw } from '../src/sim/systems/law';
import type { CrimeRecord } from '../src/sim/types';
import { buildingDoor } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());

function fixture(continuousTime = true) {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, continuousTime, startMoney: 500_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  const suspect = w.people[team.memberIds[0]], mate = w.people[team.lieutenantId];
  const officer = w.people[w.policeIds[0]];
  const hq = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === gang.id)!;
  const pos = buildingDoor(w, hq);
  w.phase = 'week'; w.minute = 600; w.crimes = []; w.cases = {};
  for (const p of [suspect, mate, officer]) {
    p.status = 'active'; p.buildingId = null; p.inVehicle = false;
    p.orderId = null; p.streetOrder = null; p.dest = null; p.path = [];
    delete p.policeTask; delete p.emergencyResponse;
  }
  suspect.pos = { ...pos }; suspect.skills.intelligence = 5;
  mate.pos = { x: pos.x + 150, y: pos.y + 150 };
  officer.pos = { x: pos.x + 100, y: pos.y };
  officer.employedBy = null; officer.bribedBy = null;
  return { sim, w, gang, team, suspect, mate, officer, pos };
}
type Fixture = ReturnType<typeof fixture>;

function record(s: Fixture, kind = 'raid', reported = true): CrimeRecord {
  const now = campaignMinute(s.w);
  const crime: CrimeRecord = { id: s.w.sequences.crime++, week: s.w.week, gangId: s.gang.id,
    perpetratorId: s.suspect.id, kind, buildingId: null, victimId: null,
    witnesses: [], arrestRisk: .95, reported,
    ...(reported ? { reportedAt: now - 60 } : {}) };
  s.w.crimes.push(crime);
  return crime;
}

function identifiedFile(s: Fixture, strength = 60): CrimeRecord {
  const crime = record(s);
  const file = ensurePoliceFile(s.w, crime, s.pos);
  addCaseEvidence(s.w, crime, { kind: 'direct', personId: s.suspect.id,
    strength, collectedAt: campaignMinute(s.w), note: 'Officer positively identified the participant in this incident.' });
  refreshCaseIdentity(s.w, crime);
  file.stage = 'wanted'; file.warrantAt = campaignMinute(s.w);
  file.warrantExpiresAt = campaignMinute(s.w) + FULL_DAY_MINUTES;
  file.lastKnownPos = { ...s.suspect.pos }; file.lastSeenAt = campaignMinute(s.w);
  return crime;
}

function arrest(s: Fixture, crime: CrimeRecord): void {
  s.officer.pos = { x: s.suspect.pos.x + 1, y: s.suspect.pos.y };
  expect(tryCaseArrest(s.w, s.sim.rng, s.officer, s.suspect, crime.id)).toBe(true);
  expect(s.suspect.status).toBe('arrested');
}

describe('continuous RTS law pipeline integration', () => {
  it('does not turn an unseen event into police knowledge, wanted status or an FBI warrant', () => {
    const s = fixture();
    // Nobody is in a position to observe or report this event.
    for (const p of Object.values(s.w.people)) if (p.id !== s.suspect.id) p.pos = { x: -9999, y: -9999 };
    s.suspect.wanted = 0; s.mate.wanted = 0; s.gang.evidence = 0;
    const crime = recordCrime(s.w, s.sim.rng, { gangId: s.gang.id, perpetratorId: s.suspect.id,
      type: 'streetKill', severity: 10, pos: s.suspect.pos });
    expect(crime.reported).toBe(false);
    tickWitnessReports(s.w);
    tickLaw(s.w, s.sim.rng);
    weeklyFbi(s.w, s.sim.rng);
    refreshPoliceWanted(s.w);
    expect(crime.police?.suspectId).toBeUndefined();
    expect(s.suspect.wanted).toBe(0); expect(s.mate.wanted).toBe(0);
    expect(s.suspect.fbiWarrant).not.toBe(true); expect(s.mate.fbiWarrant).not.toBe(true);
    expect(s.gang.evidence).toBe(0);
    expect(s.suspect.status).toBe('active');
    expect(Object.values(s.w.cases)).toHaveLength(0);
  });

  it('preserves a delayed witness report through saving and Sunday without an early desk arrest', () => {
    const s = fixture(); s.w.minute = FULL_WEEK_MINUTES - 5;
    const crime = record(s, 'kill', false), file = ensurePoliceFile(s.w, crime, s.pos);
    const now = campaignMinute(s.w);
    const witness = Object.values(s.w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    file.statements.push({ witnessId: witness.id, observation: 'face', suspectId: s.suspect.id,
      confidence: 90, reliability: 90, observedAt: now, reportedAt: now + 15 });
    weeklyLaw(s.w, s.sim.rng);
    expect(crime.reported).toBe(false); expect(s.suspect.status).toBe('active');
    const saved = Sim.fromSave(structuredClone(s.w));
    const restored = saved.world.crimes.find(c => c.id === crime.id)!;
    expect(restored.police?.statements[0].reportedAt).toBe(now + 15);
    saved.world.week++; saved.world.minute = 10;
    tickWitnessReports(saved.world);
    expect(restored.reported).toBe(true);
    expect(saved.world.people[s.suspect.id].status).toBe('active');
    expect(restored.police?.statements[0].observedAt).toBe(now);
    expect(Object.values(saved.world.cases)).toHaveLength(0);
  });

  it('requires the officer to reach the named suspect, detains no distant teammate and restores the exact custody source', () => {
    const s = fixture(), crime = identifiedFile(s);
    expect(tryCaseArrest(s.w, s.sim.rng, s.officer, s.suspect, crime.id)).toBe(false);
    expect(s.suspect.status).toBe('active');
    arrest(s, crime);
    expect(s.mate.status).toBe('active');
    expect(s.suspect.custody?.crimeId).toBe(crime.id);
    expect(s.suspect.custody?.officerId).toBe(s.officer.id);
    const saved = Sim.fromSave(structuredClone(s.w));
    expect(saved.world.people[s.suspect.id].custody).toEqual(s.suspect.custody);
    expect(saved.world.people[s.mate.id].status).toBe('active');
  });

  it('restores an investigation journey and its file without resetting the saved task', () => {
    const s = fixture(), crime = identifiedFile(s);
    const witness = Object.values(s.w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    crime.investigatorId = s.officer.id;
    s.officer.policeTask = { crimeId: crime.id, kind: 'interview', phase: 'travelling',
      target: { ...witness.pos }, until: campaignMinute(s.w) + 6 * 60,
      workLeft: 20, witnessId: witness.id };
    const saved = Sim.fromSave(structuredClone(s.w));
    expect(saved.world.people[s.officer.id].policeTask).toEqual(s.officer.policeTask);
    expect(saved.world.crimes.find(c => c.id === crime.id)?.police).toEqual(crime.police);
    expect(saved.world.people[s.suspect.id].status).toBe('active');
  });

  it('charges the actual detention file instead of a worse hidden offense, independently of fresh reports', () => {
    const s = fixture(), source = identifiedFile(s), hidden = record(s, 'kill', false);
    hidden.arrestRisk = 1; source.arrestRisk = .1;
    arrest(s, source);
    s.w.minute = s.suspect.custody!.reviewAt;
    tickRtsCourts(s.w, s.sim.rng);
    const court = Object.values(s.w.cases).find(c => c.defendantId === s.suspect.id)!;
    expect(court).toBeDefined();
    expect(court.sourceCrimeId).toBe(source.id);
    expect(court.crime).not.toBe('murder');
    expect(source.police?.prosecutorDecision).toBe('charge');
    expect(s.suspect.status).toBe('onTrial');
    expect(court.trialAt).toBeGreaterThan(campaignMinute(s.w));
    expect(hidden.police?.suspectId).toBeUndefined();
  });

  it('continues actual scene work when the prosecutor asks for more evidence during custody', () => {
    const s = fixture(), crime = identifiedFile(s, 45);
    // Arrest elsewhere: the arrest itself must not examine a remote scene.
    crime.police!.pos = { x: 3, y: 3 };
    s.suspect.pos = { x: 100, y: 3 };
    arrest(s, crime); s.w.minute = s.suspect.custody!.reviewAt;
    tickRtsCourts(s.w, s.sim.rng);
    expect(crime.police!.prosecutorDecision).toBe('investigate');
    expect(s.suspect.status).toBe('arrested');
    s.w.minute += 30; tickPoliceCases(s.w, s.sim.rng);
    // Escorting the detainee and following up the prosecutor's evidence
    // request are separate assignments: the arresting officer stays with him.
    expect(s.officer.policeTask?.kind).toBe('arrest');
    const worker = Object.values(s.w.people).find(p => p.policeTask?.crimeId === crime.id &&
      p.policeTask.kind === 'surveillance')!;
    expect(worker).toBeDefined();
    expect(worker.id).not.toBe(s.officer.id);
    worker.pos = { x: 3, y: 3 }; worker.buildingId = null; worker.dest = null; worker.path = [];
    worker.policeTask!.phase = 'working'; worker.policeTask!.workLeft = 0;
    tickPoliceCases(s.w, s.sim.rng);
    expect(crime.police!.evidence.some(e => e.kind === 'scene')).toBe(true);
    s.w.minute = s.suspect.custody!.reviewAt; tickRtsCourts(s.w, s.sim.rng);
    expect(crime.police!.prosecutorDecision).toBe('charge');
    expect(s.suspect.status).toBe('onTrial');
  });

  it('uses only the charged file at the hearing, so unrelated gang evidence cannot change the verdict', () => {
    const s = fixture(), source = identifiedFile(s, 60);
    const lawyer = Object.values(s.w.people).find(p => p.role === 'lawyer' && p.gangId == null)!;
    expect(hireRecruit(s.w, s.gang.id, lawyer.id, 'pool').ok).toBe(true);
    lawyer.skills.intelligence = 8;
    for (const id of s.w.daIds) s.w.people[id].skills.intelligence = 1;
    for (const p of Object.values(s.w.people)) p.opinion[s.gang.id] = 0;
    arrest(s, source); s.w.minute = s.suspect.custody!.reviewAt;
    tickRtsCourts(s.w, s.sim.rng);
    const court = Object.values(s.w.cases)[0];
    // Arrest at the scene also collects 18 points of scene evidence (capped at 75).
    expect(caseEvidenceStrength(s.w, source, court)).toBe(75);
    const outcomes = [0, 100].map(evidence => {
      const saved = Sim.fromSave(structuredClone(s.w)), w = saved.world;
      const current = w.cases[court.id];
      w.gangs[s.gang.id].evidence = evidence;
      w.minute = current.trialAt!;
      const rng = new Rng(5); vi.spyOn(rng, 'range').mockReturnValue(1);
      tickRtsCourts(w, rng);
      return { status: current.status, strength: current.strength };
    });
    expect(outcomes).toEqual([{ status: 'acquitted', strength: 75 }, { status: 'acquitted', strength: 75 }]);
  });

  it('preserves an established legacy court file instead of replacing its evidence with an empty investigation', () => {
    const s = fixture(), crime = record(s);
    s.suspect.status = 'onTrial';
    const id = s.w.sequences.court++;
    s.w.cases[id] = { id, defendantId: s.suspect.id, gangId: s.gang.id,
      crime: 'robbery', sourceCrimeId: crime.id, judgeId: s.w.judgeIds[0], daId: s.w.daIds[0],
      witnessIds: [], jurorIds: [], weeksToTrial: 2, status: 'onTrial',
      knowsWitnesses: false, knowsJurors: false, judgeBribed: false, strength: 63 };
    const saved = Sim.fromSave(structuredClone(s.w));
    const court = saved.world.cases[id];
    expect(court.strength).toBe(63);
    expect(court.trialAt).toBe(campaignMinute(saved.world) + 2 * FULL_DAY_MINUTES);
    tickRtsCourts(saved.world, saved.rng);
    expect(court.strength).toBe(63);
    expect(court.status).toBe('onTrial');
    expect(saved.world.people[s.suspect.id].status).toBe('onTrial');
  });

  it.each(['custody review', 'hearing'] as const)('does not carry stale identification through %s after the only identifying testimony is withdrawn', stage => {
    const s = fixture(), crime = record(s), file = ensurePoliceFile(s.w, crime, s.pos);
    const witness = Object.values(s.w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    const now = campaignMinute(s.w);
    file.statements.push({ witnessId: witness.id, observation: 'face', suspectId: s.suspect.id,
      confidence: 90, reliability: 100, observedAt: now - 60, reportedAt: now - 60, interviewedAt: now });
    addCaseEvidence(s.w, crime, { kind: 'scene', strength: 75, collectedAt: now,
      note: 'Extensive scene findings prove this incident, but do not identify a participant.' });
    refreshCaseIdentity(s.w, crime);
    file.stage = 'wanted'; file.warrantAt = now; file.warrantExpiresAt = now + FULL_DAY_MINUTES;
    arrest(s, crime);
    if (stage === 'hearing') {
      s.w.minute = s.suspect.custody!.reviewAt;
      tickRtsCourts(s.w, s.sim.rng);
      expect(s.suspect.status).toBe('onTrial');
    }
    file.statements[0].withdrawn = true;
    expect(caseEvidenceStrength(s.w, crime)).toBe(75);
    const court = Object.values(s.w.cases).find(c => c.sourceCrimeId === crime.id);
    s.w.minute = stage === 'hearing' ? court!.trialAt! : s.suspect.custody!.reviewAt;
    tickRtsCourts(s.w, s.sim.rng);
    expect(s.suspect.status).toBe('active');
    if (stage === 'hearing') expect(court!.status).toBe('dismissed');
    else expect(Object.values(s.w.cases)).toHaveLength(0);
    expect(file.stage).not.toBe('charged');
  });

  it('opens an unknown-offender file when police discover a body without an earlier report', () => {
    const s = fixture();
    const victim = Object.values(s.w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
    victim.buildingId = null; victim.inVehicle = false; victim.pos = { ...s.pos };
    s.officer.pos = { x: s.pos.x + 1, y: s.pos.y };
    killPerson(s.w, victim, 'body discovery integration fixture');
    tickBodyRecovery(s.w);
    const crime = s.w.crimes.find(c => c.victimId === victim.id)!;
    expect(crime).toBeDefined(); expect(crime.reported).toBe(true);
    expect(crime.police?.suspectId).toBeUndefined();
    expect(crime.police?.evidence.some(e => e.kind === 'scene')).toBe(true);
    expect(victim.bodyRecovery?.coveredAt).toBe(campaignMinute(s.w));
    expect(Object.values(s.w.people).some(p => p.wanted > 0)).toBe(false);
    expect(Object.values(s.w.cases)).toHaveLength(0);
  });

  it('retains classic unreported heat instead of silently changing the historical mode', () => {
    const s = fixture(false);
    for (const p of Object.values(s.w.people)) if (p.id !== s.suspect.id) p.pos = { x: -9999, y: -9999 };
    s.suspect.wanted = 0;
    const crime = recordCrime(s.w, s.sim.rng, { gangId: s.gang.id, perpetratorId: s.suspect.id,
      type: 'streetKill', severity: 10, pos: s.suspect.pos });
    expect(crime.reported).toBe(false);
    expect(s.suspect.wanted).toBe(4);
    expect(crime.police).toBeUndefined();
  });
});
