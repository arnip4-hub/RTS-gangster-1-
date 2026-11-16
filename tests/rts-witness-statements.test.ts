import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { recordCrime, tickWitnessReports } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { canObservePerson, hasWitnessLineOfSight, rtsWitnessStatements } from '../src/sim/witnessStatements';
import type { Person, WorldState } from '../src/sim/types';
import { tickBodyRecovery } from '../src/sim/bodyRecovery';
import { killPerson } from '../src/sim/execution';
import { buildingDoor } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());

function scene() {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, citySize: 10, seed: 404 });
  const w = sim.world, gang = sim.playerGang;
  w.phase = 'week'; w.minute = 600;
  for (const p of Object.values(w.people)) p.pos = { x: -9999, y: -9999 };
  const actor = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
  actor.buildingId = null; actor.pos = { x: -100, y: -100 }; actor.skills.stealth = .5;
  const witness = Object.values(w.people).find(p => p.role === 'citizen' && p.status === 'active')!;
  witness.buildingId = null; witness.pos = { x: -96, y: -100 }; witness.skills.intelligence = 5;
  const params = { gangId: gang.id, perpetratorId: actor.id, type: 'streetKill' as const,
    pos: { ...actor.pos }, severity: 10 };
  vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
  return { sim, w, gang, actor, witness, params };
}

