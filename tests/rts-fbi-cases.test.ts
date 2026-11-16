import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { campaignMinute } from '../src/sim/calendar';
import { addCaseEvidence, caseEvidenceStrength, ensurePoliceFile, refreshCaseIdentity } from '../src/sim/caseEvidence';
import { dispatchRtsFbi, observeRtsFbiLead } from '../src/sim/fbiRts';
import { tickPoliceCases } from '../src/sim/policeCases';
import { Sim } from '../src/sim/sim';
import { accountantCheck, dispatchFbi, heavyCrimeSuspicion, memberWarrants, raidHeadquarters, raidSite,
  serveAccountantWarrants, streetArrest, tickFbi, weeklyFbi } from '../src/sim/systems/fbi';
import type { CrimeRecord, GoodsDelivery } from '../src/sim/types';
import { parkingSpot } from '../src/sim/vehicleNavigation';
import { buildingDoor, dist } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10, startMoney: 100_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.phase = 'week'; w.minute = 480; w.orders = {}; w.crimes = []; w.policeIds = [];
  for (const t of Object.values(w.teams)) t.orderIds = [];
  const agent = w.people[w.fbiIds[0]]; w.fbiIds = [agent.id];
  agent.buildingId = null; agent.status = 'active'; agent.inVehicle = false;
  agent.dest = null; agent.path = []; delete agent.fbiAssignment; delete agent.policeTask;
  const site = Object.values(w.buildings).find(b => b.cls === 'empty' && w.lots[b.lotId].index === 4)!;
  const front = Object.values(w.buildings).find(b => b.blockId === site.blockId && b.cls === 'commercial' && b.ownerPersonId != null)!;
  site.ownerGangId = gang.id; site.typeId = 'casino'; site.cls = 'illegal'; site.state = 'trading'; site.cover = .1;
  site.frontId = front.id; front.hidesId = site.id; front.ownerGangId = gang.id; front.cover = .1;
  site.stock = { liquor: 50, stolen: 20, counterfeit: 0 };
  const manager = w.people[team.memberIds[0]], mate = w.people[team.lieutenantId];
  manager.buildingId = site.id; manager.pos = { ...w.lots[site.lotId].center }; manager.status = 'active';
  site.managerId = manager.id;
  mate.buildingId = null; mate.pos = { x: 5000, y: 5000 }; mate.status = 'active';
  const informer = w.people[front.ownerPersonId!]; informer.status = 'active';
  const door = buildingDoor(w, front);
  const next = Object.values(w.buildings).find(b => b.id !== front.id && dist(buildingDoor(w, b), door) > 35 && dist(buildingDoor(w, b), door) < 80)!;
  agent.pos = buildingDoor(w, next);
  return { sim, w, gang, team, site, front, agent, manager, mate, informer, door };
}
type Fixture = ReturnType<typeof fixture>;

function lead(s: Fixture) {
  s.informer.squealedOn = { [s.gang.id]: campaignMinute(s.w) };
  dispatchFbi(s.w, s.sim.rng);
  return s.w.crimes.find(c => c.leadOnly && c.buildingId === s.front.id)!;
}
function minute(s: Fixture) { s.w.minute++; tickFbi(s.w, s.sim.rng, 1); tickPoliceCases(s.w, s.sim.rng, 1); }
function knownCrime(s: Fixture): CrimeRecord {
  const c: CrimeRecord = { id: s.w.sequences.crime++, week: s.w.week, gangId: s.gang.id,
    perpetratorId: s.manager.id, kind: 'kill', buildingId: null, victimId: null,
    witnesses: [], arrestRisk: 0, reported: true, reportedAt: campaignMinute(s.w) - 60 };
  s.w.crimes.push(c);
  const f = ensurePoliceFile(s.w, c, s.door, 'fbi');
  addCaseEvidence(s.w, c, { kind: 'direct', strength: 65, personId: s.manager.id,
    collectedAt: campaignMinute(s.w), note: 'Known person observed committing this offense' });
  refreshCaseIdentity(s.w, c);
  f.warrantAt = campaignMinute(s.w); f.warrantExpiresAt = campaignMinute(s.w) + 1440; f.stage = 'wanted';
  return c;
}

