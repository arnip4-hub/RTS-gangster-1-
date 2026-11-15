import type { Building, Person, WorldState } from './types';
import { buildingList, peopleList } from './entityLists';
import { dist } from './world';

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
    relative.name = `${relative.name.split(' ')[0]} ${official.name.split(' ').at(-1)}`;
    const home = official.homeBuildingId != null ? w.buildings[official.homeBuildingId]
      : homes.sort((a,b) => dist(w.lots[a.lotId].center,official.pos)-dist(w.lots[b.lotId].center,official.pos) || a.id-b.id)[0];
    if (home) official.homeBuildingId = relative.homeBuildingId = home.id;
  }
}

export function kidnappableBy(p: Person, gangId: number): boolean {
  return p.status === 'active' && (p.gangId != null && p.gangId !== gangId ||
    p.gangId == null && (p.role === 'citizen' || p.role === 'owner'));
}
