import { describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { selectableOrderPerson } from '../src/app/orderSelection';
import { issueOrder, killPrisoner } from '../src/sim/api';
import { campaignMinute } from '../src/sim/calendar';
import { demandRansom, policeRescueArrival, pressureOfficial, pressureOwner, ransomQuote, refusedOwnerSites, tickCaptivity } from '../src/sim/captivity';
import { bribePrice } from '../src/sim/officials';
import { ensureOwnerRelative } from '../src/sim/officialFamilies';
import { personProfile } from '../src/sim/personProfile';
import { Sim } from '../src/sim/sim';
import { buildingDoor } from '../src/sim/world';
import type { CrimeRecord } from '../src/sim/types';
import { isValidAreaTarget } from '../src/sim/execution';

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

  it('shows consistent household details for every character and linked spouses',()=>{
    const sim=make(),w=sim.world;
    const relative=Object.values(w.people).find(p=>p.familyRelation==='spouse')!;
    const official=w.people[relative.familyOfId!];
    const a=personProfile(w,relative),b=personProfile(w,official);
    expect(a.spouse).toBe(official.name);
    expect(b.spouse).toBe(relative.name);
    expect(a.children).toBe(b.children);
    expect(Math.abs(a.age-b.age)).toBeLessThanOrEqual(6);
    const restored=Sim.fromSave(structuredClone(w));
    expect(personProfile(restored.world,relative)).toEqual(a);
    for(const p of Object.values(w.people)) {
      const profile=personProfile(w,p);
      expect(profile.age).toBeGreaterThanOrEqual(18);
      expect(profile.householdSize).toBeGreaterThanOrEqual(1);
    }
  });

  it('adds a named owner relative after a refused extortion order',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang,team=w.teams[g.teamIds[0]];
    const site=Object.values(w.buildings).filter(b=>b.ownerPersonId!=null && b.state==='trading' &&
      isValidAreaTarget(w,g.id,'extort',b)).sort((a,b)=>
        Math.hypot(w.lots[a.lotId].center.x-w.people[team.lieutenantId].pos.x,w.lots[a.lotId].center.y-w.people[team.lieutenantId].pos.y)-
        Math.hypot(w.lots[b.lotId].center.x-w.people[team.lieutenantId].pos.x,w.lots[b.lotId].center.y-w.people[team.lieutenantId].pos.y))[0];
    expect(site).toBeDefined();
    vi.spyOn(sim.rng,'chance').mockReturnValue(false);
    expect(issueOrder(w,g.id,{teamId:team.id,type:'extort',buildingIds:[site.id],opts:{manpower:1,priority:true}}).ok).toBe(true);
    const order=w.orders[team.orderIds.at(-1)!];
    sim.launchWeek();
    for(let i=0;i<1800 && !site.extortRefusedBy?.includes(g.id) && order.state!=='failed';i++) {
      if(order.state==='executing')order.workLeft=1;
      sim.advance(1,1);
    }
    expect(site.extortRefusedBy).toContain(g.id);
    const relative=Object.values(w.people).find(p=>p.familyOfId===site.ownerPersonId)!;
    expect(relative.role).toBe('citizen');
    expect(selectableOrderPerson(w,g.id,'kidnap',relative)).toBe(true);
    if (relative.familyRelation==='spouse') expect(personProfile(w,w.people[site.ownerPersonId!]).spouse).toBe(relative.name);
    expect(Sim.fromSave(structuredClone(w)).world.people[relative.id].familyOfId).toBe(site.ownerPersonId);
  });

  it('lets a held owner relative press one refused business into protection',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const site=Object.values(w.buildings).find(b=>b.ownerPersonId!=null && b.state==='trading' && isValidAreaTarget(w,g.id,'extort',b))!;
    const owner=w.people[site.ownerPersonId!],relative=ensureOwnerRelative(w,sim.rng,owner)!;
    site.extortRefusedBy=[g.id];
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    w.phase='week';w.minute=600;
    relative.status='kidnapped';relative.capturedBy=g.id;
    relative.captivity={stage:'held',officeId:office.id,startedAt:0,reported:false,
      discovered:false,searchProgress:0,nextEscapeAt:1000};
    g.prisonerIds.push(relative.id);
    expect(refusedOwnerSites(w,owner.id,g.id)).toContain(site);
    vi.spyOn(sim.rng,'chance').mockReturnValue(true);
    expect(pressureOwner(w,sim.rng,g.id,relative.id).ok).toBe(true);
    expect(site.protection?.gangId).toBe(g.id);
    expect(site.extortRefusedBy).toBeUndefined();
    expect(pressureOwner(w,sim.rng,g.id,relative.id).ok).toBe(false);
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

  it('allows an ordinary civilian captive to be executed and raises police evidence',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const victim=Object.values(w.people).find(p=>p.role==='citizen'&&p.familyOfId==null)!;
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    victim.status='kidnapped';victim.capturedBy=g.id;
    victim.captivity={stage:'held',officeId:office.id,startedAt:0,reported:true,
      discovered:false,searchProgress:0,nextEscapeAt:360};
    g.prisonerIds.push(victim.id);
    const before=g.evidence;
    expect(killPrisoner(w,g.id,victim.id).ok).toBe(true);
    expect(victim.status).toBe('dead');
    expect(g.prisonerIds).not.toContain(victim.id);
    expect(g.evidence).toBeGreaterThan(before);
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

  it('opens an unwitnessed missing-person search before revealing the address and files raid evidence',()=>{
    const sim=make(),w=sim.world,g=sim.playerGang;
    const victim=Object.values(w.people).find(p=>p.familyOfId!=null)!;
    const office=Object.values(w.buildings).find(b=>b.isHQ&&b.ownerGangId===g.id)!;
    const crime:CrimeRecord={id:9876,week:w.week,gangId:g.id,perpetratorId:g.bossId,kind:'kidnap',
      buildingId:null,victimId:victim.id,witnesses:[],arrestRisk:.05,reported:false};
    w.crimes.push(crime);w.phase='week';w.minute=720;
    victim.status='kidnapped';victim.capturedBy=g.id;
    victim.captivity={stage:'held',officeId:office.id,crimeId:crime.id,startedAt:600,
      reported:false,discovered:false,searchProgress:0,nextEscapeAt:2000};
    g.prisonerIds.push(victim.id);
    tickCaptivity(w,sim.rng);
    expect(victim.captivity.reported).toBe(false);
    w.minute=780;
    tickCaptivity(w,sim.rng);
    expect(victim.captivity.reported).toBe(true);
    expect(victim.captivity.discovered).toBe(false);
    expect(crime.reported).toBe(false);
    expect(w.messages.at(-1)?.pos).toBeNull();
    victim.captivity.discovered=true;
    vi.spyOn(sim.rng,'chance').mockReturnValue(false);
    policeRescueArrival(w,sim.rng,victim.id);
    expect(crime.reported).toBe(true);
    expect(crime.arrestRisk).toBeGreaterThanOrEqual(.42);
    expect(crime.reportedAt).toBe(780);
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
