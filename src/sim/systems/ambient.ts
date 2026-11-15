import { BLOCK_SIZE, CELL, DRIVE_MIN_DISTANCE } from '../constants';
import { FULL_DAY_MINUTES, hourOfDay } from '../calendar';
import { presentPhoto } from '../presentationEvents';
import { specialistParticipants, specialistVisitTargets } from '../specialistJobs';
import { clearDestination, earlySteps, setDestination, stepPerson } from '../movement';
import { trafficContext } from '../traffic';
import { peopleSlice } from '../peopleSlices';
import { hash32 } from '../hash';
import { alight } from '../transport';
import type { Rng } from '../rng';
import type { Block, Building, Person, PersonRole, WorldState } from '../types';
import { allBuildings, buildingDoor, dist } from '../world';

/**
 * Everyone who is not carrying out an order still has to be somewhere: citizens
 * wander, snitches drift between gang turf, and FBI agents make their way
 * toward whatever they are investigating. Police wait at home or on station
 * duty until a response system gives them a route.
 */
export function tickAmbient(w: WorldState, rng: Rng, minutes: number,
  slice?: { index: number; count: number; early: boolean; traffic?: ReturnType<typeof trafficContext>; vehicles?: 'skip' | 'only' }): void {
  // Slices take the closing minute's traffic, already built: the coming
  // minute's is not settled until its tick runs tickTraffic.
  const traffic = slice?.traffic ?? trafficContext(w);
  const meeting = specialistParticipants(w), awaited = specialistVisitTargets(w);
  // One slice of the city at a time (sim.ts), or everyone; both in id order.
  const people = slice ? peopleSlice(w, slice.index, slice.count) : Object.values(w.people);
  for (const p of people) {
    if (p.status !== 'active' || p.burningEscape?.week===w.week || p.emergencyResponse || p.shockReaction) continue;
    // Cars are drawn along the minute they drove since the tick, so they drive
    // in the tick: an early slice leaves them for it (sim.ts) — stepping them
    // part way through the minute made them stand, then jump, every minute.
    if (slice?.vehicles === 'skip' && p.inVehicle) continue;
    if (slice?.vehicles === 'only' && !p.inVehicle) continue;
    if (slice?.early) {
      // Pinned if he moved or only chose where to go next: one given a new
      // route was otherwise drawn heading off along it, then put back at the
      // tick (his slice had run) — a hop back on every new errand. People the
      // slice leaves alone (crews on orders) are drawn as before.
      const x = p.pos.x, y = p.pos.y, path = p.path;
      ambientPerson(w, rng, p, minutes, traffic, meeting, awaited);
      if (p.pos.x !== x || p.pos.y !== y || p.path !== path) earlySteps.set(p, { x, y });
      continue;
    }
    ambientPerson(w, rng, p, minutes, traffic, meeting, awaited);
  }
}

