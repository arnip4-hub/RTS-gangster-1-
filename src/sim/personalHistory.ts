import { campaignMinute, FULL_DAY_MINUTES } from './calendar';
import type { PersonalMemory, Person, WorldState } from './types';

const MEMORY_LIMIT = 12;
const MEMORY_DECAY_DAYS = 35;

/** Store only incidents the person could know about. The bounded history is
 * part of the save, so witnesses keep the same experience after loading. */
export function rememberPersonalEvent(w: WorldState, person: Person | undefined,
  event: Omit<PersonalMemory, 'atMinute'>): void {
  if (!w.options.continuousTime || !person) return;
  const now = campaignMinute(w);
  person.personalMemories ??= [];
  const duplicate = person.personalMemories.find(m => m.kind === event.kind && m.personId === event.personId &&
    m.gangId === event.gangId && now - m.atMinute < 6 * 60);
  if (duplicate) {
    duplicate.atMinute = now;
    duplicate.intensity = Math.max(duplicate.intensity, event.intensity);
    return;
  }
  person.personalMemories.push({ ...event, atMinute: now });
  if (person.personalMemories.length > MEMORY_LIMIT)
    person.personalMemories.splice(0, person.personalMemories.length - MEMORY_LIMIT);
}

/** Recent, attributed trauma makes a civilian more willing to tell police
 * what they saw. Fear still applies and can outweigh the desire for revenge. */
export function memoryWitnessBonus(person: Person, gangId: number, now: number): number {
  let strongest = 0;
  for (const memory of person.personalMemories ?? []) {
    if (memory.gangId !== gangId || !['kidnapped', 'familyKidnapped', 'familyPressured', 'familyKilled'].includes(memory.kind)) continue;
    const ageDays = Math.max(0, now - memory.atMinute) / FULL_DAY_MINUTES;
    if (ageDays >= MEMORY_DECAY_DAYS) continue;
    const remaining = 1 - ageDays / MEMORY_DECAY_DAYS;
    strongest = Math.max(strongest, Math.min(.24, memory.intensity / 100 * .24 * remaining));
  }
  return strongest;
}
