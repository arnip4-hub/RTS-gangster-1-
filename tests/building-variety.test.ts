import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { profileFor, storefrontStyle, type StorefrontStyle } from '../src/render/profile';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';

const STYLES: StorefrontStyle[] = ['classicDisplay', 'artDecoGlazed', 'cafeBistro', 'nightlifeLobby', 'financialStone', 'serviceBay'];

describe('building variety', () => {
  it('maps commercial types across all six storefront styles', () => {
    const seen = new Set<StorefrontStyle>();
    for (const typeId of ['grocers', 'departmentStore', 'cafe', 'movieTheater', 'bankLarge', 'autoShop']) {
      seen.add(storefrontStyle(typeId, 1));
    }
    expect(seen.size).toBe(6);
    expect([...seen].every(s => STYLES.includes(s))).toBe(true);
  });

  it('uses multi-mass courtyards, setbacks, and all roof types across a city', () => {
    const w = new Sim({ ...defaultGameOptions(), citySize: 12, seed: 404 }).world;
    const profiles = Object.values(w.buildings).map(b => profileFor(b, BUILDING_BY_ID[b.typeId]));
    const multiMass = profiles.filter(p => p.masses.length > 1 && !p.ruin);
    const roofs = new Set(profiles.map(p => p.roof));
    const facades = new Set(profiles.map(p => p.facade));
    expect(multiMass.length).toBeGreaterThan(0);
    expect(roofs.has('flat')).toBe(true);
    expect(roofs.has('gable') || roofs.has('hip') || roofs.has('mansard')).toBe(true);
    expect([...facades].some(f => f >= 6)).toBe(true);
    // masses[0] remains the street-fronting base
    for (const p of profiles.filter(x => !x.ruin)) {
      expect(p.masses[0].y).toBe(0);
    }
  });
});
