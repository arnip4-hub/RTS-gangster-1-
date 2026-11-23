import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLayeredPilotPreview, writeLayeredPilotPreview } from '../src/render/layeredPilotPreview';

const values = new Map<string,string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string,value: string) => { values.set(key,value); },
};
afterEach(() => { values.clear(); vi.unstubAllGlobals(); });

describe('layered 1930s character opt-in', () => {
  it('is disabled by default and persists the option independently of saved worlds', () => {
    vi.stubGlobal('localStorage',storage);
    expect(readLayeredPilotPreview()).toBe(false);
    writeLayeredPilotPreview(true);
    expect(readLayeredPilotPreview()).toBe(true);
    writeLayeredPilotPreview(false);
    expect(readLayeredPilotPreview()).toBe(false);
  });
  it('supports explicit on/off URL review overrides', () => {
    vi.stubGlobal('localStorage',storage);
    writeLayeredPilotPreview(true);
    expect(readLayeredPilotPreview('?layeredPeople=0')).toBe(false);
    writeLayeredPilotPreview(false);
    expect(readLayeredPilotPreview('?layeredPeople=1')).toBe(true);
  });
  it('does not crash without storage access', () => {
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});
    expect(readLayeredPilotPreview()).toBe(false);
    expect(()=>writeLayeredPilotPreview(true)).not.toThrow();
  });
});
