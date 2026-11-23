import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { Sim } from '../src/sim/sim';
import { profileFor, storefrontStyle, type StorefrontStyle } from '../src/render/profile';
import { BUILDING_BY_ID } from '../src/sim/data/buildings';
import { FACADE_PALETTES } from '../src/render/textures';

describe('building variety', () => {
  it('maps all 13 storefront styles to intended types', () => {
    const expected: [string, StorefrontStyle][] = [
      ['grocers', 'provisionMarket'], ['financeCompany', 'financialStone'],
      ['firehouse', 'fireEngineBay'], ['pawnbroker', 'pawnSecured'],
      ['drugStore', 'apothecarySoda'], ['tailors', 'luxuryBoutique'],
      ['poolHall', 'poolParlor'], ['hotelLarge', 'hotelCanopy'],
      ['bookStore', 'classicDisplay'], ['departmentStore', 'artDecoGlazed'],
      ['cafe', 'cafeBistro'], ['movieTheater', 'nightlifeLobby'],
      ['autoShop', 'serviceBay'],
    ];
    for (const [typeId, style] of expected) {
      expect(storefrontStyle(typeId, 1)).toBe(style);
    }
  });

  it('keeps illegal sites without a shop base', () => {
    const w = new Sim({ ...defaultGameOptions(), citySize: 8, seed: 1 }).world;
    const illegal = Object.values(w.buildings).filter(b => b.cls === 'illegal');
    for (const b of illegal) {
      expect(profileFor(b, BUILDING_BY_ID[b.typeId]).base).toBe('none');
    }
  });

  it('keeps street face flush and wings outside the front mass', () => {
    const w = new Sim({ ...defaultGameOptions(), citySize: 12, seed: 404 }).world;
    const profiles = Object.values(w.buildings).map(b => profileFor(b, BUILDING_BY_ID[b.typeId]));
    for (const p of profiles.filter(x => !x.ruin && x.masses.length > 1)) {
      const m0 = p.masses[0];
      // Street face (+Z) flush with profile depth
      expect(m0.dz + m0.d / 2).toBeCloseTo(p.depth / 2, 1);
    }
    expect(FACADE_PALETTES.length).toBe(12);
  });
});
