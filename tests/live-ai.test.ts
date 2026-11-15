import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { cancelOrder } from '../src/sim/api';
import { LIVE_AI_INTERVAL, liveAiDue, planIdleCrews } from '../src/sim/ai';
import { campaignMinute } from '../src/sim/calendar';
import { MINUTES_PER_SECOND } from '../src/sim/constants';
import { tickOrders } from '../src/sim/execution';
import { Sim } from '../src/sim/sim';
import type { Team, WorldState } from '../src/sim/types';

const city = () => {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10 });
  sim.launchWeek();
  return sim;
};

function freeCrew(w: WorldState, team: Team): void {
  for (const id of [...team.orderIds]) cancelOrder(w, id);
  team.timeUsed = 2200; // Finished work must not block a new live job.
  for (const id of [team.lieutenantId, ...team.memberIds]) {
    const person = w.people[id];
    person.orderId = null;
    person.streetOrder = null;
    delete person.resumeOrderId;
  }
}

function reportedAttack(w: WorldState, attacker: number, perpetrator: number, buildingId: number): void {
  w.crimes.push({ id: w.sequences.crime++, week: w.week, gangId: attacker, perpetratorId: perpetrator,
    kind: 'torch', buildingId, victimId: null, witnesses: [], arrestRisk: 0.5, reported: true });
}

