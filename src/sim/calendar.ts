import type { WorldState } from './types';
import { calendarMode } from './calendarModes';

export { FULL_DAY_MINUTES, FULL_WEEK_MINUTES } from './calendarModes';

/** RTS uses complete seven-day weeks; old saves retain their five working days. */
export function dayDuration(continuous = false): number {
  return calendarMode(continuous).dayMinutes;
}

export function weekDuration(w: Pick<WorldState, 'options'>): number {
  return calendarMode(!!w.options.continuousTime).weekMinutes;
}

export function hourOfDay(minute: number, continuous = false): number {
  const mode = calendarMode(continuous);
  return ((mode.startHour + (minute % mode.dayMinutes) / 60) % 24);
}

/** Absolute clock used by movement, combat and traffic across a settlement. */
export function campaignMinute(w: WorldState, minute = w.minute): number {
  return (w.week - 1) * weekDuration(w) + minute;
}

/** Keep the old absolute offset for fields already stamped in classic saves. */
export function stampedMinute(w: WorldState): number {
  return w.week * weekDuration(w) + w.minute;
}
