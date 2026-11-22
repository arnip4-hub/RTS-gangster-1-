import type { ID, Person, WorldState } from '../sim/types';

export type BuildingDispatchSource = 'selected' | 'pool' | `crew:${number}`;
export type BuildingDispatchOrder = 'goTo' | 'guard' | 'patrol';

/** Show the player's people only. Never leak rival crews or hidden personnel. */
export function buildingDispatchRoster(
  w: WorldState, gangId: ID, source: BuildingDispatchSource, highlighted: readonly ID[],
): Person[] {
  const gang = w.gangs[gangId];
  if (!gang) return [];
  let ids: readonly ID[] = highlighted;
  if (source === 'pool') ids = gang.poolIds;
  else if (source.startsWith('crew:')) {
    const id = Number(source.slice(5));
    const team = gang.teamIds.includes(id) ? w.teams[id] : null;
    ids = team?.gangId === gangId ? [team.lieutenantId, ...team.memberIds] : [];
  }
  return [...new Set(ids)]
    .map(id => w.people[id])
    .filter((p): p is Person => !!p && p.gangId === gangId && p.status !== 'dead');
}

export function availableDispatchIds(people: readonly Person[]): ID[] {
  return people.filter(p => p.status === 'active').map(p => p.id);
}

export function validateDispatchSelection(
  w: WorldState, gangId: ID, source: BuildingDispatchSource, highlighted: readonly ID[], chosen: readonly ID[],
): { valid: boolean; ids: ID[] } {
  const allowed = new Set(availableDispatchIds(buildingDispatchRoster(w, gangId, source, highlighted)));
  const ids = [...new Set(chosen)];
  return { valid: ids.length > 0 && ids.every(id => allowed.has(id)), ids };
}