/** One person's ambient minute (everyone not on an order). */
function ambientPerson(w: WorldState, rng: Rng, p: Person, minutes: number, traffic: ReturnType<typeof trafficContext>,
  meeting: ReturnType<typeof specialistParticipants>, awaited: ReturnType<typeof specialistVisitTargets>): void {
  {
    if (p.orderId != null || p.streetOrder != null) return; // already handled by an order system
    if (p.fbiAssignment) return;
    const continuous = !!w.options.continuousTime;
    const night = continuous && isNight(w.minute);
    // Walking to a street tram that stands for him, or aboard (tramRiding.ts).
    if (p.tram) { if (p.tram.phase === 'boarding' && p.dest) stepPerson(p, minutes, traffic); return; }
    if (meeting.has(p.id)) return;
    if (awaited.has(p.id)) {
      // Someone is coming to see them (the original's meeting orders bring both
      // together): finish crossing any road, then wait on the pavement. A
      // moving beat officer could not be caught, and a walker stopped on a
      // crossing would hold up the visitor's car for good.
      const next = p.path[0];
      const midCrossing = !!p.dest && !!next?.cross && Math.hypot(next.x - p.pos.x, next.y - p.pos.y) < next.cross - 0.75;
      if (midCrossing) stepPerson(p, minutes, traffic);
      else if (p.dest) clearDestination(p);
      return;
    }
    if (continuous && homeAtNight(w, p, night, minutes, traffic)) return;
    if (p.buildingId != null && p.role !== 'police' && p.role !== 'fbi' && p.role !== 'snitch' && p.role !== 'reporter') {
      // Owners and managers stay at their premises.
      return;
    }

    switch (p.role) {
      case 'citizen':
      case 'snitch': {
        if (!p.dest) {
          // The original's civilians are nearly always walking during the day.
          // In an RTS night most go home; only the small night-life group gets
          // a destination in the evening.
          const restart = night ? p.role === 'snitch' ? .18 : .1 : CIVILIAN_RESTART;
          if (rng.chance(Math.min(1, restart * minutes))) {
            if (night && nightOut(w, p)) goToNightVenue(w, p);
            else if (!night) wanderTo(w, rng, p, 5);
          }
        } else {
          if (stepPerson(p, minutes, traffic) && night) enterNightVenue(w, p);
        }
        break;
      }
      case 'reporter': {
        // Editors remain at the newspaper; its other reporters work on the street.
        const premises = p.buildingId != null ? w.buildings[p.buildingId] : null;
        if (premises?.ownerPersonId === p.id) break;
        // A field reporter works the street; he is not inside the newspaper.
        if (premises) p.buildingId = null;
        if (p.dest) stepPerson(p, minutes, traffic);
        else if (!night && rng.chance(.08 * minutes)) wanderTo(w, rng, p, 2);
        // A stationary field reporter occasionally takes a photograph. This
        // visual cue uses no random draw and does not alter travel or reporting.
        if(!p.dest && (w.minute+p.id)%17===0)presentPhoto(w,p);
        break;
      }
      case 'judge':
      case 'da':
      case 'mayor':
      case 'policeChief':
      case 'fbiHead': {
        // Civic officials leave the street and go home overnight. Their
        // legal/political work still uses the existing simulation systems.
        if (p.dest) stepPerson(p, minutes, traffic);
        else if (!night && rng.chance(.03 * minutes)) wanderTo(w, rng, p, 1);
        break;
      }
      case 'police': {
        // Police do not run a random ambient walk. They stay at their home or
        // station until a witnessed crime gives them an emergencyResponse;
        // that response is the only route that puts an officer back in a car.
        if (p.dest) stepPerson(p, minutes, traffic);
        break;
      }
      case 'fbi': {
        if (p.dest) {
          stepPerson(p, minutes, traffic);
        } else if (!night && rng.chance(0.04 * minutes)) {
          wanderTo(w, rng, p, 4);
        }
        break;
      }
      case 'hood':
      case 'lieutenant':
      case 'boss':
      case 'accountant':
      case 'lawyer': {
        // Gang members between jobs simply walk home.
        if (p.dest && stepPerson(p, minutes, traffic) && (p.role === 'lawyer' || p.role === 'accountant')) {
          const home = allBuildings(w).find(b => b.ownerGangId === p.gangId && b.isHQ && dist(buildingDoor(w, b), p.pos) < 24);
          if (home) { p.inVehicle = false; p.buildingId = home.id; p.pos = { ...w.lots[home.lotId].center }; }
        }
        break;
      }
      default:
        if (p.dest) stepPerson(p, minutes, traffic);
        break;
    }
  }
}

/** Restart chances per simulated minute: civilians ~0.33 min (≈2 s real),
 * officers ~1 min. */
const CIVILIAN_RESTART = 3;
const isNight = (minute: number) => {
  const hour = hourOfDay(minute, true);
  return hour < 6 || hour >= 20;
};

const NIGHT_HOME_ROLES = new Set<PersonRole>([
  'citizen', 'snitch', 'police', 'policeChief', 'mayor', 'judge', 'da', 'fbiHead', 'fbi', 'reporter',
]);
const NIGHTLIFE_TYPES = new Set([
  'cafe', 'restaurant', 'poolHall', 'hotelSmall', 'hotelLarge', 'danceStudio', 'speakeasy',
  'casino', 'cardGames', 'diceGame', 'gamblingDen', 'prizeFight', 'whorehouse',
]);
const residentialCache = new WeakMap<WorldState, Building[]>();
const nightlifeCache = new WeakMap<WorldState, Building[]>();
const policeStationCache = new WeakMap<WorldState, Building | null>();

function residential(b: Building): boolean {
  return (b.cls === 'residential' || b.cls === 'tenement') && b.state !== 'destroyed';
}

/** Assigns an old save a deterministic home without changing its first-day layout. */
function homeFor(w: WorldState, p: Person): Building | undefined {
  const saved = p.homeBuildingId == null ? undefined : w.buildings[p.homeBuildingId];
  if (saved && residential(saved)) return saved;
  let homes = residentialCache.get(w);
  if (!homes) {
    homes = allBuildings(w).filter(residential).sort((a, b) => a.id - b.id);
    residentialCache.set(w, homes);
  }
  if (!homes.length) return undefined;
  const selected = homes[hash32(p.id * 2654435761) % homes.length];
  const home = residential(selected) ? selected : homes.find(residential);
  if (!home) return undefined;
  p.homeBuildingId = home.id;
  return home;
}

