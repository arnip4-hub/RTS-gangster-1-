import { FEMALE_FIRST, MALE_FIRST } from './data/names';
import type { Person, WorldState } from './types';

/** Household details are stable for old saves and new citizens without drawing
 * from the simulation RNG. Off-map spouses and children are background records. */
function roll(w: WorldState, id: number, salt: number): number {
  let n = (id * 2654435761 + w.options.seed * 1013904223 + salt) >>> 0;
  n ^= n >>> 16; n = Math.imul(n, 2246822507); n ^= n >>> 13;
  return n >>> 0;
}

export function personProfile(w: WorldState, p: Person): {age:number;spouse:string|null;children:number;householdSize:number} {
  const official = p.familyRelation === 'spouse' && p.familyOfId != null ? w.people[p.familyOfId] : undefined;
  const relative = ['mayor','policeChief','fbiHead','judge','da'].includes(p.role)
    ? Object.values(w.people).find(q => q.familyOfId === p.id && q.familyRelation === 'spouse') : undefined;
  const householdId = official?.id ?? p.id;
  const baseAge = 20 + roll(w, p.id, 17) % 46;
  const linkedAge = official ? 20 + roll(w, official.id, 17) % 46 : baseAge;
  const age = Math.max(18, linkedAge + (official ? roll(w,p.id,31)%13-6 : 0) + Math.floor((w.week-1)/52));
  const linkedSpouse = official ?? relative;
  const married = !!linkedSpouse || age >= 24 && roll(w,p.id,41)%10 < 6;
  const first = p.female ? MALE_FIRST : FEMALE_FIRST;
  const spouse = linkedSpouse ? `${linkedSpouse.name}${linkedSpouse.status==='dead' ? ' (deceased)' : ''}` : married
    ? `${first[roll(w,p.id,59)%first.length]} ${p.name.split(' ').at(-1)}` : null;
  const children = age < 23 ? 0 : Math.min(4, roll(w,householdId,73)%5, Math.floor((age-19)/5));
  return {age,spouse,children,householdSize:1+(spouse?1:0)+children};
}
