import { DAY_START_HOUR, MINUTES_PER_DAY, MINUTES_PER_WEEK } from './constants';

/**
 * A complete RTS day always spans midnight; the classic working-day clock
 * survives only for saved campaigns and explicitly classic scenarios.
 * Neither schedule depends on a Git branch or the original application.
 */
export const FULL_DAY_MINUTES = 24 * 60;
export const FULL_WEEK_MINUTES = 7 * FULL_DAY_MINUTES;

export const CALENDAR_MODES = {
  classic: { dayMinutes: MINUTES_PER_DAY, weekMinutes: MINUTES_PER_WEEK, startHour: DAY_START_HOUR },
  rts: { dayMinutes: FULL_DAY_MINUTES, weekMinutes: FULL_WEEK_MINUTES, startHour: 0 },
} as const;

export function calendarMode(continuous: boolean) {
  return continuous ? CALENDAR_MODES.rts : CALENDAR_MODES.classic;
}
