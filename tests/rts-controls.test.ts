import { describe, expect, it, vi } from 'vitest';
import { panMapWithKeys } from '../src/ui/useGameKeyboard';

describe('RTS map controls', () => {
  it.each([
    ['w', [0, -52]], ['A', [-52, 0]], ['s', [0, 52]], ['D', [52, 0]],
    ['ArrowUp', [0, -52]], ['ArrowLeft', [-52, 0]],
    ['ArrowDown', [0, 52]], ['ArrowRight', [52, 0]],
  ] as const)('pans the city for %s', (key, delta) => {
    const panBy = vi.fn();
    expect(panMapWithKeys(key, { panBy })).toBe(true);
    expect(panBy).toHaveBeenCalledWith(...delta);
  });

  it('leaves unrelated keys alone', () => {
    const panBy = vi.fn();
    expect(panMapWithKeys('o', { panBy })).toBe(false);
    expect(panBy).not.toHaveBeenCalled();
  });
});