describe('live rival crew planning', () => {
  it('starts continuous play with at most one job per rival crew', () => {
    const sim = city();
    const crews = Object.values(sim.world.teams).filter(team => !sim.world.gangs[team.gangId].isPlayer);
    expect(crews.length).toBeGreaterThan(0);
    expect(crews.every(team => team.orderIds.length <= 1)).toBe(true);
  });

  it('gives an idle crew one job without changing another crew in motion', () => {
    const sim = city(), w = sim.world;
    const rivals = Object.values(w.gangs).filter(g => !g.isPlayer);
    const idleGang = rivals[0], busyGang = rivals[1];
    const idle = w.teams[idleGang.teamIds[0]], busy = w.teams[busyGang.teamIds[0]];
    const busyOrders = busy.orderIds.map(id => structuredClone(w.orders[id]));
    freeCrew(w, idle);

    planIdleCrews(w, idleGang);

    expect(idle.orderIds).toHaveLength(1);
    expect(w.orders[idle.orderIds[0]].state).toBe('queued');
    expect(idle.timeUsed).toBeLessThan(2200);
    const busySite = Object.values(w.buildings).find(b => b.ownerGangId === busyGang.id && b.state === 'trading' && !b.isHQ)!;
    busyGang.aiGoal = { kind: 'expand', chosenAt: campaignMinute(w) - 60, until: campaignMinute(w) + 300 };
    reportedAttack(w, sim.playerGang.id, sim.playerGang.bossId, busySite.id);
    planIdleCrews(w, busyGang);
    expect(busyGang.aiGoal.kind).toBe('defend');
    expect(busy.orderIds.map(id => w.orders[id])).toEqual(busyOrders);
    planIdleCrews(w, idleGang);
    expect(idle.orderIds).toHaveLength(1);
  });

  it('runs on the game clock, remains deterministic across a save, and leaves classic play alone', () => {
    const sim = city(), w = sim.world;
    const gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const team = w.teams[gang.teamIds[0]];
    freeCrew(w, team);
    const due = Array.from({ length: LIVE_AI_INTERVAL }, (_, i) => i + 1).find(minute => liveAiDue(minute, gang.id))!;
    w.minute = due - 1;
    const restored = Sim.fromSave(structuredClone(w));

    sim.advance(1 / MINUTES_PER_SECOND, 1);
    restored.advance(1 / MINUTES_PER_SECOND, 1);

    expect(team.orderIds).toHaveLength(1);
    expect(JSON.stringify(restored.world)).toBe(JSON.stringify(w));
    const classic = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    classic.launchWeek();
    const oldGang = Object.values(classic.world.gangs).find(g => !g.isPlayer)!;
    const oldTeam = classic.world.teams[oldGang.teamIds[0]];
    freeCrew(classic.world, oldTeam);
    classic.world.minute = due - 1;
    classic.advance(1 / MINUTES_PER_SECOND, 1);
    expect(oldTeam.orderIds).toHaveLength(0);
  });

  it('scouts unknown nearby fronts before choosing them for expansion', () => {
    const sim = city(), w = sim.world;
    const gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const team = w.teams[gang.teamIds[0]];
    freeCrew(w, team);
    gang.aiGoal = { kind: 'expand', chosenAt: campaignMinute(w), until: campaignMinute(w) + 360 };
    for (const b of Object.values(w.buildings)) {
      if (b.ownerGangId !== gang.id && b.protection?.gangId !== gang.id) b.knowledge[gang.id] = 0;
      if (b.protection?.gangId === gang.id) b.protection.collectedWeek = w.week;
    }

    planIdleCrews(w, gang);

    const exploration = w.orders[team.orderIds.at(-1)!];
    expect(exploration?.type).toBe('explore');
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();

    const learned = exploration.targetBuildingIds.map(id => w.buildings[id]).find(b =>
      b.state === 'trading' && b.ownerGangId == null && b.protection == null);
    expect(learned).toBeDefined();
    learned!.knowledge[gang.id] = 3;
    freeCrew(w, team);
    planIdleCrews(w, gang);
    expect(w.orders[team.orderIds.at(-1)!]?.type).toBe('extort');
  });

  it('responds to a reported attack with a temporary guard and then releases the crew', () => {
    const sim = city(), w = sim.world;
    const gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const team = w.teams[gang.teamIds[0]];
    const site = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.state === 'trading' && !b.isHQ)!;
    freeCrew(w, team);
    gang.aiGoal = { kind: 'expand', chosenAt: campaignMinute(w) - 60, until: campaignMinute(w) + 300 };
    reportedAttack(w, sim.playerGang.id, sim.playerGang.bossId, site.id);

    planIdleCrews(w, gang);

    expect(gang.aiGoal.kind).toBe('defend');
    const order = w.orders[team.orderIds.at(-1)!];
    expect(order.type).toBe('guardBusiness');
    expect(order.targetBuildingIds).toEqual([site.id]);
    expect(order.aiGuardUntil).toBe(campaignMinute(w) + 360);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();

    w.minute = order.aiGuardUntil!;
    tickOrders(w, sim.rng, 1);
    expect(order.state).toBe('done');
  });

  it('patrols a threatened protection site when it owns no building in that block', () => {
    const sim = city(), w = sim.world;
    const gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const team = w.teams[gang.teamIds[0]];
    const home = w.blocks[Object.values(w.buildings).find(b => b.ownerGangId === gang.id)!.blockId];
    const ownedBlocks = new Set(Object.values(w.buildings).filter(b => b.ownerGangId === gang.id).map(b => b.blockId));
    const site = Object.values(w.buildings).find(b => b.state === 'trading' && b.cls !== 'empty' &&
      b.ownerGangId == null && !ownedBlocks.has(b.blockId) &&
      Math.abs(w.blocks[b.blockId].gx - home.gx) + Math.abs(w.blocks[b.blockId].gy - home.gy) <= 2)!;
    site.protection = { gangId: gang.id, weekly: 100, base: 100, refusing: false, grievance: 0 };
    freeCrew(w, team);
    gang.aiGoal = { kind: 'expand', chosenAt: campaignMinute(w) - 60, until: campaignMinute(w) + 300 };
    reportedAttack(w, sim.playerGang.id, sim.playerGang.bossId, site.id);

    planIdleCrews(w, gang);

    expect(gang.aiGoal.kind).toBe('defend');
    const order = w.orders[team.orderIds.at(-1)!];
    expect(order.type).toBe('patrol');
    expect(order.targetBlockIds).toEqual([site.blockId]);
    expect(order.aiGuardUntil).toBe(campaignMinute(w) + 360);
  });

  it('retaliates only when the attacker and a rival site are known', () => {
    const sim = city(), w = sim.world;
    const gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const team = w.teams[gang.teamIds[0]];
    const own = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.state === 'trading' && !b.isHQ)!;
    const homeBlock = w.blocks[own.blockId];
    const rivalSite = Object.values(w.buildings).find(b => b.ownerGangId == null && b.protection == null &&
      b.state === 'trading' && b.cls !== 'empty' &&
      Math.abs(w.blocks[b.blockId].gx - homeBlock.gx) + Math.abs(w.blocks[b.blockId].gy - homeBlock.gy) <= 2)!;
    rivalSite.ownerGangId = sim.playerGang.id;
    rivalSite.knowledge[gang.id] = 3;
    gang.personality = 'aggressive';
    gang.knownPeople.push(sim.playerGang.bossId);
    freeCrew(w, team);
    gang.aiGoal = { kind: 'expand', chosenAt: campaignMinute(w) - 60, until: campaignMinute(w) + 300 };
    reportedAttack(w, sim.playerGang.id, sim.playerGang.bossId, own.id);

    planIdleCrews(w, gang);

    expect(gang.aiGoal.kind).toBe('retaliate');
    expect(w.orders[team.orderIds.at(-1)!].type).toBe('smashUp');
    expect(gang.aiGoal.acted).toBe(true);
  });

  it('does not react to an unreported attack with no visible damage', () => {
    const sim = city(), w = sim.world;
    const gang = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const team = w.teams[gang.teamIds[0]];
    const site = Object.values(w.buildings).find(b => b.ownerGangId === gang.id && b.state === 'trading' && !b.isHQ)!;
    freeCrew(w, team);
    gang.aiGoal = { kind: 'expand', chosenAt: campaignMinute(w) - 60, until: campaignMinute(w) + 300 };
    reportedAttack(w, sim.playerGang.id, sim.playerGang.bossId, site.id);
    w.crimes.at(-1)!.reported = false;

    planIdleCrews(w, gang);

    expect(gang.aiGoal.kind).toBe('expand');
    expect(gang.aiLastThreatId).toBeUndefined();
  });
});