describe('RTS federal knowledge and physical arrests', () => {
  it('does not learn unseen murders, hidden stock or a teammate through legacy weekly paths', () => {
    const s = fixture();
    for (let i = 0; i < 3; i++) s.w.crimes.push({ id: s.w.sequences.crime++, week: s.w.week,
      gangId: s.gang.id, perpetratorId: s.manager.id, kind: 'kill', buildingId: null,
      victimId: null, witnesses: [], arrestRisk: 0, reported: false });
    heavyCrimeSuspicion(s.w);
    expect(memberWarrants(s.w, s.sim.rng)).toEqual([]);
    serveAccountantWarrants(s.w, s.sim.rng); weeklyFbi(s.w, s.sim.rng); dispatchFbi(s.w, s.sim.rng);
    expect(s.manager.crimeSuspicion).toBeUndefined(); expect(s.mate.crimeSuspicion).toBeUndefined();
    expect(s.manager.fbiWarrant).toBeUndefined(); expect(s.mate.fbiWarrant).toBeUndefined();
    expect(s.manager.status).toBe('active'); expect(s.mate.status).toBe('active');
    expect(s.agent.policeTask).toBeUndefined(); expect(s.agent.fbiAssignment).toBeUndefined();
    expect(s.w.crimes).toHaveLength(3); expect(s.site.state).toBe('trading');
  });

  it('cannot make a low-Intelligence accountant wanted without an identified case', () => {
    const s = fixture();
    s.manager.role = 'accountant'; s.manager.skills.intelligence = .5;
    s.manager.taxEvasionWeeks = []; s.gang.accountantId = s.manager.id; s.w.fbiZeal = 207;
    expect(accountantCheck(s.w, s.gang)).toBe(false);
    expect(s.manager.fbiWarrant).toBeUndefined();
  });

  it('serves only an identified individual warrant after physically reaching the suspect', () => {
    const s = fixture(), crime = knownCrime(s);
    s.manager.buildingId = null; s.manager.pos = { ...s.door };
    s.agent.pos = { x: s.door.x + 1000, y: s.door.y };
    serveAccountantWarrants(s.w, s.sim.rng);
    expect(streetArrest(s.w, s.sim.rng, s.agent, s.manager)).toBe('breaksAway');
    expect(s.manager.status).toBe('active'); expect(s.mate.status).toBe('active');
    s.agent.pos = { ...s.manager.pos };
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    expect(streetArrest(s.w, s.sim.rng, s.agent, s.manager)).toBe('arrested');
    expect(s.manager.status).toBe('arrested'); expect(s.manager.custody?.crimeId).toBe(crime.id);
    expect(s.mate.status).toBe('active');
  });

  it('requires actual tax disclosures and retains the disclosed documentary evidence in custody', () => {
    const s = fixture(), accountant = Object.values(s.w.people).find(p => p.role === 'accountant')!;
    accountant.status = 'jailed'; accountant.taxRecords = { [s.gang.id]: 5000 };
    const c: CrimeRecord = { id: s.w.sequences.crime++, week: s.w.week, gangId: s.gang.id,
      perpetratorId: s.gang.bossId, kind: 'taxEvasion', buildingId: null, victimId: null,
      witnesses: [accountant.id], arrestRisk: .2, reported: true };
    s.w.crimes.push(c); dispatchRtsFbi(s.w);
    expect(c.police?.evidence.some(e => e.kind === 'financial' && e.personId === s.gang.bossId)).toBe(true);
    expect(caseEvidenceStrength(s.w, c)).toBeGreaterThanOrEqual(55);
    expect(s.w.people[s.gang.bossId].status).toBe('active');
  });
});

