import { DAY_START_HOUR, MINUTES_PER_DAY, MINUTES_PER_WEEK } from './constants';
import type { WorldState } from './types';

/** The RTS city runs through every hour of all seven days. Older saves retain
 * their five eight-hour days, so their in-flight clocks remain meaningful. */
export const FULL_DAY_MINUTES = 24 * 60;
export const FULL_WEEK_MINUTES = 7 * FULL_DAY_MINUTES;

export function dayDuration(continuous = false): number {
  return continuous ? FULL_DAY_MINUTES : MINUTES_PER_DAY;
}

export function weekDuration(w: Pick<WorldState, 'options'>): number {
  return w.options.continuousTime ? FULL_WEEK_MINUTES : MINUTES_PER_WEEK;
}

/** Classic play skips closed hours. The RTS calendar uses actual midnight. */
export function hourOfDay(minute: number, continuous = false): number {
  return ((continuous ? 0 : DAY_START_HOUR) + (minute % dayDuration(continuous)) / 60) % 24;
}

/** Absolute clock used by movement, combat and traffic across a settlement. */
export function campaignMinute(w: WorldState, minute = w.minute): number {
  return (w.week - 1) * weekDuration(w) + minute;
}

/** Keep the old absolute offset for fields already stamped in classic saves. */
export function stampedMinute(w: WorldState): number {
  return w.week * weekDuration(w) + w.minute;
}
