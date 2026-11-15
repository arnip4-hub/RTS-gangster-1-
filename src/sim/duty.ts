import { FULL_DAY_MINUTES } from './calendar';
import type { Person, WorldState } from './types';

export function isWeekend(w: WorldState): boolean {
  return Math.floor(w.minute / FULL_DAY_MINUTES) % 7 >= 5;
}

/** One rotating officer in eight remains available for night and weekend calls. */
export function policeOnDuty(w: WorldState, p: Person): boolean {
  if (!w.options.continuousTime) return true;
  const day = Math.floor(w.minute / FULL_DAY_MINUTES);
  const hour = (w.minute % FULL_DAY_MINUTES) / 60;
  if (!isWeekend(w) && hour >= 6 && hour < 20) return true;
  const index = w.policeIds.indexOf(p.id);
  const shifts = Math.min(8, w.policeIds.length);
  return index >= 0 && shifts > 0 && index % shifts === day % shifts;
}