describe('RTS federal surveillance and search', () => {
  it('cannot raid a full hidden operation remotely or without locally acquired grounds', () => {
    const s = fixture(); lead(s);
    s.agent.pos = { x: 5000, y: 5000 };
    raidSite(s.w, s.sim.rng, s.site, s.agent); raidHeadquarters(s.w, s.sim.rng, s.front, s.agent);
    expect(s.site.state).toBe('trading'); expect(s.site.stock.liquor).toBe(50);
    expect(s.manager.status).toBe('active'); expect(s.mate.status).toBe('active');
  });

  it('travels to a known lead, observes actual unloading and returns for the due search', () => {
    const s = fixture(), c = lead(s);
    vi.spyOn(s.sim.rng, 'chance').mockImplementation(probability => probability >= .1);
    const sources = Object.values(s.w.buildings).filter(b => b.id !== s.front.id && b.id !== s.site.id).slice(0, 2);
    const pos = parkingSpot(s.w, s.door, []);
    const delivery = (sourceId: number): GoodsDelivery => ({ sourceId, gangId: s.gang.id,
      kind: 'liquor', amount: 20, targetId: s.site.id, returning: false, pos: { ...pos },
      path: [], heading: 0, halted: true, unloadLeft: 3 });
    s.w.goodsDeliveries = Object.fromEntries(sources.map(b => [b.id, delivery(b.id)]));
    let deadline: number | undefined, sawTravel = false;
    for (let i = 0; i < 1000 && s.site.fbiClosedWeek == null; i++) {
      minute(s);
      sawTravel ||= s.agent.policeTask?.phase === 'travelling';
      if (c.police?.raidDueAt != null) {
        deadline ??= c.police.raidDueAt;
        if (campaignMinute(s.w) < deadline) expect(s.site.state).toBe('trading');
        s.w.goodsDeliveries = {};
      }
    }
    expect(sawTravel).toBe(true); expect(deadline).toBeDefined();
    expect(c.police?.siteObservationCount).toBe(2);
    expect(s.site.fbiClosedWeek).toBe(s.w.week);
    expect(s.manager.status).toBe('arrested'); expect(s.manager.custody?.crimeId).toBe(c.id);
    expect(s.mate.status).toBe('active');
    expect(c.police?.evidence.some(e => e.kind === 'financial' && e.personId === s.manager.id)).toBe(true);
  });

  it('cannot observe unloading through an occupied building wall', () => {
    const s = fixture(), c = lead(s);
    s.agent.pos = { ...s.door };
    s.agent.policeTask = { crimeId: c.id, kind: 'surveillance', phase: 'working',
      target: s.door, until: campaignMinute(s.w) + 360, workLeft: 60 };
    const delivery: GoodsDelivery = { sourceId: s.site.id, gangId: s.gang.id, kind: 'liquor',
      amount: 10, targetId: s.front.id, returning: false, path: [], heading: 0,
      halted: true, unloadLeft: 20, pos: { ...s.w.lots[s.front.lotId].center } };
    s.w.goodsDeliveries = { [s.site.id]: delivery };
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(true);
    observeRtsFbiLead(s.w, s.sim.rng, s.agent);
    expect(c.police?.siteObservationCount ?? 0).toBe(0);
    // The same load becomes observable only when actually brought outside.
    delivery.pos = { ...s.door }; s.w.minute += 15;
    observeRtsFbiLead(s.w, s.sim.rng, s.agent);
    expect(c.police?.siteObservationCount).toBe(1);
  });

  it('can carry out an already due urgent search at the weekend', () => {
    const s = fixture(); s.w.minute = 5 * 1440 + 720;
    // The owner made the report on Friday; the authorized operation is due Saturday.
    s.informer.squealedOn = { [s.gang.id]: campaignMinute(s.w) - 1440 };
    s.w.minute -= 1440; dispatchRtsFbi(s.w); s.w.minute += 1440;
    const c = s.w.crimes.find(c => c.leadOnly)!;
    for (let i = 0; i < 2; i++) addCaseEvidence(s.w, c, { kind: 'surveillance', strength: 28,
      collectedAt: campaignMinute(s.w) - 180, buildingId: s.front.id, note: `Prior observed illicit unloading ${i}` });
    c.police!.siteObservationCount = 2; c.police!.raidDueAt = campaignMinute(s.w) + 2;
    c.police!.nextReviewAt = campaignMinute(s.w) + 2;
    vi.spyOn(s.sim.rng, 'chance').mockImplementation(probability => probability >= .1);
    for (let i = 0; i < 600 && s.site.fbiClosedWeek == null; i++) minute(s);
    expect(s.w.minute).toBeLessThan(6 * 1440);
    expect(s.site.fbiClosedWeek).toBe(s.w.week);
  });

  it('keeps acquired grounds, the deadline and travelling agent across save/restore', () => {
    const s = fixture(), c = lead(s);
    for (let i = 0; i < 2; i++) addCaseEvidence(s.w, c, { kind: 'surveillance', strength: 28,
      collectedAt: campaignMinute(s.w), buildingId: s.front.id, note: `Observed consignment before save ${i}` });
    c.police!.siteObservationCount = 2; c.police!.raidDueAt = campaignMinute(s.w) + 120;
    c.police!.nextReviewAt = campaignMinute(s.w);
    for (let i = 0; i < 60 && !s.agent.policeTask; i++) minute(s);
    expect(s.agent.policeTask?.kind).toBe('surveillance');
    expect(s.agent.policeTask?.phase).toBe('travelling');
    const deadline = c.police!.raidDueAt;
    const restored = Sim.fromSave(structuredClone(s.w)), w = restored.world;
    expect(w.people[s.agent.id].policeTask).toEqual(s.agent.policeTask);
    expect(w.crimes.find(crime => crime.id === c.id)?.police?.raidDueAt).toBe(deadline);
    vi.spyOn(restored.rng, 'chance').mockImplementation(probability => probability >= .1);
    for (let i = 0; i < 600 && w.buildings[s.site.id].fbiClosedWeek == null; i++) {
      w.minute++; tickFbi(w, restored.rng, 1); tickPoliceCases(w, restored.rng, 1);
    }
    expect(w.buildings[s.site.id].fbiClosedWeek).toBe(w.week);
    expect(w.people[s.manager.id].custody?.crimeId).toBe(c.id);
    expect(w.people[s.mate.id].status).toBe('active');
  });

  it('does not recreate a concluded legacy discovery after loading', () => {
    const s = fixture(); s.site.discovered = true; s.site.fbiDiscoveredWeek = 1;
    dispatchRtsFbi(s.w);
    const c = s.w.crimes.find(c => c.leadOnly)!; c.police!.stage = 'closed';
    const restored = structuredClone(s.w), count = restored.crimes.length;
    dispatchRtsFbi(restored);
    expect(restored.crimes).toHaveLength(count);
    expect(restored.people[s.manager.id].wanted).toBe(0);
  });
});
