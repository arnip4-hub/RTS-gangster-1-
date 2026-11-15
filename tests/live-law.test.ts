import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { campaignMinute } from '../src/sim/calendar';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { tickLaw, weeklyLaw } from '../src/sim/systems/law';

describe('live police investigations', () => {
  it('reviews a report after a delay, opens the case before settlement, and saves its result', () => {
    const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10 });
    sim.launchWeek();
    const w = sim.world, perp = w.people[sim.playerGang.bossId];
    const crime = { id: w.sequences.crime++, week: w.week, gangId: sim.playerGang.id,
      perpetratorId: perp.id, kind: 'raid', buildingId: null, victimId: null,
      witnesses: [], arrestRisk: 1, reported: true, reportedAt: campaignMinute(w) + 40 };
    w.crimes.push(crime);
    w.minute = 540;
    tickLaw(w, new Rng(1));
    expect(w.crimes.at(-1)?.investigatedAt).toBeUndefined();

    w.minute = 600;
    const officer = w.people[w.policeIds[0]];
    officer.emergencyResponse = { week: w.week, buildingId: null, crimeId: crime.id,
      startMinute: 520, untilMinute: 700, kind: 'police', stage: 'approaching',
      target: perp.pos, lookAt: perp.pos, home: officer.pos };
    tickLaw(w, new Rng(1));
    expect(w.crimes.at(-1)?.investigatedAt).toBeUndefined();
    officer.emergencyResponse.stage = 'working';
    tickLaw(w, new Rng(1));
    expect(w.crimes.at(-1)?.investigatedAt).toBe(campaignMinute(w));
    expect(perp.status).toBe('onTrial');
    expect(Object.values(w.cases).some(c => c.defendantId === perp.id && c.status === 'awaiting')).toBe(true);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();

    const caseCount = Object.keys(w.cases).length;
    weeklyLaw(w, new Rng(1));
    expect(Object.keys(w.cases).length).toBe(caseCount);
    expect(w.crimes.at(-1)?.investigatedAt).toBe(campaignMinute(w));
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
