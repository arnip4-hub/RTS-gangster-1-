import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { streetPersonVisible } from '../src/render/characterPresentation';
import { campaignMinute, FULL_DAY_MINUTES } from '../src/sim/calendar';
import { activeCaseStatements, addCaseEvidence, caseEvidenceStrength, caseHasWarrant, ensurePoliceFile,
  refreshCaseIdentity, refreshPoliceWanted } from '../src/sim/caseEvidence';
import { normalizeRtsPolice, recordPoliceObservation, tickPoliceCases, tryCaseArrest } from '../src/sim/policeCases';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { buildingDoor } from '../src/sim/world';
import type { CourtCase, CrimeRecord } from '../src/sim/types';

function scene() {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, citySize: 10, seed: 404 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.phase = 'week'; w.minute = 600; w.crimes = []; w.cases = {};
  const officer = w.people[w.policeIds[0]], suspect = w.people[team.memberIds[0]], mate = w.people[team.lieutenantId];
  const witness = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
  for (const p of Object.values(w.people)) { p.pos = { x: 500, y: 3 }; p.buildingId = null; p.inVehicle = false; p.orderId = null; p.streetOrder = null; p.dest = null; p.path = []; delete p.emergencyResponse; delete p.policeTask; }
  officer.pos = { x: 139, y: 3 }; suspect.pos = { x: 140, y: 3 }; witness.pos = { x: 142, y: 3 };
  const crime: CrimeRecord = { id: w.sequences.crime++, week: w.week, gangId: gang.id, perpetratorId: suspect.id,
    kind: 'kill', buildingId: null, victimId: null, witnesses: [], arrestRisk: 1, reported: true,
    reportedAt: campaignMinute(w) - 60 };
  w.crimes.push(crime);
  const file = ensurePoliceFile(w, crime, suspect.pos);
  file.openedAt -= 60; file.nextReviewAt = 0;
  const now = campaignMinute(w);
  const identify = () => {
    file.statements.push({ witnessId: witness.id, observation: 'face', confidence: 95, reliability: 95,
      observedAt: now - 60, reportedAt: now - 50, interviewedAt: now - 40, suspectId: suspect.id });
    addCaseEvidence(w, crime, { kind: 'scene', strength: 18, collectedAt: now - 40, note: 'Physical scene clues' });
    refreshCaseIdentity(w, crime);
  };
  return { sim, w, gang, team, officer, suspect, mate, witness, crime, file, now, identify };
}

describe('RTS case knowledge and evidence', () => {
  it('does not infer a suspect or wanted status from ground truth or a generic scene association', () => {
    const s = scene();
    addCaseEvidence(s.w, s.crime, { kind: 'scene', strength: 75, collectedAt: s.now, personId: s.suspect.id, note: 'Proximity is not identification' });
    refreshCaseIdentity(s.w, s.crime); refreshPoliceWanted(s.w);
    expect(s.file.suspectId).toBeUndefined(); expect(s.file.identityConfidence).toBe(0);
    expect(s.suspect.wanted).toBe(0);
    s.crime.reported = false; s.file.warrantAt = s.now; s.file.suspectId = s.suspect.id;
    refreshPoliceWanted(s.w); expect(s.suspect.wanted).toBe(0);
  });

  it('waits for a report and excludes withdrawn statements from current evidence and identification', () => {
    const s = scene(); s.identify();
    const statement = s.file.statements[0]; statement.reportedAt = s.now + 5;
    refreshCaseIdentity(s.w, s.crime);
    expect(s.file.suspectId).toBeUndefined(); expect(activeCaseStatements(s.w, s.crime)).toHaveLength(0);
    statement.reportedAt = s.now; refreshCaseIdentity(s.w, s.crime);
    expect(s.file.suspectId).toBe(s.suspect.id);
    const before = caseEvidenceStrength(s.w, s.crime); statement.withdrawn = true;
    refreshCaseIdentity(s.w, s.crime);
    expect(s.file.suspectId).toBeUndefined(); expect(caseEvidenceStrength(s.w, s.crime)).toBeLessThan(before);
  });

  it('does not use another named person’s evidence against the accused', () => {
    const s = scene(); s.file.suspectId = s.suspect.id;
    addCaseEvidence(s.w, s.crime, { kind: 'direct', strength: 70, collectedAt: s.now, personId: s.mate.id, note: 'Evidence about someone else' });
    expect(caseEvidenceStrength(s.w, s.crime)).toBe(0);
    expect(caseEvidenceStrength(s.w, s.crime, { defendantId: s.mate.id } as CourtCase)).toBe(70);
  });

  it('retains seized financial records after their source is imprisoned, while live testimony drops', () => {
    const s = scene();
    addCaseEvidence(s.w, s.crime, { kind: 'financial', strength: 60, witnessId: s.witness.id, personId: s.suspect.id,
      collectedAt: s.now, note: 'Disclosed accounting books' });
    s.witness.status = 'jailed'; refreshCaseIdentity(s.w, s.crime);
    expect(s.file.suspectId).toBe(s.suspect.id); expect(caseEvidenceStrength(s.w, s.crime)).toBe(60);
  });

  it('reopens a cold case on genuinely new evidence without duplicating an observation', () => {
    const s = scene(); s.file.stage = 'cold'; s.file.lastLeadAt = 0;
    const lead = { kind: 'scene' as const, strength: 18, collectedAt: s.now, note: 'New recovered object' };
    addCaseEvidence(s.w, s.crime, lead); addCaseEvidence(s.w, s.crime, lead);
    expect(s.file.stage).toBe('investigating'); expect(s.file.evidence).toHaveLength(1);
    expect(s.file.lastLeadAt).toBe(s.now);
  });

  it('does not expose a living kidnapping victim’s actual safe-house position during legacy migration', () => {
    const s = scene(); s.crime.victimId = s.witness.id; s.crime.kind = 'kidnap'; delete s.crime.police;
    s.witness.status = 'kidnapped'; s.witness.pos = { x: 411, y: 327 };
    const migrated = ensurePoliceFile(s.w, s.crime);
    expect(migrated.pos).toEqual({ x: 0, y: 0 });
  });
});

