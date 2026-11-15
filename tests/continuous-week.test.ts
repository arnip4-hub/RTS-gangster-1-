import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { issueOrder, issueStreetOrder } from '../src/sim/api';
import { FULL_DAY_MINUTES, FULL_WEEK_MINUTES, campaignMinute, weekDuration } from '../src/sim/calendar';
import { CELL, MINUTES_PER_SECOND, RTS_MINUTES_PER_SECOND } from '../src/sim/constants';
import { clearDestination, personSpeed, setDestination } from '../src/sim/movement';
import { Sim } from '../src/sim/sim';
import { tickAmbient } from '../src/sim/systems/ambient';
import { tickBuildingEmergencies } from '../src/sim/systems/buildingEmergency';
import { recordCrime } from '../src/sim/events';
import { policeOnDuty } from '../src/sim/duty';
import { buildingDoor, dayIndex, dayPhase, dist } from '../src/sim/world';
import { weekTime } from '../src/ui/WeekClock';

const options = () => ({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10 });

describe('continuous RTS calendar', () => {
  it('takes 24 real minutes per RTS day at normal speed while preserving street pace', () => {
    const rts = new Sim(options());
    rts.launchWeek();
    const classic = new Sim({ ...defaultGameOptions(), seed: 404, citySize: 10 });
    classic.launchWeek();
    const walker = Object.values(rts.world.people).find(p => p.role === 'citizen')!;
    const oldWalker = Object.values(classic.world.people).find(p => p.role === 'citizen')!;
    expect(FULL_DAY_MINUTES / RTS_MINUTES_PER_SECOND / 60).toBe(24);
    expect(personSpeed(walker, rts.world) * RTS_MINUTES_PER_SECOND)
      .toBeCloseTo(personSpeed(oldWalker, classic.world) * MINUTES_PER_SECOND);
    const start = rts.world.minute;
    rts.advance(.5, 1);
    expect(rts.world.minute).toBe(start);
    expect(rts.subMinute).toBeCloseTo(.5);
    rts.advance(.5, 1);
    expect(rts.world.minute).toBe(start + 1);
    classic.advance(1 / MINUTES_PER_SECOND, 1);
    expect(classic.world.minute).toBe(1);
  });

  it('plays full days including Saturday, Sunday and midnight', () => {
    const sim = new Sim(options());
    expect(weekDuration(sim.world)).toBe(FULL_WEEK_MINUTES);
    expect(dayIndex(5 * FULL_DAY_MINUTES, true)).toBe(5);
    expect(dayIndex(6 * FULL_DAY_MINUTES, true)).toBe(6);
    expect(weekTime(23 * 60 + 59, true)).toBe('11:59 pm');
    expect(weekTime(FULL_DAY_MINUTES, true)).toBe('12:00 am');
    expect(dayIndex(FULL_DAY_MINUTES, true)).toBe(1);
    expect(dayPhase(FULL_DAY_MINUTES, true)).toBe(0);
    expect(campaignMinute({ ...sim.world, week: 2, minute: 1 })).toBe(FULL_WEEK_MINUTES + 1);
  });

  it('keeps a travelling person and queued job in the city after weekly accounting', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    const actor = w.people[team.lieutenantId];
    const far = Object.values(w.people).find(p => p.role === 'citizen' && dist(p.pos, actor.pos) > CELL * 4)!;
    actor.pos = { ...far.pos };
    actor.buildingId = null;
    const destination = { x: actor.pos.x > CELL * 5 ? CELL : CELL * 9, y: actor.pos.y > CELL * 5 ? CELL : CELL * 9 };
    expect(issueStreetOrder(w, gang.id, [actor.id], 'goTo', null, destination).ok).toBe(true);
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'goTo', pos: destination }).ok).toBe(true);
    const orderId = team.orderIds.at(-1)!;
    const before = { ...actor.pos };

    w.minute = FULL_WEEK_MINUTES - 1;
    sim.finishWeek();

    expect(w.week).toBe(2);
    expect(w.phase).toBe('week');
    expect(w.minute).toBe(0);
    expect(gang.finances?.week).toBe(2);
    expect(gang.history.at(-1)?.week).toBe(1);
    expect(dist(actor.pos, before)).toBeLessThan(CELL);
    expect(actor.streetOrder?.type).toBe('goTo');
    expect(w.orders[orderId]).toBeDefined();
    expect(team.orderIds).toContain(orderId);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();
  });

  it('keeps a crew in its car and on its active order over the boundary', () => {
    const sim = new Sim({ ...options(), startHoods: 10, startMoney: 200_000 });
    const w = sim.world, gang = sim.playerGang, team = w.teams[gang.teamIds[0]];
    team.vehicles.coupe = 1;
    const hq = Object.values(w.buildings).find(b => b.isHQ && b.ownerGangId === gang.id)!;
    const far = Object.values(w.buildings).find(b => b.ownerGangId == null && b.cls === 'commercial' &&
      dist(w.lots[b.lotId].center, w.lots[hq.lotId].center) > 220)!;
    expect(issueOrder(w, gang.id, { teamId: team.id, type: 'extort', buildingIds: [far.id],
      opts: { manpower: 1, priority: true } }).ok).toBe(true);
    const orderId = team.orderIds.at(-1)!;
    sim.launchWeek();
    const order = w.orders[orderId], driver = w.people[order.assignedIds[0]];
    const key = driver.vehicleKey;
    expect(driver.inVehicle).toBe(true);
    expect(key).toBeTruthy();

    w.minute = FULL_WEEK_MINUTES - 1;
    sim.finishWeek();

    expect(w.week).toBe(2);
    expect(w.phase).toBe('week');
    expect(w.orders[orderId]).toBe(order);
    expect(driver.orderId).toBe(orderId);
    expect(driver.vehicleKey).toBe(key);
    expect(w.vehicleFleet?.[key!]?.occupantIds).toContain(driver.id);
  });

  it('carries a Sunday night emergency through midnight without moving its people home', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    const w = sim.world, site = Object.values(w.buildings)[0];
    const [escaping, responding, shocked] = Object.values(w.people).filter(p => p.role === 'citizen').slice(0, 3);
    const before = { ...escaping.pos };
    escaping.burningEscape = {
      week: 1, buildingId: site.id, startMinute: FULL_WEEK_MINUTES - 8, fatal: false,
      door: before, pavement: { x: before.x + 2, y: before.y }, end: { x: before.x + 4, y: before.y },
      gangId: null, perpetratorId: null,
    };
    responding.emergencyResponse = {
      week: 1, buildingId: site.id, startMinute: FULL_WEEK_MINUTES - 8, untilMinute: FULL_WEEK_MINUTES + 100,
      kind: 'police', stage: 'working', target: { ...responding.pos }, lookAt: { ...responding.pos },
      home: { ...responding.pos }, arrivedMinute: FULL_WEEK_MINUTES - 5,
    };
    shocked.shockReaction = {
      week: 1, startMinute: FULL_WEEK_MINUTES - 8, untilMinute: FULL_WEEK_MINUTES + 20,
      victimId: escaping.id, from: { ...shocked.pos }, to: { ...shocked.pos }, resume: null,
    };

    w.minute = FULL_WEEK_MINUTES - 1;
    sim.finishWeek();

    expect(escaping.burningEscape).toMatchObject({ week: 2, startMinute: -8 });
    expect(responding.emergencyResponse).toMatchObject({ week: 2, startMinute: -8, untilMinute: 100, arrivedMinute: -5 });
    expect(shocked.shockReaction).toMatchObject({ week: 2, startMinute: -8, untilMinute: 20 });
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();
    sim.advance(30, 1);
    expect(escaping.burningEscape).toBeUndefined();
    expect(shocked.shockReaction).toBeUndefined();
  });

  it('loads a Sunday night save without altering its clock', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    sim.world.minute = 6 * FULL_DAY_MINUTES + 20 * 60;
    const restored = Sim.fromSave(structuredClone(sim.world));
    expect(restored.world.minute).toBe(sim.world.minute);
    expect(weekTime(restored.world.minute, true)).toBe('8:00 pm');
  });

  it('keeps civilians moving after midnight', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    const w = sim.world;
    const citizens = Object.values(w.people).filter(p => p.role === 'citizen' && p.status === 'active');
    const walker = citizens[0];
    const far = citizens.find(p => dist(p.pos, walker.pos) > CELL * 3)!;
    setDestination(w, walker, far.pos);
    const before = { ...walker.pos };
    w.minute = FULL_DAY_MINUTES; // Tuesday at midnight
    for (let i = 0; i < 12; i++) {
      w.minute++;
      tickAmbient(w, sim.rng, 1);
    }
    expect(dist(walker.pos, before)).toBeGreaterThan(0);
    expect(dayPhase(w.minute, true)).toBeLessThan(0.1);
  });

  it('sends most people home at night, leaves a small nightlife group out, and brings officials back by morning', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    const w = sim.world;
    const mayor = w.people[w.mayorId];
    const citizens = Object.values(w.people).filter(p => p.role === 'citizen').slice(0, 120);
    w.minute = 20 * 60;

    // Give the ambient scheduler one tick to assign deterministic homes and
    // evening destinations, then put everyone at the door for a focused test
    // of the indoor/outdoor transition itself.
    tickAmbient(w, sim.rng, 1);
    for (const p of [mayor, ...citizens]) {
      const home = p.homeBuildingId == null ? undefined : w.buildings[p.homeBuildingId];
      if (!home) continue;
      p.buildingId = null;
      p.pos = buildingDoor(w, home);
      clearDestination(p);
    }
    tickAmbient(w, sim.rng, 1);

    expect(mayor.homeBuildingId).toBeDefined();
    expect(mayor.buildingId).toBe(mayor.homeBuildingId);
    const atHome = citizens.filter(p => p.buildingId === p.homeBuildingId).length;
    expect(atHome).toBeGreaterThan(citizens.length * 0.7);
    const nightlife = citizens.filter(p => p.buildingId != null && p.buildingId !== p.homeBuildingId).length +
      citizens.filter(p => p.dest != null).length;
    expect(nightlife).toBeGreaterThan(0);
    expect(nightlife).toBeLessThan(citizens.length * 0.3);

    w.minute = 12 * 60;
    tickAmbient(w, sim.rng, 1);
    expect(mayor.buildingId).toBeNull();
  });

  it('keeps police off the night streets and sends a witness call by car', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    const w = sim.world;
    const officers = w.policeIds.slice(0, 8).map(id => w.people[id]);
    w.minute = 20 * 60;
    tickAmbient(w, sim.rng, 1); // assign homes before the focused night check
    for (const p of officers) {
      const home = p.homeBuildingId == null ? undefined : w.buildings[p.homeBuildingId];
      if (home) { p.buildingId = home.id; p.pos = { ...w.lots[home.lotId].center }; }
      p.inVehicle = false;
      clearDestination(p);
      delete p.emergencyResponse;
    }
    for (let i = 0; i < 4; i++) { w.minute++; tickAmbient(w, sim.rng, 1); }
    expect(officers.every(p => !p.inVehicle && !p.emergencyResponse)).toBe(true);
    expect(officers.filter(p => policeOnDuty(w, p))).toHaveLength(1);

    const perp = w.people[sim.playerGang.bossId];
    const police = officers[0];
    const pos = { ...police.pos };
    perp.pos = { ...pos };
    perp.buildingId = null;
    clearDestination(perp);
    // The officer notice roll is intentionally probabilistic; a few witnesses
    // close to the scene make this a stable public-call fixture.
    for (const p of officers) { p.pos = { ...pos }; p.buildingId = null; clearDestination(p); }
    let crime = recordCrime(w, sim.rng, { gangId: sim.playerGang.id, perpetratorId: perp.id,
      type: 'streetKill', pos, severity: 10 });
    for (let i = 0; i < 8 && !crime.reported; i++)
      crime = recordCrime(w, sim.rng, { gangId: sim.playerGang.id, perpetratorId: perp.id,
        type: 'streetKill', pos, severity: 10 });
    const responder = Object.values(w.people).find(p => p.emergencyResponse?.crimeId === crime.id);
    expect(crime.reported).toBe(true);
    expect(responder?.role).toBe('police');
    expect(responder?.inVehicle).toBe(true);
    expect(responder?.emergencyResponse?.vehicle).toBe(true);
    expect(w.messages.some(m => m.text.includes('responding by car'))).toBe(true);
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();

    // One minute of the response is driven by the ordinary road movement code.
    w.minute++;
    tickBuildingEmergencies(w, sim.rng, 1);
    expect(responder?.emergencyResponse).toBeDefined();
  });

  it('gives a long evening commute to civic officials without a permanent fleet', () => {
    const sim = new Sim(options());
    sim.launchWeek();
    const w = sim.world, mayor = w.people[w.mayorId];
    w.minute = 19 * 60;
    tickAmbient(w, sim.rng, 1); // assign a deterministic home
    const home = w.buildings[mayor.homeBuildingId!];
    const far = Object.values(w.buildings).find(b => dist(buildingDoor(w, b), buildingDoor(w, home)) > 260)!;
    mayor.buildingId = null;
    mayor.pos = buildingDoor(w, far);
    mayor.inVehicle = false;
    clearDestination(mayor);
    w.minute = 20 * 60;
    tickAmbient(w, sim.rng, 1);
    expect(mayor.inVehicle).toBe(true);
    expect(mayor.dest).not.toBeNull();
    expect(mayor.vehicleKey).toBeUndefined();
    expect(() => Sim.fromSave(structuredClone(w))).not.toThrow();
  });
});
