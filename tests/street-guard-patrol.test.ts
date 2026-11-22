import { afterEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { clearStreetOrder, issueStreetOrder } from '../src/sim/api';
import { clearDestination } from '../src/sim/movement';
import { tickStreetOrders } from '../src/sim/systems/street';
import { act, useGame } from '../src/app/store';
import { handleMapHit } from '../src/ui/mapClick';
import type { WorldState } from '../src/sim/types';

afterEach(() => useGame.setState({sim:null,pickMode:null}));

function fixture() {
  const sim=new Sim({...defaultGameOptions(),seed:808,citySize:10});
  sim.launchWeek();
  const w=sim.world,gang=sim.playerGang,team=w.teams[gang.teamIds[0]],p=w.people[team.lieutenantId];
  p.status='active';p.pos={x:100,y:100};p.dest=null;p.path=[];
  p.orderId=null;p.streetOrder=null;p.buildingId=null;p.inVehicle=false;
  return {sim,w,gang,p};
}

describe('persistent live Guard and Patrol',()=>{
  it('holds a designated position after arrival and can be cancelled',()=>{
    const s=fixture(),point={x:120,y:100};
    expect(issueStreetOrder(s.w,s.gang.id,[s.p.id],'guard',null,point).ok).toBe(true);
    expect(s.p.streetOrder?.type).toBe('guard');
    expect(s.p.dest).toBeTruthy();
    s.p.pos={...point};clearDestination(s.p);
    tickStreetOrders(s.w,s.sim.rng,1);
    expect(s.p.streetOrder?.type).toBe('guard');
    expect(s.p.dest).toBeNull();
    s.p.pos={x:100,y:100};
    tickStreetOrders(s.w,s.sim.rng,1);
    expect(s.p.dest).not.toBeNull();
    clearStreetOrder(s.w,[s.p.id]);
    expect(s.p.streetOrder).toBeNull();
    expect(s.p.dest).toBeNull();
  });

  it('patrols back and forth along a saved two-point route',()=>{
    const s=fixture(),point={x:140,y:100};
    const start={...s.p.pos};
    expect(issueStreetOrder(s.w,s.gang.id,[s.p.id],'patrol',null,point).ok).toBe(true);
    expect(s.p.streetOrder?.patrolOrigin).toEqual(start);
    expect(s.p.streetOrder?.patrolReturning).toBe(false);
    // Saved patrol state is part of the world and survives a mid-week reload.
    const restored=Sim.fromSave(JSON.parse(JSON.stringify(s.w)) as WorldState);
    expect(restored.world.people[s.p.id].streetOrder).toEqual(s.p.streetOrder);
    s.p.pos={...point};clearDestination(s.p);
    tickStreetOrders(s.w,s.sim.rng,1);
    expect(s.p.streetOrder?.patrolReturning).toBe(true);
    expect(s.p.dest).not.toBeNull();
    s.p.pos={...start};clearDestination(s.p);
    tickStreetOrders(s.w,s.sim.rng,1);
    expect(s.p.streetOrder?.patrolReturning).toBe(false);
    expect(s.p.dest).not.toBeNull();
  });

  it('uses the existing map click workflow and rejects invalid targets',()=>{
    const s=fixture();
    useGame.setState({sim:s.sim,screen:'game',paused:true,
      pickMode:{kind:'streetOrder',orderType:'patrol',personIds:[s.p.id]}});
    handleMapHit({personId:null,buildingId:null,blockId:0,point:{x:130,y:100}});
    expect(s.p.streetOrder?.type).toBe('patrol');
    expect(useGame.getState().pickMode).toBeNull();
    expect(issueStreetOrder(s.w,s.gang.id,[s.p.id],'guard',null,{x:-1,y:-1}).ok).toBe(false);
    expect(issueStreetOrder(s.w,s.gang.id,[s.p.id],'patrol',s.p.id,null).ok).toBe(false);
  });
});
