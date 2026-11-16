import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { campaignMinute } from '../src/sim/calendar';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { tickLaw, weeklyLaw } from '../src/sim/systems/law';
import { ensurePoliceFile } from '../src/sim/caseEvidence';
import { recordPoliceObservation } from '../src/sim/policeCases';
import { buildingDoor } from '../src/sim/world';
import type { CrimeRecord } from '../src/sim/types';

afterEach(() => vi.restoreAllMocks());

describe('live police investigations', () => {
  it('requires actual identification and a nearby arrest before an independent prosecutor review', () => {
    const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10 });
    sim.launchWeek();
    const w = sim.world, perp = w.people[w.teams[sim.playerGang.teamIds[0]].memberIds[0]];
    const crime: CrimeRecord = { id: w.sequences.crime++, week: w.week, gangId: sim.playerGang.id,
      perpetratorId: perp.id, kind: 'raid', buildingId: null, victimId: null,
      witnesses: [], arrestRisk: 1, reported: true, reportedAt: campaignMinute(w) + 40 };
    w.crimes.push(crime);
    const point = buildingDoor(w, Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === sim.playerGang.id)!);
    const file = ensurePoliceFile(w, crime, point);
    perp.buildingId = null; perp.inVehicle = false; perp.pos = { ...point };
    w.minute = 540;
    tickLaw(w, new Rng(1));
    expect(perp.status).toBe('active');
    expect(Object.values(w.cases)).toHaveLength(0);

    w.minute = 600;
    const officer = w.people[w.policeIds[0]];
    officer.emergencyResponse = { week: w.week, buildingId: null, crimeId: crime.id,
      startMinute: 520, untilMinute: 700, kind: 'police', stage: 'approaching',
      target: perp.pos, lookAt: perp.pos, home: officer.pos };
    tickLaw(w, new Rng(1));
    expect(perp.status).toBe('active');
    expect(file.suspectId).toBeUndefined();
    officer.emergencyResponse.stage = 'working';
    officer.buildingId = null; officer.inVehicle = false; officer.pos = { ...point };
    file.statements.push({ witnessId: officer.id, observation: 'direct', confidence: 100,
      reliability: 100, suspectId: perp.id, observedAt: 600, reportedAt: 600 });
    vi.spyOn(sim.rng, 'chance').mockReturnValue(false); // no resistance at the actual stop
    w.minute = 601; tickLaw(w, sim.rng);
    expect(perp.status).toBe('arrested');
    expect(perp.custody?.crimeId).toBe(crime.id);
    expect(Object.values(w.cases)).toHaveLength(0);
    recordPoliceObservation(w, crime.id, officer.id);
    w.minute = perp.custody!.reviewAt; tickLaw(w, sim.rng);
    expect(perp.status).toBe('onTrial');
    expect(Object.values(w.cases).some(c => c.defendantId === perp.id && c.sourceCrimeId === crime.id)).toBe(true);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();

    const caseCount = Object.keys(w.cases).length;
    weeklyLaw(w, new Rng(1));
    expect(Object.keys(w.cases).length).toBe(caseCount);
    expect(crime.investigatedAt).toBe(601);
  });

  it('leaves the classic weekly investigation cadence alone', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    sim.launchWeek();
    const w = sim.world;
    w.crimes.push({ id: w.sequences.crime++, week: w.week, gangId: sim.playerGang.id,
      perpetratorId: sim.playerGang.bossId, kind: 'raid', buildingId: null, victimId: null,
      witnesses: [], arrestRisk: 1, reported: true });
    w.minute = 60;
    tickLaw(w, new Rng(1));
    expect(w.people[sim.playerGang.bossId].status).toBe('active');
    expect(w.crimes.at(-1)?.investigatedAt).toBeUndefined();
  });
});
