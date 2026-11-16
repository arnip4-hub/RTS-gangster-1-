import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { campaignMinute } from '../src/sim/calendar';
import { ensurePoliceFile } from '../src/sim/caseEvidence';
import { Sim } from '../src/sim/sim';
import type { CrimeRecord, WorldState } from '../src/sim/types';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, citySize: 10, seed: 404 });
  const w = sim.world, gang = sim.playerGang;
  const person = w.people[w.teams[gang.teamIds[0]].memberIds[0]], officer = w.people[w.policeIds[0]];
  w.phase = 'week'; w.minute = 480;
  const crime: CrimeRecord = { id: w.sequences.crime++, week: w.week, gangId: gang.id,
    perpetratorId: person.id, kind: 'streetKill', buildingId: null, victimId: null,
    witnesses: [], arrestRisk: 0, reported: false };
  w.crimes.push(crime);
  const file = ensurePoliceFile(w, crime, person.pos);
  return { w, person, officer, crime, file, now: campaignMinute(w) };
}
const restore = (w: WorldState) => Sim.fromSave(structuredClone(w));

describe('saved RTS police knowledge', () => {
  it('preserves a future report without treating it as current identification', () => {
    const s = fixture();
    s.file.statements.push({ witnessId: s.officer.id, observation: 'face', confidence: 90,
      reliability: 90, observedAt: s.now, reportedAt: s.now + 20, suspectId: s.person.id });
    const saved = restore(s.w), crime = saved.world.crimes.find(c => c.id === s.crime.id)!;
    expect(crime.reported).toBe(false);
    expect(crime.police?.statements[0].reportedAt).toBe(s.now + 20);
    expect(crime.police?.suspectId).toBeUndefined();
    expect(saved.world.people[s.person.id].wanted).toBe(0);
  });

  it('accepts a saved unknown-offender inquiry without inventing a person or gang', () => {
    const s = fixture();
    s.crime.leadOnly = true; s.crime.perpetratorId = 0; s.crime.gangId = 0;
    s.crime.reported = true; s.crime.reportedAt = s.now;
    const saved = restore(s.w).world.crimes.find(c => c.id === s.crime.id)!;
    expect(saved.police?.suspectId).toBeUndefined();
    expect(saved.perpetratorId).toBe(0);
  });

  it.each(['witness', 'suspect', 'warrant', 'evidence', 'task', 'custody'] as const)
  ('rejects corrupt %s links rather than installing the city', kind => {
    const s = fixture();
    if (kind === 'witness') s.file.statements.push({ witnessId: -1, observation: 'sound',
      confidence: 20, reliability: 50, observedAt: s.now });
    if (kind === 'suspect') s.file.suspectId = -1;
    if (kind === 'warrant') s.file.warrantAt = s.now;
    if (kind === 'evidence') s.file.evidence.push({ kind: 'financial', strength: 50,
      collectedAt: s.now, personId: -1, note: 'invalid evidence link' });
    if (kind === 'task') s.officer.policeTask = { crimeId: -1, kind: 'surveillance', phase: 'working',
      target: s.officer.pos, until: s.now + 60, workLeft: 20 };
    if (kind === 'custody') {
      s.person.status = 'arrested';
      s.person.custody = { crimeId: s.crime.id, officerId: s.officer.id,
        arrestedAt: s.now, reviewAt: s.now + 360, releaseAt: s.now + 10 };
    }
    expect(() => restore(s.w)).toThrow(/police|witness|evidence|warrant|custody/i);
  });
});
