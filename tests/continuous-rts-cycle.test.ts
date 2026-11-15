import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGame } from '../src/app/store';
import { defaultGameOptions } from '../src/app/newGame';
import { MINUTES_PER_SECOND } from '../src/sim/sim';
import { yieldForPaint } from '../src/yieldForPaint';

vi.mock('../src/yieldForPaint', () => ({ yieldForPaint: vi.fn(async () => {}) }));
const paint = vi.mocked(yieldForPaint);
const autosave = useGame.getState().autosave;

beforeEach(() => {
  paint.mockReset().mockResolvedValue();
  useGame.getState().startGame({ ...defaultGameOptions(), seed: 404, citySize: 10 });
  useGame.setState({ autosave: vi.fn(async () => true) });
});
afterEach(() => { useGame.setState({ autosave }); vi.restoreAllMocks(); });

describe('continuous RTS week cycle', () => {
  it('starts the next working week instead of stopping at the Organizer', async () => {
    await useGame.getState().launchWeek();
    const sim = useGame.getState().sim!;
    useGame.getState().setStreetLoading(false);
    const openingWeek = sim.world.week;
    vi.mocked(useGame.getState().autosave).mockClear();

    sim.world.minute = 7 * 24 * 60 - 1;
    for (let i = 0; i < 32 && sim.world.phase === 'week'; i++) {
      useGame.getState().advance(1 / MINUTES_PER_SECOND);
    }
    // launchWeek yields before it snapshots and opens the fresh working week.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sim.world.phase).toBe('week');
    expect(sim.world.week).toBe(openingWeek + 1);
    expect(useGame.getState().streetLoading).toBe(true);
    expect(useGame.getState().organizerOpen).toBe(false);
    expect(useGame.getState().organizerTab).toBe('newspaper');
    expect(useGame.getState().autosave).toHaveBeenCalledWith(true);
  });
});
