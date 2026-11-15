import type { ID, WorldState } from './types';

export type PersonListKind='watch'|'hit';

export function personListIds(w: WorldState, gangId: ID, kind: PersonListKind): ID[] {
  const gang=w.gangs[gangId];
  return gang ? (kind==='watch'?gang.watchPersonIds:gang.hitPersonIds) ?? [] : [];
}

/** A list records the player's intent; it never reveals hidden coordinates or
 * starts a violent order by itself. */
export function togglePersonList(w: WorldState, gangId: ID, personId: ID, kind: PersonListKind) {
  const gang=w.gangs[gangId],p=w.people[personId];
  if (!gang || !p || !['watch','hit'].includes(kind)) return {ok:false,error:'Choose a person and list.'} as const;
  const key=kind==='watch'?'watchPersonIds':'hitPersonIds';
  const ids=gang[key]??[];
  const on=ids.includes(personId);
  gang[key]=on?ids.filter(id=>id!==personId):[...ids,personId];
  return {ok:true,message:`${p.name} ${on?'removed from':'added to'} the ${kind==='watch'?'watch list':'hit list'}.`} as const;
}
