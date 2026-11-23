import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVisualStyle, usesPaintedCity, writeVisualStyle } from '../src/render/visualStyle';

describe('illustrated 3D artwork selection', () => {
  const entries = new Map<string, string>();

  beforeEach(() => {
    entries.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists Illustrated 3D rather than silently replacing it with Detailed', () => {
    writeVisualStyle('illustrated3d');
    expect(entries.get('og.visualStyle')).toBe('illustrated3d');
    expect(readVisualStyle()).toBe('illustrated3d');
    expect(usesPaintedCity(readVisualStyle())).toBe(true);
  });

  it.each(['detailed', 'illustrated', 'illustrated3d'] as const)(
    'restores all three selectable modes after city reopen: %s', mode => {
      writeVisualStyle(mode);
      expect(readVisualStyle()).toBe(mode);
    },
  );

  it('falls back only for missing or unrecognized preferences', () => {
    expect(readVisualStyle()).toBe('detailed');
    entries.set('og.visualStyle', 'unsupported');
    expect(readVisualStyle()).toBe('detailed');
  });
});
