import type { Person, PublicServiceRecord } from './types';

const SERVICE_ROLES = new Set(['police', 'policeChief', 'fbi', 'fbiHead', 'judge', 'da', 'mayor']);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Existing officials receive stable, varied starting records without using
 * the world RNG or changing any established save data. */
export function ensurePublicService(person: Person): PublicServiceRecord | undefined {
  if (!SERVICE_ROLES.has(person.role)) return undefined;
  if (!person.publicService) {
    const seed = stableHash(`${person.id}:${person.role}`);
    person.publicService = {
      experience: 18 + seed % 58,
      integrity: 42 + (stableHash(`${person.id}:${person.role}:integrity`) % 59),
      casesHandled: 0,
      mistakes: 0,
      bribesAccepted: 0,
    };
  }
  return person.publicService;
}

/** A small shared measure used for evidence quality and courtroom performance. */
export function serviceQuality(person: Person): number {
  const record = ensurePublicService(person);
  if (!record) return clamp(person.skills.intelligence * 15);
  return clamp(12 + person.skills.intelligence * 13 + record.experience * 0.36);
}

export function recordServiceCase(person: Person): void {
  const record = ensurePublicService(person);
  if (!record) return;
  record.casesHandled++;
  record.experience = clamp(record.experience + 1);
}

export function recordServiceMistake(person: Person): void {
  const record = ensurePublicService(person);
  if (record) record.mistakes++;
}

export function recordServiceBribe(person: Person): void {
  const record = ensurePublicService(person);
  if (!record) return;
  record.bribesAccepted++;
  record.integrity = clamp(record.integrity - 12);
}
