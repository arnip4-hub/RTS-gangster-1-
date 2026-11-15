import { CELL, WALK_SPEED, movementScale } from './constants';
import { campaignMinute } from './calendar';
import { peopleList } from './entityLists';
import { walkRoute, clearDestination } from './movement';
import { cityTramLines, tramRoute, tramsAt, TRAM_SPEED, TRAM_TRACK, type TramLine } from './trams';
import type { Person, TramTrip, Vec2, WorldState } from './types';
import { dist } from './world';

const MIN_WALK = 350;
const MAX_WAIT = 120;
const BOARD_REACH = 5;
const MAX_RIDERS = 40;
const OVERRUN = CELL / 10;

interface Stop { pos: Vec2; along: number; tangent: Vec2 }
const stopsCache = new WeakMap<TramLine, Stop[]>();

function stops(line: TramLine, original: boolean): Stop[] {
  const cached = stopsCache.get(line);
  if (cached) return cached;
  const points = line.points, out: Stop[] = [];
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = dist(a, b);
    if (length < 1) continue;
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    if (original) {
      // Informal kerbside stops, a short walk apart on the original's avenues.
      const first = Math.ceil((along + CELL) / (2 * CELL)) * 2 * CELL;
      for (let at = first; at < along + length - CELL; at += 2 * CELL) {
        const fraction = (at - along) / length;
        out.push({ pos: { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction },
          along: at, tangent });
      }
    } else {
      for (const stop of line.stops) if (dist(stop.pos, b) < .1)
        out.push({ pos: { ...b }, along: along + length, tangent });
    }
    along += length;
  }
  stopsCache.set(line, out);
  return out;
}

function platform(stop: Stop, outbound: boolean): Vec2 {
  const side = outbound ? 1 : -1;
  return { x: stop.pos.x - stop.tangent.y * (TRAM_TRACK + 1.6) * side,
    y: stop.pos.y + stop.tangent.x * (TRAM_TRACK + 1.6) * side };
}

function loopPosition(length: number, along: number, outbound: boolean): number {
  return outbound ? OVERRUN + along : length + 2 * OVERRUN + OVERRUN + length - along;
}

function forward(from: number, to: number, loop: number): number {
  return ((to - from) % loop + loop) % loop;
}

function nearest(stopsOnLine: Stop[], point: Vec2): Stop[] {
  return [...stopsOnLine].sort((a, b) => dist(a.pos, point) - dist(b.pos, point)).slice(0, 3);
}

/** Plan only trips that save meaningful time after access, waiting and the final walk. */
export function planTramTrip(w: WorldState, p: Person, to: Vec2): TramTrip | undefined {
  if (!w.options.continuousTime || !w.cityLayout || p.inVehicle || p.buildingId != null ||
      p.orderId != null || p.streetOrder && p.streetOrder.type !== 'goTo' ||
      (p.role === 'lawyer' || p.role === 'accountant') && p.streetOrder?.type !== 'goTo' ||
      p.emergencyResponse || p.fbiAssignment || p.tram ||
      p.status !== 'active' || dist(p.pos, to) < MIN_WALK) return;
  const speed = TRAM_SPEED * movementScale(true), walking = WALK_SPEED * movementScale(true);
  const walkTime = dist(p.pos, to) / walking;
  const active = tramsAt(w, w.minute);
  let best: {trip: TramTrip; time: number} | undefined;
  cityTramLines(w).forEach((line, li) => {
    const lineStops = stops(line, !!w.cityLayout?.original);
    if (lineStops.length < 2) return;
    const route = tramRoute(line);
    for (const board of nearest(lineStops, p.pos)) for (const drop of nearest(lineStops, to)) {
      if (Math.abs(drop.along - board.along) < 200) continue;
      const outbound = drop.along > board.along;
      const boardPos = platform(board, outbound), alightPos = platform(drop, outbound);
      const boardLoop = loopPosition(route.length, board.along, outbound);
      const dropLoop = loopPosition(route.length, drop.along, outbound);
      const access = dist(p.pos, boardPos) / walking;
      let wait = Infinity;
      for (const tram of active) if (tram.line === li && tram.outbound === outbound) {
        const until = forward(tram.loop, boardLoop, route.loop) / speed;
        const remaining = until >= access ? until - access : until + route.loop / speed - access;
        if (remaining < wait) wait = remaining;
      }
      if (wait > MAX_WAIT) continue;
      // Stops between the two points also cost time in compact cities.
      const dwell = line.stops.length ? Math.abs(drop.along - board.along) / route.length * line.stops.length * 6 : 0;
      const time = access + wait + Math.abs(drop.along - board.along) / speed + dwell + dist(alightPos, to) / walking;
      if (time >= walkTime * .82 || time >= (best?.time ?? Infinity)) continue;
      best = { time, trip: { line: li, boardLoop, dropLoop, outbound, boardPos, alightPos,
        finalDest: { ...to }, phase: 'approaching', since: campaignMinute(w) } };
    }
  });
  return best?.trip;
}

