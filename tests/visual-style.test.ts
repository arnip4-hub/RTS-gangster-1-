import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVisualStyle, usesPaintedCity, writeVisualStyle } from '../src/render/visualStyle';

describe('unified 3D artwork', () => {
  const entries = new Map<string, string>();

  beforeEach(() => {
    entries.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('always resolves to the single painted 3D style', () => {
    expect(readVisualStyle()).toBe('illustrated3d');
    expect(usesPaintedCity()).toBe(true);
    writeVisualStyle('illustrated3d');
    expect(readVisualStyle()).toBe('illustrated3d');
    expect(usesPaintedCity(readVisualStyle())).toBe(true);
  });

  it('migrates any legacy preference onto illustrated3d', () => {
    for (const legacy of ['detailed', 'illustrated', 'unsupported', '']) {
      entries.set('og.visualStyle', legacy);
      expect(readVisualStyle()).toBe('illustrated3d');
      expect(entries.get('og.visualStyle')).toBe('illustrated3d');
    }
  });
});
