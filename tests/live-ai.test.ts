import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { cancelOrder } from '../src/sim/api';
import { LIVE_AI_INTERVAL, liveAiDue, planIdleCrews } from '../src/sim/ai';
import { MINUTES_PER_SECOND } from '../src/sim/constants';
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
    planIdleCrews(w, busyGang);
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
});
