import { describe, expect, it } from 'vitest';
import { useGame } from '../src/app/store';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder } from '../src/sim/api';
import { tickOrders } from '../src/sim/execution';
import { Sim } from '../src/sim/sim';

describe('live Organizer', () => {
  it('opens and closes independently of the working-week clock', () => {
    useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const state = useGame.getState();
    state.sim!.launchWeek();

    expect(state.sim!.world.phase).toBe('week');
    expect(state.organizerOpen).toBe(false);
    state.setOrganizerOpen(true);
    expect(useGame.getState().organizerOpen).toBe(true);
    expect(useGame.getState().sim!.world.phase).toBe('week');
    state.setOrganizerOpen(false);
    expect(useGame.getState().organizerOpen).toBe(false);
  });

  it('opens the actual live city plan when toggling Book, then returns to the city', () => {
    useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    useGame.getState().sim!.launchWeek();
    useGame.getState().setWeekPlanOpen(false);
    useGame.getState().toggleLiveBook();
    expect(useGame.getState().organizerOpen).toBe(true);
    expect(useGame.getState().weekPlanOpen).toBe(true);
    expect(useGame.getState().organizerCollapsed).toBe(false);
    useGame.getState().toggleLiveBook();
    expect(useGame.getState().organizerOpen).toBe(false);
    expect(useGame.getState().weekPlanOpen).toBe(false);
  });

  it('opens the live city plan for crew and specialist job cards', () => {
    useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const sim = useGame.getState().sim!;
    sim.launchWeek();
    useGame.getState().beginOrder('goTo', sim.playerGang.teamIds[0]);
    expect(useGame.getState().weekPlanOpen).toBe(true);
    expect(useGame.getState().organizerOpen).toBe(true);
    useGame.getState().cancelJobCard();
    useGame.getState().setWeekPlanOpen(false);
    useGame.getState().beginSpecialistOrder('employPolice', null);
    expect(useGame.getState().weekPlanOpen).toBe(true);
    expect(useGame.getState().organizerOpen).toBe(true);
  });

  it('dispatches an order added while the week is already running', () => {
    const sim = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    sim.launchWeek();

    const result = issueOrder(w, gang.id, { teamId: team.id, type: 'goTo', pos: w.blocks[0].center });
    expect(result.ok).toBe(true);
    const order = w.orders[team.orderIds.at(-1)!];
    expect(order.state).toBe('queued');

    tickOrders(w, sim.rng, 1);
    expect(order.state).toBe('travelling');
    expect(order.assignedIds).not.toHaveLength(0);
  });
});
