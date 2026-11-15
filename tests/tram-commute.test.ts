import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { clearStreetOrder, issueStreetOrder } from '../src/sim/api';
import { streetPersonVisible } from '../src/render/characterPresentation';
import { createWorld } from '../src/sim/citygen';
import { campaignMinute } from '../src/sim/calendar';
import { CELL } from '../src/sim/constants';
import { setDestination, stepPerson } from '../src/sim/movement';
import { validateSaveWorld } from '../src/sim/saveSchema';
import { tickTramCommutes } from '../src/sim/tramCommute';
import { cityTramLines } from '../src/sim/trams';
import type { Person, WorldState } from '../src/sim/types';

function tripScene(): { w: WorldState; p: Person; destination: { x: number; y: number } } {
  const w = createWorld({ ...newCampaignOptions(), seed: 404 }).world;
  const p = Object.values(w.people).find(q => q.role === 'citizen' && q.status === 'active')!;
  const line = cityTramLines(w)[0];
  p.pos = { x: 8 * CELL, y: line.points[0].y - 3.15 };
  p.buildingId = null; p.dest = null; p.path = [];
  const destination = { x: 29 * CELL, y: p.pos.y };
  for (let minute = 600; minute < 900; minute++) {
    w.minute = minute;
    setDestination(w, p, destination);
    if (p.tramTrip) return { w, p, destination };
  }
  throw Error('No faster tram service was found for a long avenue journey.');
}

describe('RTS tram commuting', () => {
  it('plans a faster long journey and keeps short walks on foot', () => {
    const { w, p, destination } = tripScene();
    expect(p.tramTrip?.finalDest).toEqual(destination);
    expect(p.dest).toEqual(p.tramTrip?.boardPos);
    expect(p.path.length).toBeGreaterThan(0);
    setDestination(w, p, { x: p.pos.x + 10, y: p.pos.y });
    expect(p.tramTrip).toBeUndefined();
    expect(p.dest).toEqual({ x: p.pos.x + 10, y: p.pos.y });
  });

  it('can use the saved stop network in a compact city', () => {
    const w = createWorld({ ...defaultGameOptions(), continuousTime: true, citySize: 12, seed: 404 }).world;
    const line = cityTramLines(w).find(route => route.stops.length >= 2)!;
    expect(line).toBeDefined();
    const p = Object.values(w.people).find(q => q.role === 'citizen' && q.status === 'active')!;
    p.pos = { ...line.stops[0].pos }; p.buildingId = null;
    const destination = line.stops.at(-1)!.pos;
    for (let minute = 600; minute < 900 && !p.tramTrip; minute++) {
      w.minute = minute;
      setDestination(w, p, destination);
    }
    expect(p.tramTrip?.line).toBeGreaterThanOrEqual(0);
    p.pos = { ...p.tramTrip!.boardPos }; p.dest = null; p.path = [];
    for (let n = 0; n < 140 && p.tramTrip?.phase !== 'riding'; n++) {
      w.minute++; tickTramCommutes(w);
    }
    expect(p.tramTrip?.phase).toBe('riding');
    for (let n = 0; n < 700 && p.tramTrip; n++) {
      w.minute++; tickTramCommutes(w);
    }
    expect(p.tramTrip).toBeUndefined();
    expect(p.dest).toEqual(destination);
    for (let n = 0; n < 300 && p.dest; n++) stepPerson(p, 1, undefined, w);
    expect(p.pos).toEqual(destination);
  });

  it('walks to the platform, boards a real tram, survives a save and walks after alighting', () => {
    const { w, p, destination } = tripScene();
    for (let n = 0; n < 300 && p.tramTrip?.phase === 'approaching'; n++) {
      w.minute++;
      if (p.dest) stepPerson(p, 1, undefined, w);
      tickTramCommutes(w);
    }
    expect(p.tramTrip?.phase).toBe('waiting');
    for (let n = 0; n < 140 && p.tramTrip?.phase === 'waiting'; n++) {
      w.minute++;
      tickTramCommutes(w);
    }
    expect(p.tramTrip?.phase).toBe('riding');
    expect(p.tramTrip?.tram).toBeDefined();
    expect(() => validateSaveWorld(structuredClone(w))).not.toThrow();
    const aboard = { ...p.pos };
    for (let n = 0; n < 700 && p.tramTrip; n++) {
      w.minute++;
      tickTramCommutes(w);
    }
    expect(p.tramTrip).toBeUndefined();
    expect(p.dest).toEqual(destination);
    for (let n = 0; n < 300 && p.dest; n++) stepPerson(p, 1, undefined, w);
    expect(p.pos).toEqual(destination);
    expect(p.pos).not.toEqual(aboard);
    expect(campaignMinute(w)).toBeGreaterThan(600);
  });

  it('keeps a player move order active during the wait and the ride', () => {
    const { w, p, destination } = tripScene();
    const gang = Object.values(w.gangs).find(g => g.isPlayer)!;
    const hood = Object.values(w.people).find(q => q.gangId === gang.id && q.role === 'hood')!;
    hood.pos = { ...p.pos }; hood.buildingId = null; hood.inVehicle = false;
    hood.dest = null; hood.path = []; hood.vehicleKey = undefined;
    w.phase = 'week';
    const result = issueStreetOrder(w, gang.id, [hood.id], 'goTo', null, destination);
    expect(result.ok).toBe(true);
    expect(hood.tramTrip?.finalDest).toEqual(destination);
    for (let n = 0; n < 300 && hood.tramTrip?.phase === 'approaching'; n++) {
      w.minute++;
      if (hood.dest) stepPerson(hood, 1, undefined, w);
      tickTramCommutes(w);
    }
    expect(hood.tramTrip?.phase).toBe('waiting');
    expect(hood.streetOrder?.type).toBe('goTo');
    for (let n = 0; n < 140 && hood.tramTrip?.phase === 'waiting'; n++) {
      w.minute++; tickTramCommutes(w);
    }
    expect(hood.tramTrip?.phase).toBe('riding');
    expect(stepPerson(hood, 1, undefined, w)).toBe(false);
    expect(hood.streetOrder?.type).toBe('goTo');
    expect(streetPersonVisible(hood, hood.id)).toBe(false);
    expect(clearStreetOrder(w, [hood.id]).ok).toBe(true);
    expect(hood.tramTrip).toBeUndefined();
  });
});
