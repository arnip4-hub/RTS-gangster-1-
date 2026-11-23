import { describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { tickOrders } from '../src/sim/execution';
import { tickGoods } from '../src/sim/goodsDelivery';
import { knownPrisonRivals, requestPrisonAttack, requestPrisonContact, requestPrisonProtection, tickPrison } from '../src/sim/prison';
import { Sim } from '../src/sim/sim';
import { roadPosition } from '../src/sim/vehicleNavigation';
import { allBuildings } from '../src/sim/world';
import type { GoodsDelivery } from '../src/sim/types';

const make = () => new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 708, citySize: 10,
  startHoods: 8, startMoney: 100_000 });

describe('prison contacts and freight hijacking', () => {
  it('only learns a rival in the same prison, then resolves an attack with sentence and evidence costs', () => {
    const sim = make(), w = sim.world, gang = sim.playerGang;
    sim.launchWeek();
    const inmate = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
    const rival = Object.values(w.people).find(p => p.gangId != null && p.gangId !== gang.id && p.role === 'hood')!;
    const elsewhere = Object.values(w.people).find(p => p.id !== rival.id && p.gangId != null && p.gangId !== gang.id && p.role === 'hood')!;
    for (const [p, prison] of [[inmate, 0], [rival, 0], [elsewhere, 1]] as const) {
      p.status = 'jailed'; p.jailWeeks = 4; p.prisonId = prison; p.prisonSince = 0;
    }
    w.gangs[rival.gangId!].cash = 0;
    w.gangs[elsewhere.gangId!].cash = 0;
    expect(requestPrisonAttack(w, gang.id, inmate.id, rival.id).ok).toBe(false);
    expect(requestPrisonContact(w, gang.id, inmate.id).ok).toBe(true);
    vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
    w.minute = 1800; tickPrison(w, sim.rng);
    expect(knownPrisonRivals(w, gang.id, inmate).map(p => p.id)).toEqual([rival.id]);
    expect(knownPrisonRivals(w, gang.id, inmate)).not.toContain(elsewhere);
    expect(requestPrisonProtection(w, gang.id, inmate.id).ok).toBe(true);
    expect(inmate.prisonProtectedUntil).toBeGreaterThan(w.minute);
    expect(requestPrisonAttack(w, gang.id, inmate.id, rival.id).ok).toBe(true);
    vi.spyOn(sim.rng, 'int').mockReturnValue(115);
    w.minute = 3240; tickPrison(w, sim.rng);
    expect(rival.status).toBe('dead');
    // A fatal prison assault now extends the sentence by eight weeks (4 -> 12).
    expect(inmate.jailWeeks).toBe(12);
    expect(gang.evidence).toBeGreaterThan(0);
    expect(Sim.fromSave(structuredClone(w)).world.people[rival.id].status).toBe('dead');
  });

  it('takes an actual rival delivery and routes the cases into owned storage', () => {
    const sim = make(), w = sim.world, gang = sim.playerGang;
    const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const source = allBuildings(w).find(b => b.typeId === 'warehouse' && b.ownerGangId !== gang.id)!;
    const store = allBuildings(w).find(b => b.typeId === 'warehouse' && b.id !== source.id)!;
    source.ownerGangId = rival.id; store.ownerGangId = gang.id;
    source.state = 'trading'; store.state = 'trading';
    store.stock = { liquor: 0, stolen: 0, counterfeit: 0 };
    const point = roadPosition(w, w.lots[source.lotId].center);
    const delivery: GoodsDelivery = { sourceId: source.id, gangId: rival.id, kind: 'liquor', amount: 30,
      pos: { ...point }, path: [], targetId: source.id, returning: false, slot: 0, heading: 0, halted: false };
    (w.goodsDeliveries ??= {})[source.id] = delivery;
    const team = w.teams[gang.teamIds[0]];
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'hijack', pos: point,
      opts: { manpower: 1, priority: true } }).ok).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    sim.launchWeek();
    const actor = w.people[order.assignedIds[0]];
    actor.pos = { ...point }; actor.dest = null; actor.path = [];
    order.state = 'executing';
    vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
    tickOrders(w, sim.rng, 1);
    expect(order.state).toBe('done');
    expect(delivery.gangId).toBe(gang.id);
    expect(delivery.targetId).toBe(store.id);
    expect(store.stock.liquor).toBe(0);
    expect(Sim.fromSave(structuredClone(w)).world.goodsDeliveries?.[source.id].gangId).toBe(gang.id);
    for (let i = 0; i < 2000 && store.stock.liquor < 30; i++) { w.minute++; tickGoods(w, 1); }
    expect(store.stock.liquor).toBe(30);
  }, 240000);
});