function nightOut(w: WorldState, p: Person): boolean {
  const day = Math.floor(w.minute / FULL_DAY_MINUTES);
  const threshold = p.role === 'snitch' ? 32 : p.role === 'police' ? 8 : 10;
  return hash32(p.id * 2246822519 + day * 3266489917) % 100 < threshold;
}

function nightVenue(w: WorldState, p: Person): Building | undefined {
  let venues = nightlifeCache.get(w);
  if (!venues) {
    venues = allBuildings(w).filter(b => NIGHTLIFE_TYPES.has(b.typeId)).sort((a, b) => a.id - b.id);
    nightlifeCache.set(w, venues);
  }
  if (!venues.length) return undefined;
  const day = Math.floor(w.minute / FULL_DAY_MINUTES);
  const start = hash32(p.id * 668265263 + day * 374761393) % venues.length;
  for (let i = 0; i < venues.length; i++) {
    const venue = venues[(start + i) % venues.length];
    if (venue.state === 'trading') return venue;
  }
  return undefined;
}

function policeStation(w: WorldState): Building | undefined {
  let station = policeStationCache.get(w);
  if (station === undefined) {
    station = allBuildings(w).find(b => b.typeId === 'policeHQ' && b.state !== 'destroyed') ?? null;
    policeStationCache.set(w, station);
  }
  return station ?? undefined;
}

function enterHome(w: WorldState, p: Person, home: Building): void {
  clearDestination(p);
  p.buildingId = home.id;
  p.inVehicle = false;
  p.pos = { ...w.lots[home.lotId].center };
}

function leaveHome(w: WorldState, p: Person, home: Building): void {
  if (p.buildingId !== home.id) return;
  p.buildingId = null;
  p.pos = buildingDoor(w, home);
}

function enterBuilding(w: WorldState, p: Person, building: Building): void {
  clearDestination(p);
  p.buildingId = building.id;
  p.inVehicle = false;
  p.pos = { ...w.lots[building.lotId].center };
}

function goToPoliceStation(w: WorldState, p: Person, station: Building, minutes: number,
  traffic: ReturnType<typeof trafficContext>): boolean {
  if (p.buildingId === station.id) return true;
  if (p.inVehicle) alight(w, p);
  if (p.buildingId != null) {
    const previous = w.buildings[p.buildingId];
    if (previous) p.pos = buildingDoor(w, previous);
    p.buildingId = null;
  }
  const target = buildingDoor(w, station);
  if (!p.dest || dist(p.dest, target) > 1) {
    clearDestination(p);
    setDestination(w, p, target);
  }
  if (stepPerson(p, minutes, traffic)) enterBuilding(w, p, station);
  return true;
}

function goHome(w: WorldState, p: Person, home: Building, minutes: number, traffic: ReturnType<typeof trafficContext>): boolean {
  if (p.buildingId === home.id) return true;
  const target = buildingDoor(w, home);
  const official = p.role === 'mayor' || p.role === 'policeChief' || p.role === 'judge' || p.role === 'da' || p.role === 'fbiHead';
  // Officials make the longer evening commute by car. This is deliberately a
  // lightweight service trip (no permanent fleet entry); the existing vehicle
  // route, traffic and renderer still show a real period car on the street.
  if (p.inVehicle && p.dest) {
    if (stepPerson(p, minutes, traffic)) { p.inVehicle = false; enterHome(w, p, home); }
    return true;
  }
  if (p.inVehicle) p.inVehicle = false;
  if (!p.dest || dist(p.dest, target) > 1) {
    clearDestination(p);
    if (official && dist(p.pos, target) > DRIVE_MIN_DISTANCE) p.inVehicle = true;
    setDestination(w, p, target);
  }
  if (stepPerson(p, minutes, traffic)) { p.inVehicle = false; enterHome(w, p, home); }
  return true;
}

function goToNightVenue(w: WorldState, p: Person): void {
  const venue = nightVenue(w, p);
  if (!venue) return;
  if (p.buildingId != null) p.buildingId = null;
  if (p.inVehicle) alight(w, p);
  clearDestination(p);
  setDestination(w, p, buildingDoor(w, venue));
}

function enterNightVenue(w: WorldState, p: Person): void {
  const venue = nightVenue(w, p);
  if (venue && dist(p.pos, buildingDoor(w, venue)) < 5) {
    clearDestination(p);
    p.buildingId = venue.id;
    p.pos = { ...w.lots[venue.lotId].center };
  }
}

