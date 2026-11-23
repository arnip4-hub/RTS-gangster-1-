import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVisualStyle, usesPaintedCity, writeVisualStyle } from '../src/render/visualStyle';

describe('pure 3D artwork selection', () => {
  const entries = new Map<string, string>();

  beforeEach(() => {
    entries.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists Illustrated 3D and Detailed', () => {
    writeVisualStyle('illustrated3d');
    expect(readVisualStyle()).toBe('illustrated3d');
    expect(usesPaintedCity(readVisualStyle())).toBe(true);
    writeVisualStyle('detailed');
    expect(readVisualStyle()).toBe('detailed');
    expect(usesPaintedCity(readVisualStyle())).toBe(false);
  });

  it('migrates the retired illustrated billboard mode to detailed', () => {
    entries.set('og.visualStyle', 'illustrated');
    expect(readVisualStyle()).toBe('detailed');
    entries.set('og.visualStyle', 'unsupported');
    expect(readVisualStyle()).toBe('detailed');
  });
});
