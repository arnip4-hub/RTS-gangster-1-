import { campaignMinute } from './calendar';
import { policeOnDuty } from './duty';
import { addMessage } from './events';
import { payCash, receiveCash } from './finances';
import { clearDestination, setDestination } from './movement';
import type { Rng } from './rng';
import type { ID, Person, WorldState } from './types';
import { buildingDoor, buildingName, dist } from './world';
import { peopleList } from './entityLists';
import { protectionFee } from './premises';
import { shiftAttitude } from './attitudes';
type Outcome = {ok:true;message:string} | {ok:false;error:string};

export function freeCaptive(w: WorldState, p: Person, text?: string): void {
  if (p.capturedBy == null || p.status !== 'kidnapped') return;
  const captor = w.gangs[p.capturedBy], office = p.captivity && w.buildings[p.captivity.officeId];
  if (captor) captor.prisonerIds = captor.prisonerIds.filter(id => id !== p.id);
  if (office && p.captivity?.stage === 'held') p.pos = buildingDoor(w,office);
  p.status = 'active'; p.capturedBy = null; p.interrogationValue = 0;
  p.buildingId = null; p.inVehicle = false; p.orderId = null; p.streetOrder = null;
  clearDestination(p); delete p.captivity;
  if (text) addMessage(w, 'waiting', text, p.pos, p.id);
}

export function ransomQuote(w: WorldState, p: Person): number {
  const official = p.familyOfId == null ? undefined : w.people[p.familyOfId];
  if (p.gangId != null) return Math.min(8000, Math.max(600, Math.round((w.gangs[p.gangId]?.cash ?? 0) * .18)));
  if (official?.role==='owner') {
    const business=Object.values(w.buildings).find(b=>b.ownerPersonId===official.id);
    return Math.min(6000,Math.max(1500,(business?protectionFee(business):250)*10));
  }
  if (official) return ['mayor','policeChief','fbiHead'].includes(official.role) ? 8500 : 5500;
  return p.role === 'owner' ? 2500 : 700 + p.id % 9 * 150;
}

export function demandRansom(w: WorldState, rng: Rng, gangId: ID, personId: ID, amount: number): Outcome {
  const p=w.people[personId], gang=w.gangs[gangId], hold=p?.captivity;
  if (!gang || !p || p.capturedBy!==gangId || hold?.stage!=='held') return {ok:false,error:'The captive has not reached your office.'};
  const now=campaignMinute(w), quote=ransomQuote(w,p);
  if (!Number.isSafeInteger(amount) || amount<Math.ceil(quote/2) || amount>quote*2) return {ok:false,error:'Choose a demand near the suggested ransom.'};
  if (hold.lastDemandAt != null && now-hold.lastDemandAt<180) return {ok:false,error:'Wait three game hours before making another demand.'};
  if ((hold.demandCount??0)>=3) return {ok:false,error:'The family will not consider another demand.'};
  hold.lastDemandAt=now; hold.demandCount=(hold.demandCount??0)+1; hold.searchProgress+=12;
  hold.rivalSearchProgress=(hold.rivalSearchProgress??0)+12;
  const payer=p.gangId==null?undefined:w.gangs[p.gangId];
  const available=payer?.cash ?? (p.householdCash ?? ransomQuote(w,p));
  const accepted=available>=amount && rng.chance(Math.max(.08,Math.min(.9,.72-(amount/quote-1)*.4+(p.familyOfId!=null?.08:0))));
  if (!accepted) return {ok:true,message:`The demand for $${amount.toLocaleString('en-US')} was refused. The search intensifies.`};
  if (payer) payCash(w,payer,'purchases',amount);
  else p.householdCash=Math.max(0,available-amount);
  receiveCash(w,gang,'other',amount);
  freeCaptive(w,p,`${p.name} was released after a $${amount.toLocaleString('en-US')} ransom.`);
  return {ok:true,message:`The ransom of $${amount.toLocaleString('en-US')} was paid; ${p.name} is free.`};
}

export function pressureOfficial(w: WorldState, rng: Rng, gangId: ID, personId: ID): Outcome {
  const p=w.people[personId], hold=p?.captivity, official=hold && p.familyOfId!=null?w.people[p.familyOfId]:undefined;
  if (!p || p.capturedBy!==gangId || hold?.stage!=='held' || !official || official.role==='owner' || official.status!=='active')
    return {ok:false,error:'You need an official’s relative held at the office.'};
  if (hold.pressured) return {ok:false,error:'You have already pressed this official.'};
  hold.pressured=true; hold.searchProgress+=25;
  w.gangs[gangId].evidence=Math.min(100,w.gangs[gangId].evidence+5);
  if (!rng.chance(.45)) return {ok:true,message:`${official.name} refused and contacted investigators.`};
  (official.familyPressure ??= {})[gangId]={victimId:p.id,untilMinute:campaignMinute(w)+10080};
  return {ok:true,message:`${official.name} yielded temporarily. A lawyer can now seek a cheaper bribe; the investigation continues.`};
}

