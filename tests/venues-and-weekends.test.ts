import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { FULL_DAY_MINUTES } from '../src/sim/calendar';
import { BUILDING_BY_ID, ESTABLISHABLE_TYPES, ILLEGAL_TYPES } from '../src/sim/data/buildings';
import { ORIGINAL_KIND_TYPES } from '../src/sim/data/originalKinds';
import { policeOnDuty } from '../src/sim/duty';
import { tickGoods } from '../src/sim/goodsDelivery';
import { goodsRoom } from '../src/sim/goodsStorage';
import { hash32 } from '../src/sim/hash';
import { bribePrice, completeOfficialBribe, officialLeverage } from '../src/sim/officials';
import { Sim } from '../src/sim/sim';
import { tickAmbient } from '../src/sim/systems/ambient';
import { buildingDoor } from '../src/sim/world';

const game = () => new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10, startMoney: 200_000 });

describe('new city businesses and weekend life', () => {
  it('exposes the requested businesses and preserves original city kind matches', () => {
    for (const id of ['haulageCompany', 'jazzClub', 'movieTheater', 'iceHouse'])
      expect(ESTABLISHABLE_TYPES.map(t => t.id)).toContain(id);
    for (const id of ['bookmaker', 'brewery', 'whorehouse'])
      expect(ILLEGAL_TYPES.map(t => t.id)).toContain(id);
    expect(BUILDING_BY_ID.whorehouse.name).toBe('Brothel');
    for (const [original, replacement] of [['Movie Theater', 'movieTheater'], ['Ice House', 'iceHouse'],
      ['Freight Forwarding', 'haulageCompany'], ['Removals Company', 'haulageCompany']] as const)
      expect(ORIGINAL_KIND_TYPES.find(k => k.name === original)?.typeId).toBe(replacement);
  });

  it('moves brewery liquor through a haulage hub and an ice house by delivery truck', () => {
    const sim = game(); sim.launchWeek();
    const w = sim.world, gang = sim.playerGang;
    const sites = Object.values(w.buildings).slice(0, 4);
    const [brewery, haulage, ice, bar] = sites;
    for (const [b, type] of [[brewery, 'brewery'], [haulage, 'haulageCompany'],
      [ice, 'iceHouse'], [bar, 'speakeasy']] as const) {
      b.typeId = type; b.cls = BUILDING_BY_ID[type].cls; b.ownerGangId = gang.id;
      b.state = 'trading'; b.stock = { liquor: 0, stolen: 0, counterfeit: 0 };
      b.goodsProduction = { week: w.week, day: 4, remainder: 0 };
    }
    bar.state = 'ceased'; ice.state = 'ceased';
    brewery.stock.liquor = 40;
    w.minute = 1; tickGoods(w, 1);
    const first = w.goodsDeliveries?.[brewery.id];
    expect(first?.targetId).toBe(haulage.id);
    expect(first?.path.length).toBeGreaterThan(0);
    for (let n = 0; n < 2000 && haulage.stock.liquor < 40; n++) { w.minute++; tickGoods(w, 1); }
    expect(haulage.stock.liquor).toBe(40);
    brewery.state = 'ceased'; bar.state = 'trading';
    for (let n = 0; n < 2000 && bar.stock.liquor < 40; n++) { w.minute++; tickGoods(w, 1); }
    expect(bar.stock.liquor).toBe(40);
    expect(goodsRoom(ice, 'liquor')).toBe(450);
    expect(goodsRoom(ice, 'stolen')).toBe(0);
  });

  it('rotates one police shift and records leverage from a real weekend visit', () => {
    const sim = game(); sim.launchWeek();
    const w = sim.world, gang = sim.playerGang;
    const brothel = Object.values(w.buildings).find(b => b.cls === 'commercial')!;
    brothel.typeId = 'whorehouse'; brothel.cls = 'illegal'; brothel.ownerGangId = gang.id;
    brothel.state = 'trading';
    for (const b of Object.values(w.buildings)) if (b.id !== brothel.id &&
      ['casino', 'gamblingDen', 'speakeasy', 'jazzClub'].includes(b.typeId)) b.state = 'ceased';
    const day = 5;
    const candidates = [w.mayorId, w.policeChiefId, ...w.judgeIds, ...w.daIds].map(id => w.people[id]);
    const official = candidates.find(p => hash32(p.id * 2246822519 + day * 3266489917) % 100 < 55)!;
    expect(official).toBeDefined();
    official.leisureProfile = 'vice';
    const start = 600 + hash32(official.id * 668265263 + day) % 540;
    w.minute = day * FULL_DAY_MINUTES + start;
    const duty = w.policeIds.map(id => w.people[id]).filter(p => policeOnDuty(w, p));
    expect(duty.length).toBeGreaterThan(0);
    expect(duty.length).toBeLessThan(w.policeIds.length);
    official.buildingId = null; official.dest = null; official.path = [];
    official.pos = buildingDoor(w, brothel);
    tickAmbient(w, sim.rng, 1);
    expect(official.buildingId).toBe(brothel.id);
    expect(officialLeverage(w, official, gang.id)?.venueId).toBe(brothel.id);
    const discounted = bribePrice(w, official, gang.id);
    const restored = Sim.fromSave(structuredClone(w));
    expect(officialLeverage(restored.world, restored.world.people[official.id], gang.id)?.venueId).toBe(brothel.id);
    const result = completeOfficialBribe(w, gang.id, official, discounted);
    expect(result.ok).toBe(true);
    expect(officialLeverage(w, official, gang.id)).toBeUndefined();
    expect(bribePrice(w, official, gang.id)).toBeGreaterThan(discounted);
  });
});
