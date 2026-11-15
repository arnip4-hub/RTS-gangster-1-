import { describe, expect, it } from 'vitest';
import { VEHICLE_PAINTS, vehiclePaintFor, trafficPaint, POLICE_VEHICLE_PAINT,
  FEDERAL_VEHICLE_PAINT } from '../src/render/vehicleLivery';
import { TRAFFIC_PAINT_SLOTS, carsAt } from '../src/sim/traffic';
import { createWorld } from '../src/sim/citygen';
import { defaultGameOptions } from '../src/app/newGame';

describe('paint belongs to a vehicle rather than its current driver', () => {
  it('keeps fleet paint stable across reload and covers the period palette', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `gang:4:team:${i}:coupe`);
    const before = ids.map(key => vehiclePaintFor(key));
    const reloaded = JSON.parse(JSON.stringify(ids)) as string[];
    expect(reloaded.map(key => vehiclePaintFor(key))).toEqual(before);
    expect(new Set(before).size).toBe(12);
    expect(new Set(before)).toEqual(new Set(VEHICLE_PAINTS.map(paint => paint.color)));
    expect(vehiclePaintFor(ids[0], 'citizen')).toBe(vehiclePaintFor(ids[0], 'hood'));
  });

  it('retains restrained service paint independently of civilian palettes', () => {
    expect(vehiclePaintFor('officer:1', 'police')).toBe(POLICE_VEHICLE_PAINT);
    expect(vehiclePaintFor('officer:500', 'policeChief')).toBe(POLICE_VEHICLE_PAINT);
    expect(vehiclePaintFor('federal:2', 'fbi')).toBe(FEDERAL_VEHICLE_PAINT);
    expect(vehiclePaintFor('federal:900', 'fbiHead')).toBe(FEDERAL_VEHICLE_PAINT);
  });

  it('uses valid stable paint slots as background cars follow their routes', () => {
    const { world } = createWorld({ ...defaultGameOptions(), citySize: 24, seed: 1930, continuousTime: true });
    world.phase = 'week';
    const early = carsAt(world, 900).map(car => car.color);
    const late = carsAt(world, 960).map(car => car.color);
    expect(late).toEqual(early);
    expect(TRAFFIC_PAINT_SLOTS).toBe(VEHICLE_PAINTS.length);
    for (const index of early) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(VEHICLE_PAINTS.length);
      expect(trafficPaint(index)).toBe(VEHICLE_PAINTS[index].color);
    }
    expect(new Set(early).size).toBeGreaterThanOrEqual(8);
  });
});