describe('physical RTS investigations and arrest', () => {
  it('requires a report-age threshold, identification and evidence before issuing a warrant', () => {
    const s = scene(); s.identify(); s.crime.reportedAt = s.now;
    tickPoliceCases(s.w, new Rng(1)); expect(s.file.warrantAt).toBeUndefined(); expect(s.suspect.status).toBe('active');
    s.w.minute += 30; tickPoliceCases(s.w, new Rng(1));
    expect(caseHasWarrant(s.w, s.crime, s.suspect.id)).toBe(true); expect(s.suspect.wanted).toBeGreaterThan(0);
    expect(s.suspect.status).toBe('active');
  });

  it('never arrests a remote suspect or a distant teammate, and preserves exact source custody', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now; s.file.warrantExpiresAt = s.now + FULL_DAY_MINUTES;
    s.officer.pos = { x: 400, y: 3 };
    const rng = new Rng(1); rng.chance = () => false;
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(false);
    s.officer.pos = { x: 139, y: 3 };
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(true);
    expect(s.suspect.status).toBe('arrested'); expect(s.mate.status).toBe('active');
    expect(s.suspect.custody).toMatchObject({ crimeId: s.crime.id, officerId: s.officer.id, arrestedAt: s.now,
      reviewAt: s.now + 360, releaseAt: s.now + FULL_DAY_MINUTES });
    expect(s.w.crimes).toHaveLength(1);
  });

  it('secures a detainee on scene, transports them with the arresting officer and books them at the station after reload', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now;
    s.file.warrantExpiresAt = s.now + FULL_DAY_MINUTES;
    const rng = new Rng(1); rng.chance = () => false;
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(true);
    expect(s.officer.policeTask).toMatchObject({ kind: 'arrest', phase: 'securing', suspectId: s.suspect.id });
    expect(s.suspect.custody?.transport).toBe('scene');
    expect(streetPersonVisible(s.suspect, null)).toBe(true);
    s.w.minute++; tickPoliceCases(s.w, rng);
    expect(s.officer.policeTask?.phase).toBe('securing');
    s.w.minute++; tickPoliceCases(s.w, rng);
    expect(s.officer.policeTask?.phase).toBe('delivering');
    expect(s.suspect.custody?.transport).toBe(s.officer.inVehicle ? 'vehicle' : 'escorted');
    expect(s.suspect.status).toBe('arrested');
    const restored = Sim.fromSave(structuredClone(s.w)).world;
    const officer = restored.people[s.officer.id], detainee = restored.people[s.suspect.id];
    expect(officer.policeTask?.phase).toBe('delivering');
    const station = Object.values(restored.buildings).find(b => b.typeId === 'policeHQ' && b.state !== 'destroyed')!;
    expect(station).toBeDefined();
    const door = buildingDoor(restored, station);
    officer.pos = { ...door }; officer.dest = null; officer.path = [];
    restored.minute++; tickPoliceCases(restored, new Rng(2));
    expect(detainee.custody?.transport).toBe('station');
    expect(detainee.buildingId).toBe(station.id);
    expect(detainee.inVehicle).toBe(false);
    expect(streetPersonVisible(detainee, detainee.id)).toBe(false);
    expect(officer.policeTask).toBeUndefined();
    expect(officer.buildingId).toBe(station.id);
  });

  it('migrates older arrested saves to an actual station instead of preserving a stranded street marker', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now;
    const rng = new Rng(1); rng.chance = () => false;
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(true);
    delete s.suspect.custody!.transport;
    delete s.officer.policeTask;
    normalizeRtsPolice(s.w);
    const station = Object.values(s.w.buildings).find(b => b.typeId === 'policeHQ' && b.state !== 'destroyed')!;
    expect(s.suspect.custody?.transport).toBe('station');
    expect(s.suspect.buildingId).toBe(station.id);
    expect(streetPersonVisible(s.suspect, s.suspect.id)).toBe(false);
  });

  it('finishes custody even if the arresting officer loses their transport task', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now;
    const rng = new Rng(1); rng.chance = () => false;
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(true);
    delete s.officer.policeTask;
    s.w.minute++; tickPoliceCases(s.w, rng);
    expect(s.suspect.status).toBe('arrested');
    expect(s.suspect.custody?.transport).toBe('station');
    expect(streetPersonVisible(s.suspect, s.suspect.id)).toBe(false);
  });

  it('does not strand a detainee if no usable police station exists', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now;
    for (const building of Object.values(s.w.buildings)) if (building.typeId === 'policeHQ') building.state = 'destroyed';
    const rng = new Rng(1); rng.chance = () => false;
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(true);
    s.w.minute += 2; tickPoliceCases(s.w, rng, 2);
    expect(s.suspect.custody?.transport).toBe('station');
    expect(streetPersonVisible(s.suspect, null)).toBe(false);
    expect(s.officer.policeTask).toBeUndefined();
  });

  it('allows an officer’s own caught-in-the-act observation to support a nearby immediate arrest', () => {
    const s = scene();
    s.file.statements.push({ witnessId: s.officer.id, observation: 'direct', confidence: 95, reliability: 95,
      suspectId: s.suspect.id, observedAt: s.now, reportedAt: s.now, interviewedAt: s.now });
    const rng = new Rng(1); rng.chance = () => false;
    expect(tryCaseArrest(s.w, rng, s.officer, s.suspect, s.crime.id)).toBe(true);
    expect(s.file.warrantAt).toBeUndefined(); expect(s.suspect.custody?.crimeId).toBe(s.crime.id);
  });

  it('makes an officer approach a directly observed nearby offender before the desk review', () => {
    const s = scene(); s.officer.pos = { x: 132, y: 3 };
    s.file.statements.push({ witnessId: s.officer.id, observation: 'direct', confidence: 95, reliability: 95,
      suspectId: s.suspect.id, observedAt: s.now, reportedAt: s.now, interviewedAt: s.now });
    s.crime.reportedAt = s.now; s.file.nextReviewAt = s.now + 30;
    tickPoliceCases(s.w, new Rng(1));
    expect(s.suspect.status).toBe('active'); expect(s.file.warrantAt).toBeUndefined();
    expect(s.officer.policeTask).toMatchObject({ kind: 'arrest', crimeId: s.crime.id, suspectId: s.suspect.id });
    expect(s.officer.dest).not.toBeNull();
  });

  it('does not erase a legal wanted notice during a retry cooldown', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now; s.file.arrestAttemptAfter = s.now + 20;
    refreshPoliceWanted(s.w); expect(caseHasWarrant(s.w, s.crime)).toBe(true); expect(s.suspect.wanted).toBeGreaterThan(0);
    expect(tryCaseArrest(s.w, new Rng(1), s.officer, s.suspect, s.crime.id)).toBe(false);
  });

  it('records scene work and local interviews only after the officer reaches the scene', () => {
    const s = scene(); s.identify(); s.file.evidence = []; delete s.file.statements[0].interviewedAt;
    s.officer.pos = { x: 400, y: 3 }; recordPoliceObservation(s.w, s.crime.id, s.officer.id);
    expect(s.file.evidence).toHaveLength(0);
    s.officer.pos = { x: 139, y: 3 }; recordPoliceObservation(s.w, s.crime.id, s.officer.id);
    expect(s.file.statements[0].interviewedAt).toBe(s.now);
    expect(s.file.evidence.some(e => e.kind === 'scene')).toBe(true);
  });

  it('searches bounded local waypoints without tracking a hidden suspect across the city', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now; s.file.nextReviewAt = s.now + 1000;
    s.suspect.pos = { x: 500, y: 3 };
    s.officer.pos = { ...s.file.pos };
    s.officer.policeTask = { crimeId: s.crime.id, kind: 'arrest', phase: 'searching', target: { ...s.file.pos },
      workLeft: 0, until: s.now + 360, suspectId: s.suspect.id };
    tickPoliceCases(s.w, new Rng(1));
    expect(s.officer.policeTask?.searchPoint).toBe(1);
    expect(s.officer.dest).not.toEqual(s.suspect.pos);
    expect(s.file.lastSeenAt).toBeUndefined(); expect(s.suspect.status).toBe('active');
  });

  it('records a new last-known position when a search officer actually sees the suspect locally', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now; s.file.nextReviewAt = s.now + 1000;
    s.suspect.pos = { x: 149, y: 3 }; s.officer.pos = { x: 139, y: 3 };
    s.officer.policeTask = { crimeId: s.crime.id, kind: 'arrest', phase: 'searching', target: { ...s.file.pos },
      workLeft: 15, until: s.now + 360, suspectId: s.suspect.id };
    tickPoliceCases(s.w, new Rng(1));
    expect(s.file.lastKnownPos).toEqual({ x: 149, y: 3 }); expect(s.file.lastSeenAt).toBe(s.now);
    expect(s.officer.policeTask?.target).toEqual({ x: 149, y: 3 });
  });

  it('limits a corrupt investigator to one saved delay and assigns an independent officer afterwards', () => {
    const s = scene(); s.identify();
    s.crime.investigatorId = s.officer.id; s.officer.bribedBy = s.gang.id;
    tickPoliceCases(s.w, new Rng(1));
    expect(s.file.warrantAt).toBeUndefined(); expect(s.file.obstructionUntil).toBe(s.now + 180);
    const restored = Sim.fromSave(structuredClone(s.w)), w = restored.world;
    const crime = w.crimes.find(c => c.id === s.crime.id)!;
    w.minute += 180; tickPoliceCases(w, new Rng(1));
    expect(caseHasWarrant(w, crime)).toBe(true);
    expect(crime.police!.obstructionUntil).toBe(s.now + 180);
    expect(crime.investigatorId).not.toBe(s.officer.id);
  });

  it('withdraws a warrant when its sole identification disappears and remains loadable', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now;
    s.file.statements[0].withdrawn = true; refreshCaseIdentity(s.w, s.crime);
    expect(caseHasWarrant(s.w, s.crime)).toBe(false); expect(s.file.warrantAt).toBeUndefined();
    expect(() => Sim.fromSave(structuredClone(s.w))).not.toThrow();
  });

  it('lets an expired warrant become cold without automatically renewing the same evidence', () => {
    const s = scene(); s.identify(); s.file.stage = 'wanted'; s.file.warrantAt = s.now;
    s.file.warrantExpiresAt = s.now + 14 * FULL_DAY_MINUTES;
    s.w.week += 2;
    tickPoliceCases(s.w, new Rng(1));
    expect(s.file.stage).toBe('cold'); expect(s.file.warrantAt).toBeUndefined();
    expect(s.suspect.wanted).toBe(0);
    s.w.minute += 60; tickPoliceCases(s.w, new Rng(1));
    expect(caseHasWarrant(s.w, s.crime)).toBe(false);
  });

  it('leaves an established legacy court file intact and releases unsupported old desk arrests', () => {
    const s = scene(); delete s.crime.police; s.suspect.status = 'onTrial';
    s.w.cases[1] = { id: 1, sourceCrimeId: s.crime.id, defendantId: s.suspect.id, status: 'onTrial', strength: 72 } as CourtCase;
    s.mate.status = 'arrested'; normalizeRtsPolice(s.w);
    expect(s.crime.police).toBeUndefined(); expect(s.w.cases[1].strength).toBe(72);
    expect(s.suspect.status).toBe('onTrial'); expect(s.mate.status).toBe('active');
  });
});
