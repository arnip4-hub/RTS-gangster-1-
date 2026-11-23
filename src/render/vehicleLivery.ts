import type { PersonRole } from '../sim/types';

/** Restrained period enamel paints, shared by traffic and owned vehicles. */
export const VEHICLE_PAINTS = [
  { id: 'black', label: 'Black', color: 0x22252a },
  { id: 'forest', label: 'Forest green', color: 0x394e3d },
  { id: 'bottle', label: 'Bottle green', color: 0x345653 },
  { id: 'bordeaux', label: 'Bordeaux', color: 0x713e40 },
  { id: 'navy', label: 'Navy blue', color: 0x384968 },
  { id: 'slate', label: 'Slate blue', color: 0x6c7e8c },
  { id: 'cream', label: 'Ivory cream', color: 0xc9bb98 },
  { id: 'sand', label: 'Sand beige', color: 0xa48d6e },
  { id: 'olive', label: 'Olive', color: 0x777b55 },
  { id: 'maroon', label: 'Maroon', color: 0x593541 },
  { id: 'charcoal', label: 'Charcoal', color: 0x50545a },
  { id: 'steel', label: 'Steel grey', color: 0x8a8e8b },
] as const;

export const POLICE_VEHICLE_PAINT = 0x26364b;
export const FEDERAL_VEHICLE_PAINT = 0x23272c;
export const CORONER_VEHICLE_PAINT = 0x1c1e23;
export const TAXI_VEHICLE_PAINT = 0xd69a24;
export const POLICE_DOOR_PAINT = 0xd8d0bc;
export const TRUCK_CANVAS_PAINTS = [0x5c6344, 0xa48d6e, 0x6b5344, 0x4e5647] as const;

function stableHash(identity: string | number): number {
  let hash = 2166136261;
  for (const character of String(identity)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** About 15% of general coupe traffic, stable for a slot across minutes. */
export function isTrafficTaxi(slot: number): boolean {
  return ((slot * 17 + 3) >>> 0) % 20 < 3;
}

export function truckCanvasPaint(identity: string | number): number {
  return TRUCK_CANVAS_PAINTS[stableHash(identity) % TRUCK_CANVAS_PAINTS.length];
}

/** A stable car key survives a driver or passenger change and a save reload. */
export function vehiclePaintFor(identity: string | number, role?: PersonRole): number {
  if (role === 'police' || role === 'policeChief') return POLICE_VEHICLE_PAINT;
  if (role === 'fbi' || role === 'fbiHead') return FEDERAL_VEHICLE_PAINT;
  return VEHICLE_PAINTS[stableHash(identity) % VEHICLE_PAINTS.length].color;
}

/** Background traffic already has a stable paint slot in its timetable. */
export function trafficPaint(index: number): number {
  return VEHICLE_PAINTS[((index % VEHICLE_PAINTS.length) + VEHICLE_PAINTS.length) % VEHICLE_PAINTS.length].color;
}
