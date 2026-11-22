import { ORDERS } from './constants';
import { purchasablePremisesType } from './premises';
import type { Building, ID, Order, OrderOptions, OrderType, WorldState } from './types';
import { buildingDoor, buildingsOfBlock, typeOf } from './world';

/** Area targeting and route preparation are independent of order execution. */
/** Expand a player/AI selection into the concrete list of buildings to work. */
export function expandTargets(
  w: WorldState,
  gangId: ID,
  type: OrderType,
  blockIds: ID[],
  buildingIds: ID[],
  opts?: Pick<OrderOptions, 'recruitKind'>,
): ID[] {
  const def = ORDERS[type];
  if (def.target === 'building') return buildingIds.slice(0, 1);
  if (def.target !== 'area') return [];

  const out: ID[] = [];
  const seen = new Set<ID>(buildingIds);
  for (const id of buildingIds) out.push(id);

  for (const blockId of blockIds) {
    const blk = w.blocks[blockId];
    if (!blk) continue;
    for (const b of buildingsOfBlock(w, blk)) {
      if (seen.has(b.id)) continue;
      if (!isValidAreaTarget(w, gangId, type, b, opts)) continue;
      seen.add(b.id);
      out.push(b.id);
    }
  }
  return out;
}

export function isValidAreaTarget(
  _w: WorldState,
  gangId: ID,
  type: OrderType,
  b: Building,
  opts?: Pick<OrderOptions, 'recruitKind'>,
): boolean {
  if (b.state === 'destroyed') return false;
  switch (type) {
    case 'extort':
      return (
        b.cls !== 'empty' && purchasablePremisesType(b) &&
        !b.protection &&
        b.ownerGangId == null
      );
    case 'collectProtection':
      return b.protection?.gangId === gangId;
    case 'adjustProtection':
      return b.protection?.gangId === gangId;
    case 'intimidate':
      if (b.protection?.gangId === gangId) return b.protection.refusing;
      return !!b.extortRefusedBy?.includes(gangId) && isValidAreaTarget(_w, gangId, 'extort', b);
    case 'explore':
      return b.cls !== 'empty';
    case 'recruit': {
      // Hoods, accountants and lawyers each keep their own haunts.
      const kind = typeOf(b)?.recruit;
      return !!kind && (!opts?.recruitKind || kind === opts.recruitKind);
    }
    case 'patrol':
    case 'ambush':
      return b.lotId >= 0;
    default:
      return true;
  }
}

/** Standing area jobs accept both whole blocks and individual map/Clipboard sites.
 * Derive the route without rewriting the saved selection (which would expand a
 * deliberately excluded property when the card is edited or repeated).
 */
export function standingBlocks(w: WorldState, order: Order): ID[] {
  return [...new Set([...order.targetBlockIds, ...order.targetBuildingIds
    .map(id => w.buildings[id]?.blockId).filter((id): id is ID => id != null)]
    .map(id => w.blocks[id]?.layout?.mergedInto ?? id))].filter(id => !!w.blocks[id]);
}

/** Extortion sites have no dependencies, so keep the player's first stop and
 * then send the crew to the closest remaining business. Large selections in
 * click order made a lieutenant criss-cross the city between every visit. */
export function orderExtortionStops(w: WorldState, order: Order): void {
  if (order.type !== 'extort' || order.targetBuildingIds.length < 3) return;
  const first = w.buildings[order.targetBuildingIds[0]];
  if (!first) return;
  let current = buildingDoor(w, first);
  const remaining = order.targetBuildingIds.slice(1);
  const route: ID[] = [first.id];
  while (remaining.length) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const building = w.buildings[remaining[i]];
      if (!building) continue;
      const door = buildingDoor(w, building);
      // Manhattan distance is a good fit for the city's orthogonal street grid.
      const distance = Math.abs(door.x - current.x) + Math.abs(door.y - current.y);
      if (distance < bestDistance || distance === bestDistance && remaining[i] < remaining[best]) {
        best = i;
        bestDistance = distance;
      }
    }
    const [id] = remaining.splice(best, 1);
    route.push(id);
    const building = w.buildings[id];
    if (building) current = buildingDoor(w, building);
  }
  order.targetBuildingIds = route;
}

