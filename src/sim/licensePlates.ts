import type { ID, WorldState } from './types';

function hash(value: string): number {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
}

/** A stable fictional city registration tied to a vehicle, never to its driver. */
export function plateForVehicleKey(vehicleKey: string): string {
  const n = hash(vehicleKey);
  return `OC-${String(n % 10000).padStart(4, '0')}`;
}

export function plateRegistration(w: WorldState, plate: string): { vehicleKey: string; registeredPersonId?: ID } | undefined {
  for (const [vehicleKey, vehicle] of Object.entries(w.vehicleFleet ?? {})) {
    const registeredPlate = plateForVehicleKey(vehicleKey);
    if (plate === registeredPlate || plate === `${registeredPlate.slice(0, -2)}??`) {
      return { vehicleKey, registeredPersonId: vehicle.driverId ?? undefined };
    }
  }
  return undefined;
}