/** The ambient pass walks to the platform; this pass boards and follows the real tram. */
export function tickTramCommutes(w: WorldState): void {
  const travellers: Person[] = [];
  for (const p of peopleList(w)) if (p.tramTrip) travellers.push(p);
  if (!travellers.length) return;
  const trams = tramsAt(w, w.minute), lines = cityTramLines(w);
  const aboard = trams.map(() => 0);
  for (const p of travellers) if (p.tramTrip?.phase === 'riding' && p.tramTrip.tram != null) aboard[p.tramTrip.tram]++;
  for (const p of travellers) {
    const trip = p.tramTrip;
    if (!trip) continue;
    const line = lines[trip.line], route = line && tramRoute(line);
    if (!route || p.status !== 'active' || p.orderId != null ||
        p.streetOrder && p.streetOrder.type !== 'goTo' || p.inVehicle || p.emergencyResponse) {
      delete p.tramTrip;
      if (trip.phase === 'riding' && trip.tram != null && trams[trip.tram])
        p.pos = { x: trams[trip.tram].x, y: trams[trip.tram].y };
      if (p.dest && dist(p.dest, trip.boardPos) < 1) clearDestination(p);
      continue;
    }
    if (trip.phase === 'approaching') {
      if (dist(p.pos, trip.boardPos) <= BOARD_REACH && !p.dest) {
        trip.phase = 'waiting'; trip.waitSince = campaignMinute(w);
      }
      else if (!p.dest) { cancelTramTrip(w, p); continue; }
    }
    if (trip.phase === 'waiting') {
      if (campaignMinute(w) - (trip.waitSince ?? trip.since) > MAX_WAIT) {
        cancelTramTrip(w, p); continue;
      }
      const speed = TRAM_SPEED * movementScale(true);
      const k = trams.findIndex((t, i) => t.line === trip.line && t.outbound === trip.outbound &&
        aboard[i] < MAX_RIDERS && Math.min(forward(t.loop, trip.boardLoop, route.loop),
          forward(trip.boardLoop, t.loop, route.loop)) < speed * .65);
      if (k < 0) continue;
      trip.phase = 'riding'; trip.tram = k; trip.lastLoop = trams[k].loop;
      trip.remaining = forward(trams[k].loop, trip.dropLoop, route.loop);
      clearDestination(p); p.pos = { x: trams[k].x, y: trams[k].y }; aboard[k]++;
      continue;
    }
    if (trip.phase === 'riding' && trip.tram != null) {
      const tram = trams[trip.tram];
      if (!tram || tram.line !== trip.line) { cancelTramTrip(w, p); continue; }
      const moved = forward(trip.lastLoop ?? tram.loop, tram.loop, route.loop);
      trip.remaining = Math.max(0, (trip.remaining ?? 0) - moved);
      trip.lastLoop = tram.loop;
      p.pos = { x: tram.x, y: tram.y };
      if (trip.remaining > 0) continue;
      p.pos = { ...trip.alightPos };
      delete p.tramTrip;
      p.dest = { ...trip.finalDest };
      p.path = walkRoute(p.pos, p.dest, p.id, w);
    }
  }
}

export function cancelTramTrip(w: WorldState, p: Person): void {
  const trip = p.tramTrip;
  if (!trip) return;
  delete p.tramTrip;
  if (trip.phase === 'riding') {
    const tram = trip.tram == null ? undefined : tramsAt(w, w.minute)[trip.tram];
    if (tram) p.pos = { x: tram.x, y: tram.y };
  }
  p.dest = { ...trip.finalDest };
  p.path = walkRoute(p.pos, p.dest, p.id, w);
}