describe('continuous RTS witness knowledge', () => {
  it('leaves an unobserved crime without wanted status or gang-wide court evidence', () => {
    const s = scene(); s.witness.pos = { x: -9999, y: -9999 };
    const beforeWanted = s.actor.wanted, beforeEvidence = s.gang.evidence;
    const c = recordCrime(s.w, s.sim.rng, s.params);
    expect(c.reported).toBe(false); expect(c.witnesses).toEqual([]);
    expect(c.police?.statements).toEqual([]); expect(c.police?.suspectId).toBeUndefined();
    expect(s.actor.wanted).toBe(beforeWanted); expect(s.gang.evidence).toBe(beforeEvidence);
  });

  it('keeps a close civilian face observation private until the saved report time', () => {
    const s = scene(); s.w.policeIds = [];
    const c = recordCrime(s.w, s.sim.rng, s.params), statement = c.police!.statements[0];
    expect(statement.observation).toBe('face'); expect(statement.suspectId).toBe(s.actor.id);
    expect(statement.reportedAt).toBeGreaterThan(s.w.minute);
    expect(c.reported).toBe(false); expect(c.witnesses).toEqual([]);
    const saved = structuredClone(s.w);
    saved.minute = statement.reportedAt! - 1; tickWitnessReports(saved);
    expect(saved.crimes.at(-1)!.reported).toBe(false);
    saved.minute++; tickWitnessReports(saved);
    expect(saved.crimes.at(-1)!.reported).toBe(true);
    expect(saved.crimes.at(-1)!.witnesses).toEqual([s.witness.id]);
    expect(saved.people[s.actor.id].wanted).toBe(0);
  });

  it('does not let a witness killed before calling report from beyond the grave', () => {
    const s = scene(); s.w.policeIds = [];
    const c = recordCrime(s.w, s.sim.rng, s.params);
    s.witness.status = 'dead'; s.w.minute += 60; tickWitnessReports(s.w);
    expect(c.reported).toBe(false); expect(c.witnesses).toEqual([]);
  });

  it('carries a pending report across Sunday midnight on absolute game time', () => {
    const s = scene(); s.w.policeIds = []; s.w.minute = 7 * 24 * 60 - 1;
    const c = recordCrime(s.w, s.sim.rng, s.params), due = c.police!.statements[0].reportedAt!;
    s.w.week++; s.w.minute = due - 7 * 24 * 60 - 1; tickWitnessReports(s.w);
    expect(c.reported).toBe(false);
    s.w.minute++; tickWitnessReports(s.w); expect(c.reported).toBe(true);
  });

  it('records hearing violence without inventing a suspect identification', () => {
    const s = scene(); s.witness.pos.x = -40;
    const statements = rtsWitnessStatements(s.w, s.sim.rng, { ...s.params, type: 'shootout' }, 5);
    expect(statements).toHaveLength(1); expect(statements[0].observation).toBe('sound');
    expect(statements[0].suspectId).toBeUndefined(); expect(statements[0].vehicleKey).toBeUndefined();
  });

  it('reduces facial recognition after dark without changing the game clock', () => {
    const s = scene(); s.witness.pos.x = -86;
    expect(rtsWitnessStatements(s.w, s.sim.rng, s.params, 10)[0].observation).toBe('face');
    s.w.minute = 22 * 60;
    const night = rtsWitnessStatements(s.w, s.sim.rng, s.params, 10)[0];
    expect(night.observation).toBe('description'); expect(night.suspectId).toBeUndefined();
    expect(s.w.minute).toBe(22 * 60);
  });

  it.each(['kidnapped', 'arrested', 'onTrial', 'beaten', 'jailed', 'dead'] as const)('does not use %s people as street witnesses', status => {
    const s = scene(); s.witness.status = status;
    expect(rtsWitnessStatements(s.w, s.sim.rng, s.params, 10)).toEqual([]);
  });

  it('does not see an unrelated street crime from inside a home', () => {
    const s = scene(); s.witness.buildingId = Object.values(s.w.buildings)[0].id;
    expect(rtsWitnessStatements(s.w, s.sim.rng, s.params, 10)).toEqual([]);
  });

  it('keeps an injured victim’s account until they recover enough to report', () => {
    const s = scene(); s.w.policeIds = [];
    s.witness.status = 'beaten'; s.witness.buildingId = Object.values(s.w.buildings)[0].id;
    const c = recordCrime(s.w, s.sim.rng, { ...s.params, victimId: s.witness.id, pos: s.witness.pos });
    expect(c.police?.statements[0]).toMatchObject({ witnessId: s.witness.id, observation: 'face' });
    const restored = Sim.fromSave(structuredClone(s.w)), saved = restored.world.crimes.at(-1)!;
    restored.world.minute += 180; tickWitnessReports(restored.world); expect(saved.reported).toBe(false);
    restored.world.people[s.witness.id].status = 'active'; tickWitnessReports(restored.world); expect(saved.reported).toBe(true);
  });

  it('lets an officer directly identify an offender they actually see at close range', () => {
    const s = scene(); s.witness.pos = { x: -9999, y: -9999 };
    const officer = s.w.people[s.w.policeIds[0]]; officer.pos = { x: -96, y: -100 }; officer.buildingId = null;
    const c = recordCrime(s.w, s.sim.rng, s.params);
    expect(c.reported).toBe(true); expect(c.witnesses).toEqual([officer.id]);
    expect(c.police!.statements[0]).toMatchObject({ observation: 'direct', suspectId: s.actor.id,
      reportedAt: s.w.minute, interviewedAt: s.w.minute });
    expect(s.actor.wanted).toBe(0); // An observed incident is still not a blanket heat meter.
  });

  it('blocks observations through an occupied building footprint', () => {
    const w = { gridW: 1, gridH: 1,
      blocks: [{ id: 0, lotIds: [1] }],
      lots: { 1: { buildingId: 2, bounds: { x: 20, y: 10, w: 10, h: 20 } } },
      buildings: { 2: { cls: 'commercial', state: 'trading' } }, minute: 600,
    } as unknown as WorldState;
    expect(hasWitnessLineOfSight(w, { x: 10, y: 20 }, { x: 40, y: 20 })).toBe(false);
    expect(hasWitnessLineOfSight(w, { x: 10, y: 5 }, { x: 40, y: 5 })).toBe(true);
    const observer = { status: 'active', buildingId: null, pos: { x: 10, y: 20 } } as Person;
    const target = { status: 'active', buildingId: null, pos: { x: 40, y: 20 } } as Person;
    expect(canObservePerson(w, observer, target)).toBe(false);
  });
});

