import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, moveToTeam } from '../src/sim/api';
import { ORDERS } from '../src/sim/constants';
import { estimateMinutes, tickOrders } from '../src/sim/execution';
import { crewOrderSkill, orderSkill, orderSkillText } from '../src/sim/orderSkills';
import { crewHasFirearm, crewWeaponLoadout, orderStaffing } from '../src/sim/orderStaffing';
import { Sim } from '../src/sim/sim';
import type { Order, OrderType, Person, Skills } from '../src/sim/types';
import { allocateWeapons } from '../src/sim/weapons';
import { buildingDoor } from '../src/sim/world';

afterEach(() => vi.restoreAllMocks());

function skills(overrides: Partial<Skills> = {}): Skills {
  return { intelligence: 1, organization: 1, business: 1, firearms: 1, fists: 1,
    knives: 1, arson: 1, explosives: 1, intimidation: 1, driving: 1, stealth: 1, ...overrides };
}
function hand(id: number, overrides: Partial<Skills>): Person {
  return { id, skills: skills(overrides) } as Person;
}
function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10, startMoney: 100_000 });
  const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
  w.orders = {};
  for (const t of Object.values(w.teams)) t.orderIds = [];
  const actor = w.people[team.memberIds[0]];
  actor.buildingId = null; actor.status = 'active'; actor.skills = skills();
  team.weapons = { pistol: 0, shotgun: 0, rifle: 0, tommy: 0, twinPistols: 0, explosives: 0 };
  const site = Object.values(w.buildings).find(b => b.cls === 'commercial' && b.ownerGangId == null && b.ownerPersonId != null && !b.protection)!;
  site.guardIds = [];
  const owner = w.people[site.ownerPersonId!];
  owner.status = 'active'; owner.opinion[gang.id] = 0;
  return { sim, w, gang, team, actor, site, owner };
}
type Fixture = ReturnType<typeof fixture>;
function prepare(s: Fixture, type: OrderType): Order {
  if (type === 'intimidate') {
    s.site.protection = { gangId: s.gang.id, weekly: 10, base: 10, refusing: true, grievance: 1 };
  }
  const result = issueOrder(s.w, s.gang.id, { teamId: s.team.id, type,
    ...(['kill', 'kidnap', 'assault'].includes(type) ? { personId: s.owner.id } : { buildingIds: [s.site.id] }),
    opts: { manpower: 1, preferredHoodId: s.actor.id } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const order = s.w.orders[s.team.orderIds.at(-1)!];
  order.state = 'executing'; order.assignedIds = [s.actor.id]; order.workLeft = 0;
  s.actor.orderId = order.id;
  return order;
}
function attemptedChance(type: OrderType, overrides: Partial<Skills>, armed = false) {
  const s = fixture();
  s.actor.skills = skills(overrides);
  if (armed) s.team.weapons.pistol = 1;
  if (type === 'bomb') s.team.weapons.explosives = 1;
  const order = prepare(s, type);
  const chance = vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
  tickOrders(s.w, s.sim.rng, 1);
  expect(chance.mock.calls.length).toBeGreaterThan(0);
  return { ...s, order, probability: chance.mock.calls[0][0] };
}

describe('shared task skill model', () => {
  it('does not borrow gun skill from an unequipped crew member', () => {
    const shooter = hand(1, { firearms: 5 }), brawler = hand(2, { fists: 4 });
    const armed = (p: Person) => p.id === 2;
    expect(orderSkill(shooter, ORDERS.raid, armed(shooter))).toBe(1);
    const before = crewOrderSkill([shooter, brawler], ORDERS.raid, armed);
    shooter.skills.firearms = 2;
    expect(crewOrderSkill([shooter, brawler], ORDERS.raid, armed)).toBe(before);
    expect(crewOrderSkill([shooter, brawler], ORDERS.raid, () => true)).toBeGreaterThan(before);
  });

  it('lets an armed expert retain their better close-combat skill', () => {
    expect(orderSkill(hand(1, { knives: 5, firearms: 1 }), ORDERS.kill, true)).toBe(5);
    expect(orderSkill(hand(1, { fists: 5, firearms: 1 }), ORDERS.raid, true)).toBe(5);
    expect(orderSkillText(ORDERS.raid)).toBe('Fists, or Firearms with a gun');
  });

  it('does not recruit an unarmed marksman when the only gun is reserved by a busy priority hood', () => {
    const s = fixture(), lieutenant = s.w.people[s.team.lieutenantId];
    const busy = s.w.people[s.gang.poolIds[0]];
    expect(moveToTeam(s.w, s.gang.id, busy.id, s.team.id).ok).toBe(true);
    busy.skills.firearms = 5;
    s.actor.skills = skills({ firearms: 4.5, fists: .5 });
    lieutenant.skills = skills({ organization: 5, intelligence: 5, fists: 4 });
    lieutenant.buildingId = null; lieutenant.status = 'active';
    s.team.weapons.pistol = 1;
    expect(issueOrder(s.w, s.gang.id, { teamId: s.team.id, type: 'explore', buildingIds: [s.site.id],
      opts: { manpower: 1, preferredHoodId: busy.id, priority: true } }).ok).toBe(true);
    const busyOrder = s.w.orders[s.team.orderIds.at(-1)!];
    busyOrder.assignedIds = [busy.id]; busyOrder.state = 'executing'; busy.orderId = busyOrder.id;
    const loadout = crewWeaponLoadout(s.w, s.team);
    expect(loadout.get(busy.id)).toBe('pistol');
    expect(loadout.has(s.actor.id)).toBe(false);
    const order = { type: 'raid' as const, opts: { manpower: 1, repeat: false, isPublic: false, priority: false, wait: false, preferredHoodId: null } };
    expect(orderStaffing(s.w, s.team, order).chosen.map(p => p.id)).toEqual([lieutenant.id]);
    const crewIds = new Set([s.team.lieutenantId, ...s.team.memberIds]);
    expect([...loadout]).toEqual([...allocateWeapons(s.w)].filter(([id]) => crewIds.has(id)));
  });

  it('does not mistake explosives in the crew inventory for firearms', () => {
    const s = fixture(); s.team.weapons.explosives = 10;
    expect(crewHasFirearm(s.team)).toBe(false);
    s.team.weapons.pistol = 1;
    expect(crewHasFirearm(s.team)).toBe(true);
  });

  it('dispatches a brawler for an unarmed raid and a marksman when a gun is available', () => {
    const s = fixture(), lieutenant = s.w.people[s.team.lieutenantId];
    s.actor.skills = skills({ firearms: 5 });
    lieutenant.skills = skills({ organization: 5, intelligence: 5, fists: 4 });
    lieutenant.buildingId = null; lieutenant.status = 'active';
    const order = { type: 'raid' as const, opts: { manpower: 1, repeat: false, isPublic: false, priority: false, wait: false, preferredHoodId: null } };
    expect(orderStaffing(s.w, s.team, order).chosen.map(p => p.id)).toEqual([lieutenant.id]);
    s.team.weapons.pistol = 1;
    expect(orderStaffing(s.w, s.team, order).chosen.map(p => p.id)).toEqual([s.actor.id]);
  });
});

describe('executed orders use the advertised skills', () => {
  it('only benefits from firearm expertise on a raid when the actor actually has a gun', () => {
    const base = attemptedChance('raid', {}).probability;
    expect(attemptedChance('raid', { firearms: 5 }).probability).toBe(base);
    expect(attemptedChance('raid', { fists: 5 }).probability).toBeGreaterThan(base);
    expect(attemptedChance('raid', { firearms: 5 }, true).probability).toBeGreaterThan(base);
    expect(attemptedChance('raid', { stealth: 5, intelligence: 5 }).probability).toBe(base);
  });

  it.each([
    ['smashUp', 'fists'], ['assault', 'fists'], ['torch', 'arson'], ['bomb', 'explosives'],
  ] as const)('%s rewards its task skill rather than unrelated stealth or intelligence', (type, skill) => {
    const base = attemptedChance(type, {}).probability;
    expect(attemptedChance(type, { [skill]: 5 }).probability).toBeGreaterThan(base);
    expect(attemptedChance(type, { stealth: 5, intelligence: 5 }).probability).toBe(base);
  });

  it.each(['intimidate', 'kidnap'] as const)('%s uses intimidation together with the appropriate physical skill', type => {
    const base = attemptedChance(type, {}).probability;
    expect(attemptedChance(type, { intimidation: 5 }).probability).toBeGreaterThan(base);
    expect(attemptedChance(type, { fists: 5 }).probability).toBeGreaterThan(base);
    expect(attemptedChance(type, { firearms: 5 }).probability).toBe(base);
    if (type === 'kidnap') expect(attemptedChance(type, { firearms: 5 }, true).probability).toBeGreaterThan(base);
  });

  it.each(['extort', 'intimidate'] as const)('records a refusing owner as met, even though %s failed', type => {
    const s = fixture(); s.site.knowledge[s.gang.id] = 1;
    const order = prepare(s, type);
    vi.spyOn(s.sim.rng, 'chance').mockReturnValue(false);
    tickOrders(s.w, s.sim.rng, 1);
    expect(order.state).toBe('failed');
    expect(s.site.knowledge[s.gang.id]).toBe(2);
    expect(order.refusals?.[0].buildingId).toBe(s.site.id);
  });

  it('uses task expertise for work duration and its planning estimate', () => {
    const s = fixture(), order = prepare(s, 'raid');
    const work = () => {
      order.state = 'travelling'; order.workLeft = 0;
      s.actor.dest = null; s.actor.path = []; s.actor.pos = buildingDoor(s.w, s.site);
      tickOrders(s.w, s.sim.rng, .01, allocateWeapons(s.w));
      expect(order.state).toBe('executing');
      return order.workLeft;
    };
    const lowEstimate = estimateMinutes(s.w, s.team, order), lowWork = work();
    s.actor.skills.fists = 5;
    // The preferred actor is already assigned, so estimate in planning mode.
    s.w.phase = 'planning';
    expect(estimateMinutes(s.w, s.team, order)).toBeLessThan(lowEstimate);
    s.w.phase = 'week';
    expect(work()).toBeLessThan(lowWork);
  });
});
