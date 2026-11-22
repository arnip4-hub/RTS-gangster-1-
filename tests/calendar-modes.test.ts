import { describe, expect, it } from 'vitest';
import { DAY_START_HOUR, MINUTES_PER_DAY, MINUTES_PER_WEEK } from '../src/sim/constants';
import { CALENDAR_MODES, calendarMode } from '../src/sim/calendarModes';
import { FULL_DAY_MINUTES, FULL_WEEK_MINUTES, dayDuration, hourOfDay, weekDuration } from '../src/sim/calendar';
import type { WorldState } from '../src/sim/types';

const world = (continuousTime: boolean) =>
  ({ options: { continuousTime } } as Pick<WorldState, 'options'>);

describe('standalone RTS calendar and legacy save compatibility', () => {
  it('runs full days and seven-day weeks for RTS campaigns', () => {
    expect(calendarMode(true)).toBe(CALENDAR_MODES.rts);
    expect(dayDuration(true)).toBe(FULL_DAY_MINUTES);
    expect(weekDuration(world(true))).toBe(FULL_WEEK_MINUTES);
    expect(hourOfDay(0, true)).toBe(0);
    expect(hourOfDay(23 * 60 + 59, true)).toBeCloseTo(23 + 59 / 60);
    expect(hourOfDay(FULL_DAY_MINUTES, true)).toBe(0);
  });
  it('preserves the old working-week clock in saved classic campaigns', () => {
    expect(calendarMode(false)).toBe(CALENDAR_MODES.classic);
    expect(dayDuration(false)).toBe(MINUTES_PER_DAY);
    expect(weekDuration(world(false))).toBe(MINUTES_PER_WEEK);
    expect(hourOfDay(0, false)).toBe(DAY_START_HOUR);
    expect(hourOfDay(MINUTES_PER_DAY - 1, false)).toBeCloseTo(DAY_START_HOUR + (MINUTES_PER_DAY - 1) / 60);
    expect(hourOfDay(MINUTES_PER_DAY, false)).toBe(DAY_START_HOUR);
  });
});