/** Only the owner who actually turned this gang down can be pressed into a
 * protection deal. A new owner or another gang's site cannot be coerced here. */
export function refusedOwnerSites(w: WorldState, ownerId: ID, gangId: ID) {
  return Object.values(w.buildings).filter(b=>b.ownerPersonId===ownerId && b.state==='trading' &&
    (b.ownerGangId==null && !b.protection && !!b.extortRefusedBy?.includes(gangId) ||
      b.protection?.gangId===gangId && (b.protection.refusing || b.protection.refusedWeek===w.week)));
}

export function pressureOwner(w: WorldState, rng: Rng, gangId: ID, personId: ID): Outcome {
  const p=w.people[personId],hold=p?.captivity,owner=hold && p.familyOfId!=null?w.people[p.familyOfId]:undefined;
  if (!w.gangs[gangId] || !p || p.capturedBy!==gangId || hold?.stage!=='held' || owner?.role!=='owner' || owner.status!=='active')
    return {ok:false,error:'You need a refusing owner’s relative held at your office.'};
  if (hold.pressured) return {ok:false,error:'You have already pressed this owner.'};
  const site=refusedOwnerSites(w,owner.id,gangId)[0];
  if (!site) return {ok:false,error:'This owner has no outstanding refusal to your gang.'};
  hold.pressured=true;hold.searchProgress+=25;
  w.gangs[gangId].evidence=Math.min(100,w.gangs[gangId].evidence+5);
  if (!rng.chance(.55)) {
    hold.reported=true;
    return {ok:true,message:`${owner.name} refused and contacted the police. The search intensifies.`};
  }
  if (site.protection) {site.protection.refusing=false;site.protection.grievance=0;delete site.protection.refusedWeek;}
  else {
    const base=protectionFee(site);
    site.protection={gangId,weekly:base,base,refusing:false,grievance:0};
  }
  delete site.extortRefusedBy;
  site.knowledge[gangId]=Math.max(site.knowledge[gangId]??0,2);
  shiftAttitude(owner,gangId,-10,25);
  return {ok:true,message:`${owner.name} agreed to pay protection at ${buildingName(w,site.id)}. The investigation continues.`};
}

/** Clues accumulate in game time. Discovery sends a real officer or a rival
 * rescuer along streets; an unguarded captive can also escape. */
