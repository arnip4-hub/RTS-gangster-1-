import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { MINUTES_PER_SECOND, Sim } from '../src/sim/sim';
import { issueOrder, issueStreetOrder, clearStreetOrder, returnToBase, buyWeapon, buyVehicle, moveToPool } from '../src/sim/api';
import { buildingDoor } from '../src/sim/world';
import { tickStreetOrders } from '../src/sim/systems/street';
import { tickOrders } from '../src/sim/execution';
import { clearDestination } from '../src/sim/movement';
import { restoreLegacyTransport } from '../src/sim/transport';

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 500000 });
  sim.launchWeek();
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]], p = w.people[team.lieutenantId];
  const site = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.isHQ)!;
  p.orderId = null; delete p.resumeOrderId; p.streetOrder = null; p.buildingId = null; p.inVehicle = false;
  p.pos = buildingDoor(w, site); clearDestination(p);
  return { sim, w, gang, team, p, site };
}
function enter(s: ReturnType<typeof fixture>, ids = [s.p.id]) {
  expect(issueStreetOrder(s.w, s.gang.id, ids, 'enterBuilding', null, null, s.site.id).ok).toBe(true);
}

describe('enter and stay in gang premises', () => {
  it('stays inside over full simulation ticks, including after save/load', () => {
    const s = fixture(); enter(s); tickStreetOrders(s.w, s.sim.rng, 1);
    expect(s.p.buildingId).toBe(s.site.id);
    for (let i = 0; i < 5; i++) s.sim.advance(1 / MINUTES_PER_SECOND, 1);
    expect(s.p.buildingId).toBe(s.site.id); expect(s.p.dest).toBeNull();
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(s.w)));
    for (let i = 0; i < 5; i++) restored.advance(1 / MINUTES_PER_SECOND, 1);
    const visitor = restored.world.people[s.p.id];
    expect(visitor.buildingId).toBe(s.site.id);
    expect(visitor.streetOrder?.type).toBe('enterBuilding');
    expect(visitor.dest).toBeNull();
  });

  it('holds an interrupted worker indoors until cancellation, then resumes through the door', () => {
    const s = fixture();
    expect(issueOrder(s.w, s.gang.id, { type: 'goTo', teamId: s.team.id, pos: { x: 10, y: 10 }, opts: { manpower: 1 } }).ok).toBe(true);
    const order = s.w.orders[s.team.orderIds.at(-1)!];
    order.state = 'travelling'; order.assignedIds = [s.p.id]; s.p.orderId = order.id;
    enter(s); tickStreetOrders(s.w, s.sim.rng, 1);
    tickOrders(s.w, s.sim.rng, 1);
    expect(s.p.buildingId).toBe(s.site.id);
    expect(s.p.orderId).toBeNull(); expect(s.p.dest).toBeNull();
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(s.w)));
    const visitor = restored.world.people[s.p.id];
    tickOrders(restored.world, restored.rng, 1);
    expect(visitor.orderId).toBeNull(); expect(visitor.dest).toBeNull();
    expect(clearStreetOrder(restored.world, [visitor.id]).ok).toBe(true);
    expect(visitor.buildingId).toBeNull();
    expect(visitor.pos).toEqual(buildingDoor(restored.world, restored.world.buildings[s.site.id]));
    tickOrders(restored.world, restored.rng, 1);
    expect(visitor.orderId).toBe(order.id);
  });

  it.each(['destroyed', 'lost'] as const)('cancels entry when the building is %s before arrival', reason => {
    const s = fixture(); enter(s);
    if (reason === 'destroyed') s.site.state = 'destroyed'; else s.site.ownerGangId = null;
    tickStreetOrders(s.w, s.sim.rng, 1);
    expect(s.p.buildingId).toBeNull(); expect(s.p.streetOrder).toBeNull();
  });

  it('leaves a held building if the gang loses ownership', () => {
    const s = fixture(); enter(s); tickStreetOrders(s.w, s.sim.rng, 1);
    s.site.ownerGangId = null;
    tickStreetOrders(s.w, s.sim.rng, 1);
    expect(s.p.buildingId).toBeNull(); expect(s.p.streetOrder).toBeNull();
    expect(s.p.pos).toEqual(buildingDoor(s.w, s.site));
  });

  it.each(['goTo', 'returnToBase'] as const)('leaves through the door on %s', command => {
    const s = fixture(); enter(s); tickStreetOrders(s.w, s.sim.rng, 1);
    const result = command === 'goTo'
      ? issueStreetOrder(s.w, s.gang.id, [s.p.id], 'goTo', null, { x: 10, y: 10 })
      : returnToBase(s.w, s.gang.id, s.p.id);
    expect(result.ok).toBe(true); expect(s.p.buildingId).toBeNull();
    expect(s.p.pos).toEqual(buildingDoor(s.w, s.site));
  });

  it.each([false, true])('parks the car and walks all selected occupants indoors (passenger=%s)', withPassenger => {
    const s = fixture(); s.team.vehicles.coupe = 1;
    const riders = withPassenger ? [s.p, s.w.people[s.team.memberIds[0]]] : [s.p];
    for (const rider of riders) { rider.inVehicle = true; rider.pos = { x: 81, y: 52.05 }; clearDestination(rider); }
    delete s.w.vehicleFleet;
    restoreLegacyTransport(s.w);
    const key = s.p.vehicleKey!;
    expect(key).toBeDefined();
    enter(s, riders.map(p => p.id));
    for (let i = 0; i < 100 && riders.some(p => p.buildingId !== s.site.id); i++) tickStreetOrders(s.w, s.sim.rng, 1);
    for (const rider of riders) {
      expect(rider.buildingId).toBe(s.site.id);
      expect(rider.inVehicle).toBe(false); expect(rider.vehicleKey).toBeUndefined();
      expect(rider.dest).toBeNull();
    }
    expect(s.w.vehicleFleet![key].occupantIds).toEqual([]);
    expect(s.w.vehicleFleet![key].driverId).toBeNull();
    expect(s.w.vehicleFleet![key].pos).not.toEqual(s.p.pos);
  });

  it('preserves an entry command saved before arrival', () => {
    const s = fixture(); enter(s);
    const restored = Sim.fromSave(JSON.parse(JSON.stringify(s.w)));
    expect(restored.world.people[s.p.id].streetOrder).toEqual(s.p.streetOrder);
    tickStreetOrders(restored.world, restored.rng, 1);
    expect(restored.world.people[s.p.id].buildingId).toBe(s.site.id);
  });

  it('keeps a visitor indoors across weekly settlement and allows recall afterwards', () => {
    const s = fixture(); enter(s); tickStreetOrders(s.w, s.sim.rng, 1);
    s.sim.finishWeek(); s.sim.launchWeek();
    expect(s.p.buildingId).toBe(s.site.id);
    expect(s.p.streetOrder?.type).toBe('enterBuilding');
    expect(returnToBase(s.w, s.gang.id, s.p.id).ok).toBe(true);
    expect(s.p.buildingId).toBeNull();
  });

  it('rejects enemy premises without changing the current route', () => {
    const s = fixture(), enemy = Object.values(s.w.buildings).find(b => b.ownerGangId != null && b.ownerGangId !== s.gang.id)!;
    const before = JSON.stringify(s.p);
    expect(issueStreetOrder(s.w, s.gang.id, [s.p.id], 'enterBuilding', null, null, enemy.id).ok).toBe(false);
    expect(JSON.stringify(s.p)).toBe(before);
  });

  it('blocks purchases away from premises without charging, and accepts them at the door or inside', () => {
    const s = fixture(); s.p.pos = { x: 1, y: 1 };
    const before = s.gang.cash;
    expect(buyWeapon(s.w, s.gang.id, 'pistol', s.team.id).ok).toBe(false);
    expect(buyVehicle(s.w, s.gang.id, 'coupe', s.team.id).ok).toBe(false);
    expect(s.gang.cash).toBe(before);
    s.p.pos = buildingDoor(s.w, s.site);
    expect(buyWeapon(s.w, s.gang.id, 'pistol', s.team.id).ok).toBe(true);
    expect(buyVehicle(s.w, s.gang.id, 'coupe', s.team.id).ok).toBe(true);
    enter(s); tickStreetOrders(s.w, s.sim.rng, 1);
    expect(buyWeapon(s.w, s.gang.id, 'pistol', s.team.id).ok).toBe(true);
    expect(buyVehicle(s.w, s.gang.id, 'coupe', s.team.id).ok).toBe(true);
  });

  it('keeps pool membership and save references consistent after a transfer', () => {
    const s = fixture(), hood = s.w.people[s.team.memberIds[0]];
    expect(moveToPool(s.w, s.gang.id, hood.id).ok).toBe(true);
    expect(hood.teamId).toBeNull(); expect(s.team.memberIds).not.toContain(hood.id);
    expect(s.gang.poolIds.filter(id => id === hood.id)).toHaveLength(1);
    expect(() => Sim.fromSave(JSON.parse(JSON.stringify(s.w)))).not.toThrow();
  });
});
