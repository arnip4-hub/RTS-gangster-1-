import type { Person } from '../sim/types';

/** No save migration: old and new characters get the same stable visual identity. */
export const COMPOSED_FACE_COUNT = 1536;
export type AppearancePerson = Pick<Person, 'id' | 'portrait' | 'female' | 'role'>;
export type SkinGroup = 0 | 1 | 2;

export function appearanceIndex(person: Pick<Person, 'id' | 'portrait'>): number {
  return (((person.id * 73 + person.portrait * 151) % COMPOSED_FACE_COUNT) + COMPOSED_FACE_COUNT) % COMPOSED_FACE_COUNT;
}

/** Light, medium, deep; each has two portrait shades and matching sprite options. */
export function skinGroup(person: Pick<Person, 'id' | 'portrait'>): SkinGroup {
  return (appearanceIndex(person) % 3) as SkinGroup;
}

/** Painted crew portraits already have fixed skin colors; align their street figures. */
export function paintedCrewSkin(person: AppearancePerson): SkinGroup | null {
  if (!['boss', 'lieutenant', 'hood'].includes(person.role)) return null;
  const n = Math.abs(person.portrait | 0) % 6;
  if (person.female) return n === 3 ? 2 : n === 4 ? 1 : 0;
  return n === 2 ? 2 : n === 4 ? 1 : 0;
}

export function personSkinGroup(person: AppearancePerson): SkinGroup {
  const painted = paintedCrewSkin(person);
  if (painted != null) return painted;
  if (['policeChief', 'fbiHead', 'mayor'].includes(person.role)) return 0;
  const tone = skinGroup(person);
  // Until those exact uniform silhouettes are painted, select the closest
  // available uniform and use the same skin palette in the composed portrait.
  if (person.role === 'police' && tone === 1) return 2;
  return tone;
}