export function tickCaptivity(w: WorldState, rng: Rng): void {
  if (!w.options.continuousTime || w.phase!=='week' || w.minute%60!==0) return;
  const now=campaignMinute(w);
  for (const p of peopleList(w)) {
    const hold=p.captivity;
    if (p.status!=='kidnapped' || p.capturedBy==null || hold?.stage!=='held') continue;
    const office=w.buildings[hold.officeId];
    if (!office || office.ownerGangId!==p.capturedBy || office.state==='destroyed') {
      freeCaptive(w,p,`${p.name} escaped after the safe house was lost.`); continue;
    }
    const guards=office.guardIds.filter(id=>id>=0 && w.people[id]?.status==='active').length;
    if (now>=hold.nextEscapeAt) {
      hold.nextEscapeAt=now+360;
      if (rng.chance(guards ? .04 : .16)) { freeCaptive(w,p,`${p.name} escaped from captivity.`); continue; }
    }
    // A witnessed abduction is already on the desk. Otherwise the household
    // must notice the absence before a missing-person investigation begins.
    if (!hold.reported && now-hold.startedAt >= (p.familyOfId != null ? 180 : 720)) {
      hold.reported=true;
      if (p.familyOfId != null) {
        const official=w.people[p.familyOfId];
        if (official?.role==='fbiHead') w.gangs[p.capturedBy].suspicion=Math.min(100,w.gangs[p.capturedBy].suspicion+8);
      }
      if (w.gangs[p.capturedBy]?.isPlayer || p.gangId!=null && w.gangs[p.gangId]?.isPlayer)
        addMessage(w,'police',`${p.name} has been reported missing. Investigators are looking for leads.`);
    }
    if (p.gangId!=null && !hold.rivalDiscovered) {
      hold.rivalSearchProgress=(hold.rivalSearchProgress??0)+(hold.reported?10:6);
      if (hold.rivalSearchProgress>=100) {
        hold.rivalDiscovered=true;
        office.knowledge[p.gangId]=Math.max(office.knowledge[p.gangId]??0,3);
        if (w.gangs[p.gangId]?.isPlayer) addMessage(w,'waiting',`Your people traced ${p.name} to a safe house. A raid can bring them home.`,buildingDoor(w,office),p.id);
      }
    }
    if (!hold.discovered && hold.reported) {
      hold.searchProgress+=p.familyOfId!=null?12:8;
      if (hold.searchProgress>=100) {
        hold.discovered=true;
        if (w.gangs[p.capturedBy]?.isPlayer || p.gangId!=null && w.gangs[p.gangId]?.isPlayer)
          addMessage(w,'police',`Investigators found the place where ${p.name} is held.`,buildingDoor(w,office),p.id);
      }
    }
    if (p.gangId!=null && hold.rivalDiscovered && !w.gangs[p.gangId]?.isPlayer && !hold.rescuerId &&
      now>=(hold.nextRescueAt??0)) {
      const rescuer=peopleList(w).find(q=>q.gangId===p.gangId && q.status==='active' && q.teamId==null &&
        q.role==='hood' && q.orderId==null && !q.streetOrder);
      if (rescuer) { hold.rescuerId=rescuer.id; setDestination(w,rescuer,buildingDoor(w,office)); }
    }
    let rescuer=hold.rescuerId==null?undefined:w.people[hold.rescuerId];
    if (rescuer && (rescuer.status!=='active' || rescuer.orderId!=null)) {delete hold.rescuerId;rescuer=undefined;}
    if (rescuer && rescuer.status==='active' && rescuer.orderId==null && dist(rescuer.pos,buildingDoor(w,office))<8) {
      delete hold.rescuerId;
      if (rng.chance(guards ? .35 : .8)) freeCaptive(w,p,`${rescuer.name} rescued ${p.name}.`);
      else { rescuer.hp=Math.max(1,rescuer.hp-35); hold.nextRescueAt=now+360; }
      continue;
    }
    if (hold.policeDispatched && !w.policeIds.some(id=>w.people[id]?.emergencyResponse?.rescueCaptiveId===p.id)) hold.policeDispatched=false;
    if (!hold.discovered || hold.policeDispatched || now<(hold.nextPoliceAt??0)) continue;
    const officer=w.policeIds.map(id=>w.people[id]).find(q=>q?.status==='active' && policeOnDuty(w,q) &&
      !q.emergencyResponse && !q.streetOrder && q.orderId==null);
    if (!officer) continue;
    const home=officer.buildingId==null?undefined:w.buildings[officer.buildingId];
    const homePos=home?buildingDoor(w,home):{...officer.pos};
    if (home) {officer.buildingId=null;officer.pos={...homePos};}
    const target=buildingDoor(w,office);
    officer.inVehicle=true; clearDestination(officer); setDestination(w,officer,target);
    officer.emergencyResponse={week:w.week,buildingId:office.id,startMinute:w.minute,untilMinute:w.minute+240,
      kind:'police',stage:'approaching',target,lookAt:target,home:homePos,vehicle:true,
      ...(home?{homeBuildingId:home.id}:{}),rescueCaptiveId:p.id};
    hold.policeDispatched=true;
  }
}

/** A safe-house visit supplies a link to the abductors even if nobody saw the
 * street snatch. The ordinary live law review decides whether it is enough. */
function fileSafeHouseEvidence(w: WorldState, p: Person): void {
  const crime=p.captivity?.crimeId == null ? undefined : w.crimes.find(c=>c.id===p.captivity?.crimeId);
  if (!crime || crime.investigatedAt != null) return;
  crime.reported=true;
  crime.reportedAt=campaignMinute(w);
  crime.arrestRisk=Math.max(crime.arrestRisk,.42);
  const gang=w.gangs[p.capturedBy!];
  if (gang) gang.evidence=Math.min(100,gang.evidence+8);
}

export function policeRescueArrival(w: WorldState, rng: Rng, victimId: ID): void {
  const p=w.people[victimId],hold=p?.captivity,office=hold && w.buildings[hold.officeId];
  if (!p || p.status!=='kidnapped' || hold?.stage!=='held' || !office) return;
  fileSafeHouseEvidence(w,p);
  const guards=office.guardIds.filter(id=>id>=0 && w.people[id]?.status==='active').length;
  if (rng.chance(guards ? .4 : .9)) freeCaptive(w,p,`Police rescued ${p.name} from the safe house.`);
  else {hold.policeDispatched=false;hold.nextPoliceAt=campaignMinute(w)+360;}
}