describe('body discovery supplies a scene without a culprit', () => {
  it('lets a passer-by report an unseen death, but leaves the body uncovered until police arrive', () => {
    const s = scene(), victim = Object.values(s.w.people).find(p => p.role === 'citizen' && p.id !== s.witness.id)!;
    victim.buildingId = null; victim.inVehicle = false;
    victim.pos = buildingDoor(s.w, Object.values(s.w.buildings).find(b => b.cls === 'commercial')!);
    s.witness.pos = { ...victim.pos };
    killPerson(s.w, victim, 'unexplained death');
    tickBodyRecovery(s.w);
    const c = s.w.crimes.at(-1)!;
    expect(c).toMatchObject({ leadOnly: true, reported: false });
    expect(c.police!.statements[0]).toMatchObject({ witnessId: s.witness.id, observation: 'description' });
    expect(c.police!.statements[0].suspectId).toBeUndefined();
    expect(victim.bodyRecovery?.coveredAt).toBeUndefined();
    s.w.minute = c.police!.statements[0].reportedAt!; tickWitnessReports(s.w);
    expect(c.reported).toBe(true); expect(victim.bodyRecovery?.coveredAt).toBeUndefined();
    expect(s.w.policeIds.some(id => s.w.people[id].emergencyResponse?.crimeId === c.id)).toBe(true);
    const officer = s.w.people[s.w.policeIds[0]];
    officer.pos = { ...victim.pos }; officer.buildingId = null; officer.inVehicle = false;
    tickBodyRecovery(s.w); expect(victim.bodyRecovery?.coveredAt).toBe(s.w.minute);
    expect(s.w.crimes.filter(x => x.victimId === victim.id)).toHaveLength(1);
  });

  it('opens the prior crime when police find a body, without learning its true perpetrator', () => {
    const s = scene(); s.witness.pos = { x: -9999, y: -9999 };
    const victim = Object.values(s.w.people).find(p => p.role === 'citizen' && p.id !== s.witness.id)!;
    victim.buildingId = null; victim.inVehicle = false;
    victim.pos = buildingDoor(s.w, Object.values(s.w.buildings).find(b => b.cls === 'commercial')!);
    s.actor.pos = { ...victim.pos };
    killPerson(s.w, victim, 'unwitnessed death');
    const c = recordCrime(s.w, s.sim.rng, { ...s.params, pos: victim.pos, victimId: victim.id });
    expect(c.reported).toBe(false);
    const officer = s.w.people[s.w.policeIds[0]]; officer.pos = { ...victim.pos }; officer.buildingId = null; officer.inVehicle = false;
    tickBodyRecovery(s.w);
    expect(c.reported).toBe(true); expect(c.police?.suspectId).toBeUndefined();
    expect(c.police?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'scene' })]));
    expect(c.police?.evidence.every(e => e.personId == null)).toBe(true);
    expect(s.actor.wanted).toBe(0); expect(victim.bodyRecovery?.coveredAt).toBe(s.w.minute);
    expect(victim.bodyRecovery?.hearseRoute?.length).toBeGreaterThan(1);
  });

  it('opens one unknown inquiry and paper story for an unexplained body', () => {
    const s = scene(), victim = s.witness;
    victim.pos = buildingDoor(s.w, Object.values(s.w.buildings).find(b => b.cls === 'commercial')!);
    killPerson(s.w, victim, 'unexplained death');
    const officer = s.w.people[s.w.policeIds[0]]; officer.pos = { ...victim.pos }; officer.buildingId = null; officer.inVehicle = false;
    const count = s.w.crimes.length, news = s.w.news.length;
    tickBodyRecovery(s.w); tickBodyRecovery(s.w);
    expect(s.w.crimes).toHaveLength(count + 1); expect(s.w.news).toHaveLength(news + 1);
    expect(s.w.crimes.at(-1)).toMatchObject({ leadOnly: true, perpetratorId: 0, gangId: 0, reported: true });
    expect(s.w.crimes.at(-1)?.police?.suspectId).toBeUndefined();
  });
});
