import { describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { selectableOrderPerson } from '../src/app/orderSelection';
import { issueOrder } from '../src/sim/api';
import { campaignMinute } from '../src/sim/calendar';
import { demandRansom, policeRescueArrival, pressureOfficial, ransomQuote, tickCaptivity } from '../src/sim/captivity';
import { bribePrice } from '../src/sim/officials';
import { Sim } from '../src/sim/sim';
import { buildingDoor } from '../src/sim/world';

const make = (seed=406) => new Sim({...defaultGameOptions(),continuousTime:true,seed,citySize:10,startMoney:100000,startHoods:8});

describe('civilian kidnapping and official families',()=>{
  it('gives existing citizens stable, named official ties and permits civilian targets',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const relatives=Object.values(w.people).filter(p=>p.familyOfId!=null);
    expect(relatives.length).toBeGreaterThan(5);
    const relative=relatives[0],official=w.people[relative.familyOfId!];
    expect(relative.role).toBe('citizen');
    expect(relative.name.split(' ').at(-1)).toBe(official.name.split(' ').at(-1));
    expect(relative.homeBuildingId).toBe(official.homeBuildingId);
    expect(selectableOrderPerson(w,g.id,'kidnap',relative)).toBe(true);
    const citizen=Object.values(w.people).find(p=>p.role==='citizen'&&p.familyOfId==null)!;
    expect(selectableOrderPerson(w,g.id,'kidnap',citizen)).toBe(true);
    const restored=Sim.fromSave(structuredClone(w));
    expect(restored.world.people[relative.id].familyOfId).toBe(official.id);
  });

  it('takes a civilian along on the actual crew journey before custody',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang,team=w.teams[g.teamIds[0]];
    const victim=Object.values(w.people).find(p=>p.role==='citizen'&&p.familyOfId==null)!;
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    victim.pos=buildingDoor(w,office);victim.buildingId=null;victim.dest=null;victim.path=[];
    for(const id of [team.lieutenantId,...team.memberIds]) for(const key of Object.keys(w.people[id].skills) as (keyof typeof victim.skills)[])
      w.people[id].skills[key]=5;
    expect(issueOrder(w,g.id,{teamId:team.id,type:'kidnap',personId:victim.id,opts:{manpower:1,priority:true}}).ok).toBe(true);
    const order=w.orders[team.orderIds.at(-1)!];
    sim.launchWeek();
    for(let i=0;i<900 && !order.kidnapDelivery && order.state!=='failed';i++){
      if(order.state==='executing')order.workLeft=1;
      sim.advance(1,1);
    }
    expect(order.kidnapDelivery).toBeDefined();
    expect(victim.captivity?.stage).toBe('transport');
    expect(g.prisonerIds).not.toContain(victim.id);
    expect(()=>Sim.fromSave(structuredClone(w))).not.toThrow();
    for(let i=0;i<500 && victim.captivity?.stage!=='held';i++){
      if(order.state==='executing')order.workLeft=1;
      sim.advance(1,1);
    }
    expect(victim.captivity?.stage).toBe('held');
    expect(g.prisonerIds).toContain(victim.id);
  });

  it('reconciles a paid ransom and makes coercion uncertain and temporary',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const victim=Object.values(w.people).find(p=>p.familyOfId!=null)!;
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    w.phase='week';w.minute=600;
    victim.status='kidnapped';victim.capturedBy=g.id;victim.householdCash=15000;
    victim.captivity={stage:'held',officeId:office.id,startedAt:campaignMinute(w),reported:true,
      discovered:false,searchProgress:0,nextEscapeAt:campaignMinute(w)+360};
    g.prisonerIds.push(victim.id);
    const official=w.people[victim.familyOfId!],before=bribePrice(w,official,g.id);
    vi.spyOn(sim.rng,'chance').mockReturnValue(true);
    expect(pressureOfficial(w,sim.rng,g.id,victim.id).ok).toBe(true);
    expect(bribePrice(w,official,g.id)).toBeLessThan(before);
    const ransom=ransomQuote(w,victim),cash=g.cash;
    expect(demandRansom(w,sim.rng,g.id,victim.id,ransom).ok).toBe(true);
    expect(g.cash).toBe(cash+ransom);
    expect(victim.status).toBe('active');
    expect(g.prisonerIds).not.toContain(victim.id);
    expect(()=>Sim.fromSave(structuredClone(w))).not.toThrow();
  });

  it('requires clues before a police car is sent to a safe house',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const victim=Object.values(w.people).find(p=>p.familyOfId!=null)!;
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    w.phase='week';w.minute=600;
    victim.status='kidnapped';victim.capturedBy=g.id;
    victim.captivity={stage:'held',officeId:office.id,startedAt:0,reported:true,
      discovered:false,searchProgress:10,nextEscapeAt:1000};
    g.prisonerIds.push(victim.id);
    tickCaptivity(w,sim.rng);
    expect(victim.captivity.discovered).toBe(false);
    expect(w.policeIds.some(id=>w.people[id].emergencyResponse?.rescueCaptiveId===victim.id)).toBe(false);
    victim.captivity.searchProgress=99;
    w.minute=660;
    tickCaptivity(w,sim.rng);
    expect(victim.captivity.discovered).toBe(true);
    expect(w.policeIds.some(id=>w.people[id].emergencyResponse?.rescueCaptiveId===victim.id)).toBe(true);
    vi.spyOn(sim.rng,'chance').mockReturnValue(true);
    policeRescueArrival(w,sim.rng,victim.id);
    expect(victim.status).toBe('active');
    expect(g.prisonerIds).not.toContain(victim.id);
  });

  it('keeps the hostage address hidden from rivals until their own search finds it',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const rival=Object.values(w.gangs).find(other=>!other.isPlayer)!,
      victim=Object.values(w.people).find(p=>p.gangId===rival.id && p.role==='hood')!;
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    w.phase='week';w.minute=600;
    office.knowledge[rival.id]=0;
    victim.status='kidnapped';victim.capturedBy=g.id;
    victim.captivity={stage:'held',officeId:office.id,startedAt:600,reported:false,
      discovered:false,searchProgress:0,rivalSearchProgress:0,nextEscapeAt:1000};
    g.prisonerIds.push(victim.id);
    tickCaptivity(w,sim.rng);
    expect(victim.captivity.rivalDiscovered).toBeUndefined();
    expect(office.knowledge[rival.id]).toBe(0);
    victim.captivity.rivalSearchProgress=99;
    w.minute=660;
    tickCaptivity(w,sim.rng);
    expect(victim.captivity.rivalDiscovered).toBe(true);
    expect(office.knowledge[rival.id]).toBe(3);
    expect(victim.captivity.discovered).toBe(false);
  });
});
