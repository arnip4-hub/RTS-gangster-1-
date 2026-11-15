import type { Building, Person, WorldState } from './types';
import { buildingList, peopleList } from './entityLists';
import { dist } from './world';
import { createPerson, giveFamilySurname } from './citygen';
import type { Rng } from './rng';

/** Public household records give officials one adult civilian relative each.
 * Running this on load also upgrades earlier RTS saves without extra RNG draws. */
export function ensureOfficialFamilies(w: WorldState): void {
  if (!w.options.continuousTime) return;
  const officials = [w.mayorId, w.policeChiefId, w.fbiHeadId, ...w.judgeIds, ...w.daIds]
    .map(id => w.people[id]).filter((p): p is Person => !!p);
  const citizens = peopleList(w).filter(p => p.role === 'citizen' && p.gangId == null);
  const homes = buildingList(w).filter((b): b is Building =>
    (b.cls === 'residential' || b.cls === 'tenement') && b.state !== 'destroyed');
  const used = new Set(peopleList(w).filter(p => p.familyOfId != null).map(p => p.id));
  for (let i = 0; i < officials.length; i++) {
    const official = officials[i];
    if (citizens.some(p => p.familyOfId === official.id)) continue;
    const relative = citizens.filter(p => !used.has(p.id))
      .sort((a,b) => dist(a.pos,official.pos)-dist(b.pos,official.pos) || a.id-b.id)[0];
    if (!relative) break;
    used.add(relative.id);
    relative.familyOfId = official.id;
    relative.familyRelation = i % 2 === 0 ? 'spouse' : 'sibling';
    giveFamilySurname(w, relative, official);
    const home = official.homeBuildingId != null ? w.buildings[official.homeBuildingId]
      : homes.sort((a,b) => dist(w.lots[a.lotId].center,official.pos)-dist(w.lots[b.lotId].center,official.pos) || a.id-b.id)[0];
    if (home) official.homeBuildingId = relative.homeBuildingId = home.id;
  }
}

/** A refused protection demand brings one adult member of the owner's
 * household into the city. Reuse a resident when possible; saves keep the tie. */
export function ensureOwnerRelative(w: WorldState, rng: Rng, owner: Person): Person | null {
  if (!w.options.continuousTime || owner.role!=='owner' || owner.status!=='active') return null;
  const existing=peopleList(w).find(p=>p.familyOfId===owner.id && p.role==='citizen');
  if (existing) return existing;
  const candidate=peopleList(w).filter(p=>p.role==='citizen' && p.status==='active' && p.familyOfId==null)
    .sort((a,b)=>dist(a.pos,owner.pos)-dist(b.pos,owner.pos) || a.id-b.id)[0];
  const relative=candidate ?? createPerson(w,rng,'citizen',owner.pos);
  relative.familyOfId=owner.id;
  relative.familyRelation=owner.id%2===0?'spouse':'sibling';
  giveFamilySurname(w, relative, owner);
  if (owner.homeBuildingId != null) relative.homeBuildingId=owner.homeBuildingId;
  else if (relative.homeBuildingId != null) owner.homeBuildingId=relative.homeBuildingId;
  return relative;
}

/** Upgrade an earlier RTS save that already contains owner refusals. */
export function ensureRefusingOwnerFamilies(w: WorldState, rng: Rng): void {
  if (!w.options.continuousTime) return;
  for (const site of buildingList(w)) {
    if (!site.extortRefusedBy?.length && site.protection?.refusing!==true) continue;
    const owner=site.ownerPersonId==null?undefined:w.people[site.ownerPersonId];
    if (owner) ensureOwnerRelative(w,rng,owner);
  }
}

export function kidnappableBy(p: Person, gangId: number): boolean {
  return p.status === 'active' && (p.gangId != null && p.gangId !== gangId ||
    p.gangId == null && (p.role === 'citizen' || p.role === 'owner'));
}
