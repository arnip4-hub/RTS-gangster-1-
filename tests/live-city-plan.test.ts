import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { useGame } from '../src/app/store';
import { VIEW_ZOOM } from '../src/render/viewModes';
import { handleMapHit } from '../src/ui/mapClick';

function liveCity() {
  useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  const sim = useGame.getState().sim!;
  sim.launchWeek();
  return sim;
}

describe('live overhead City Plan', () => {
  it('accepts a live move order from the overhead map without closing it', () => {
    const sim = liveCity();
    const actorId = sim.world.teams[sim.playerGang.teamIds[0]].lieutenantId;
    const destination = sim.world.blocks[0].center;
    const state = useGame.getState();
    state.setWeekPlanOpen(true);
    state.setPickMode({ kind: 'streetOrder', orderType: 'goTo', personIds: [actorId] });

    handleMapHit({ blockId: 0, buildingId: null, personId: null, point: destination }, { fromPlan: true });

    expect(sim.world.people[actorId].streetOrder?.pos).toEqual(destination);
    expect(useGame.getState().weekPlanOpen).toBe(true);
    expect(useGame.getState().pickMode).toBeNull();
  });

  it('switches to Rooftop to refine a planned point order', () => {
    const sim = liveCity();
    const destination = sim.world.blocks[0].center;
    const state = useGame.getState();
    state.setWeekPlanOpen(true);
    state.beginOrder('goTo', sim.playerGang.teamIds[0]);

    handleMapHit({ blockId: 0, buildingId: null, personId: null, point: destination }, { fromPlan: true });

    expect(useGame.getState().jobCard?.pos).toEqual(destination);
    expect(useGame.getState().weekPlanOpen).toBe(false);
    expect(useGame.getState().cameraRequest).toEqual({ ...destination, zoom: VIEW_ZOOM.roof });
  });

  it('sends a selected crew into an owned building from the overhead map', () => {
    const sim = liveCity(), w = sim.world;
    const crew = w.teams[sim.playerGang.teamIds[0]];
    const ids = [crew.lieutenantId, ...crew.memberIds];
    const site = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === sim.playerGang.id)!;
    const state = useGame.getState();
    state.setWeekPlanOpen(true);
    state.setPickMode({ kind: 'streetOrder', orderType: 'enterBuilding', personIds: ids });
    handleMapHit({ blockId: site.blockId, buildingId: site.id, personId: null, point: w.lots[site.lotId].center }, { fromPlan: true });
    for (const id of ids) expect(w.people[id].streetOrder).toMatchObject({ type: 'enterBuilding', buildingId: site.id });
    expect(useGame.getState().weekPlanOpen).toBe(true);
    expect(useGame.getState().pickMode).toBeNull();
  });
});
