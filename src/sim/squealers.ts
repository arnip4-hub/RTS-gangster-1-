import { campaignMinute } from './calendar';
import type { ID, Person, WorldState } from './types';

/** Keep actual police reports separate from a person's general hostility. */
export function recordSqueal(w: WorldState, gangId: ID, person: Person): void {
  (person.squealedOn ??= {})[gangId] = campaignMinute(w);
}

export function reportedSquealers(w: WorldState, gangId: ID): Person[] {
  return Object.values(w.people)
    .filter((person) => person.status === 'active' && person.squealedOn?.[gangId] != null)
    .sort((a, b) => (b.squealedOn![gangId] - a.squealedOn![gangId]) || a.id - b.id);
}