/** Returns true when the night schedule owns this person's ambient movement. */
function homeAtNight(w: WorldState, p: Person, night: boolean, minutes: number,
  traffic: ReturnType<typeof trafficContext>): boolean {
  if (!NIGHT_HOME_ROLES.has(p.role)) return false;
  const home = homeFor(w, p);
  const official = p.role === 'mayor' || p.role === 'policeChief' || p.role === 'judge' || p.role === 'da' || p.role === 'fbiHead';
  if (!home) return false;
  const station = p.role === 'police' ? policeStation(w) : undefined;
  if (!night) {
    // Finish a long official car ride even if dawn arrives before the car
    // reaches its kerb; otherwise the morning role pass would leave the car
    // flag stranded on the road.
    if (official && p.inVehicle && p.dest) return goHome(w, p, home, minutes, traffic);
    if (p.buildingId === home.id) leaveHome(w, p, home);
    else if (station && p.buildingId === station.id) leaveHome(w, p, station);
    else if (p.role === 'citizen' && p.buildingId != null) {
      // A citizen's only other indoor location is last night's venue.
      const venue = w.buildings[p.buildingId];
      p.buildingId = null;
      p.pos = venue ? buildingDoor(w, venue) : buildingDoor(w, home);
    }
    return false;
  }

  if (station && nightOut(w, p)) return goToPoliceStation(w, p, station, minutes, traffic);
  const social = p.role === 'citizen' || p.role === 'snitch';
  if (social && nightOut(w, p)) {
    if (p.buildingId != null && p.buildingId !== home.id) return true;
    if (p.buildingId === home.id) leaveHome(w, p, home);
    const venue = nightVenue(w, p);
    if (!venue) return goHome(w, p, home, minutes, traffic);
    if (p.buildingId == null && venue && (!p.dest || dist(p.dest, buildingDoor(w, venue)) > 1)) goToNightVenue(w, p);
    return false;
  }
  if (p.buildingId != null && p.buildingId !== home.id) p.buildingId = null;
  return goHome(w, p, home, minutes, traffic);
}

/** How strongly a block draws errands (0x606840 reads block+104). That byte is
 * the land value (0x537D70 copies it from the generator grid), so the original
 * city uses its own; elsewhere trading businesses stand in for it. */
function tradingOn(w: WorldState, blk: Block): number {
  if (blk.original) return blk.original.landValue;
  let n = 0;
  for (const id of blk.lotIds) if (w.buildings[w.lots[id].buildingId]?.state === 'trading') n++;
  return n;
}

function wanderTo(w: WorldState, rng: Rng, p: Person, radiusBlocks: number, night = false): void {
  const gx = Math.floor(p.pos.x / CELL);
  const gy = Math.floor(p.pos.y / CELL);
  // Up to four tries for a block with a pavement (a failed pick used to cost a
  // whole extra wait); of the first two found, the busier one wins.
  let blk: Block | undefined, found = 0;
  for (let attempt = 0; attempt < 4 && found < 2; attempt++) {
    const nx = Math.max(0, Math.min(w.gridW - 1, gx + rng.int(-radiusBlocks, radiusBlocks)));
    const ny = Math.max(0, Math.min(w.gridH - 1, gy + rng.int(-radiusBlocks, radiusBlocks)));
    const candidate = cityBlockAt(w, nx, ny);
    if (!candidate || !hasFootway(candidate)) continue;
    found++;
    const appeal = (block: Block) => {
      if (!night) return tradingOn(w, block);
      // Evening traffic gathers around bars, hotels and protected businesses.
      let value = block.original ? block.original.landValue / 4 : 0;
      for (const lotId of block.lotIds) {
        const site = w.buildings[w.lots[lotId].buildingId];
        if (!site || site.state !== 'trading') continue;
        if (['poolHall', 'cafe', 'hotelSmall', 'hotelLarge', 'restaurant', 'speakeasy', 'casino'].includes(site.typeId)) value += 40;
        else if (site.cls === 'tenement') value += 4;
      }
      return value;
    };
    if (!blk || appeal(candidate) > appeal(blk)) blk = candidate;
  }
  if (!blk) return;
  if (w.cityLayout) { setDestination(w, p, blockPavement(blk, rng.int(0, 100000))); return; }
  // Aim for the pavement around the block rather than the middle of it: the
  // middle is where the buildings are, and a figure standing in one is a
  // figure nobody can see or click on.
  const along = rng.range(-BLOCK_SIZE / 2, BLOCK_SIZE / 2);
  const side = rng.range(-1, 1) < 0 ? -1 : 1;
  const out = (BLOCK_SIZE / 2 + 1.6) * side;
  const lengthways = (p.id & 2) === 0;
  setDestination(
    w,
    p,
    lengthways
      ? { x: blk.center.x + along, y: blk.center.y + out }
      : { x: blk.center.x + out, y: blk.center.y + along },
  );
}

import { blockPavement, cityBlockAt, hasFootway } from '../cityLayout';
