import { afterEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { issueStreetOrder } from '../src/sim/api';
import { buildingMapIntel } from '../src/sim/mapIntel';
import { buildingDoor } from '../src/sim/world';
import { CELL } from '../src/sim/constants';
import { act, useGame } from '../src/app/store';
import { availableDispatchIds, buildingDispatchRoster, validateDispatchSelection } from '../src/ui/buildingDispatchSelection';

afterEach(() => useGame.setState({sim: null, selectedBuildingId: null, selectedPersonIds: [], selectedPersonId: null}));

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), seed: 409, citySize: 10 });
  sim.launchWeek();
  const w = sim.world, gang = sim.playerGang;
  const team = w.teams[gang.teamIds[0]];
  const crew = [team.lieutenantId, ...team.memberIds].map(id => w.people[id]).filter(Boolean);
  const active = crew.filter(p => p.status === 'active');
  const known = Object.values(w.buildings).filter(b => buildingMapIntel(b, gang.id).siteKnown);
  const building = known.find(b => {
    const pt = buildingDoor(w,b);
    const x = Math.floor(pt.x/CELL), y=Math.floor(pt.y/CELL);
    return pt.x>=0 && pt.y>=0 && w.blocks.some(z => z.gx === x && z.gy === y);
  });
  if (!building || !active.length) throw new Error('The seeded city needs a known building and a working hood');
  return {sim,w,gang,team,crew,active,building};
}

describe('building-to-hood dispatch', () => {
  it('shows a selectable crew and prevents a forged rival or unknown crew selection', () => {
    const s=fixture();
    const roster=buildingDispatchRoster(s.w,s.gang.id,`crew:${s.team.id}`,[]);
    expect(roster.map(p=>p.id)).toEqual(s.crew.map(p=>p.id));
    expect(buildingDispatchRoster(s.w,s.gang.id,'crew:-99',[])).toEqual([]);
    expect(buildingDispatchRoster(s.w,s.gang.id,'pool',[]).every(p=>p.gangId===s.gang.id)).toBe(true);
    const rival=Object.values(s.w.people).find(p=>p.gangId!==s.gang.id)!;
    expect(buildingDispatchRoster(s.w,s.gang.id,'selected',[s.active[0].id,rival.id]).map(p=>p.id)).toEqual([s.active[0].id]);
  });

  it('filters unavailable people and rejects a selection that became stale', () => {
    const s=fixture(),p=s.active[0];
    const ids=availableDispatchIds(buildingDispatchRoster(s.w,s.gang.id,'selected',[p.id]));
    expect(ids).toEqual([p.id]);
    expect(validateDispatchSelection(s.w,s.gang.id,'selected',[p.id],[p.id,p.id])).toEqual({valid:true,ids:[p.id]});
    p.status='jailed';
    expect(availableDispatchIds(buildingDispatchRoster(s.w,s.gang.id,'selected',[p.id]))).toEqual([]);
    expect(validateDispatchSelection(s.w,s.gang.id,'selected',[p.id],[p.id]).valid).toBe(false);
    expect(validateDispatchSelection(s.w,s.gang.id,'selected',[p.id],[]).valid).toBe(false);
  });

  it('sends exactly the selected hood to the real building entrance, not the entire crew', () => {
    const s=fixture(), actor=s.active[0], others=s.active.slice(1);
    actor.orderId=null;actor.streetOrder=null;
    for (const other of others){other.orderId=null;other.streetOrder=null;}
    const destination=buildingDoor(s.w,s.building);
    const result=issueStreetOrder(s.w,s.gang.id,[actor.id],'goTo',null,destination);
    expect(result.ok).toBe(true);
    expect(s.w.people[actor.id].streetOrder?.type).toBe('goTo');
    expect(s.w.people[actor.id].streetOrder?.pos).toEqual(destination);
    expect(others.every(p => p.streetOrder === null)).toBe(true);
  });

  it('dispatches a crew on Guard and keeps the site open while highlighting its members', () => {
    const s=fixture();
    const actors=s.active.slice(0,2);
    for(const p of actors){p.orderId=null;p.streetOrder=null;}
    useGame.setState({sim:s.sim,selectedBuildingId:s.building.id,selectedPersonIds:[]});
    const result=act(sim=>issueStreetOrder(sim.world,s.gang.id,actors.map(p=>p.id),'guard',null,buildingDoor(sim.world,s.building)));
    expect(result?.ok).toBe(true);
    useGame.getState().selectPeopleForBuilding(actors.map(p=>p.id));
    expect(useGame.getState().selectedBuildingId).toBe(s.building.id);
    expect(useGame.getState().selectedPersonIds).toEqual(actors.map(p=>p.id));
    for(const p of actors)expect(p.streetOrder?.type).toBe('guard');
  });

  it('keeps ordinary Hoods selection semantics when the player selects elsewhere', () => {
    const s=fixture(), person=s.active[0];
    useGame.setState({sim:s.sim,selectedBuildingId:s.building.id,selectedPersonIds:[]});
    useGame.getState().selectPeople([person.id]);
    expect(useGame.getState().selectedBuildingId).toBeNull();
  });
});
