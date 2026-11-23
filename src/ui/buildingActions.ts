import { selectableOrderPerson, selectableOrderSite } from '../app/orderSelection';
import { defaultOptions } from '../sim/api';
import { ORDERS } from '../sim/constants';
import { knownShopkeeper, buildingMapIntel } from '../sim/mapIntel';
import type { ID, OrderOptions, OrderType, WorldState } from '../sim/types';

export type BuildingActionGroup = 'property' | 'protection' | 'people' | 'crime';

export interface BuildingAction {
  type: OrderType;
  label: string;
  group: BuildingActionGroup;
  /** The ordinary order card still handles costs, crews and final confirmation. */
  opts?: Partial<OrderOptions>;
  personId?: ID;
}

const SITE_ACTIONS: readonly BuildingAction[] = [
  { type: 'buyPremises', label: 'Buy premises', group: 'property' },
  { type: 'setUpBusiness', label: 'Set up business', group: 'property' },
  { type: 'runBusiness', label: 'Assign manager', group: 'property' },
  { type: 'export', label: 'Export goods', group: 'property' },
  { type: 'donate', label: 'Make donation', group: 'property' },
  { type: 'extort', label: 'Demand protection', group: 'protection' },
  { type: 'collectProtection', label: 'Collect payment', group: 'protection' },
  { type: 'adjustProtection', label: 'Change payment', group: 'protection' },
  { type: 'intimidate', label: 'Intimidate refuser', group: 'protection' },
  { type: 'guardBusiness', label: 'Guard business', group: 'people' },
  { type: 'explore', label: 'Investigate site', group: 'people' },
  { type: 'patrol', label: 'Patrol nearby', group: 'people' },
  { type: 'recruit', label: 'Recruit hoods', group: 'people', opts: { recruitKind: 'hood' } },
  { type: 'recruit', label: 'Recruit accountant', group: 'people', opts: { recruitKind: 'accountant' } },
  { type: 'recruit', label: 'Recruit lawyer', group: 'people', opts: { recruitKind: 'lawyer' } },
  { type: 'raid', label: 'Raid', group: 'crime' },
  { type: 'smashUp', label: 'Smash up', group: 'crime' },
  { type: 'torch', label: 'Torch', group: 'crime' },
  { type: 'bomb', label: 'Bomb', group: 'crime' },
  { type: 'ambush', label: 'Ambush nearby', group: 'crime' },
];

/** Action availability comes from the same target rules as the Organizer/map,
 * never from extra knowledge of a rival's hidden owner or illegal premises. */
export function buildingActions(w: WorldState, gangId: ID, buildingId: ID): BuildingAction[] {
  const building = w.buildings[buildingId];
  if (!building || !w.gangs[gangId] || !buildingMapIntel(building, gangId).siteKnown) return [];
  const mine = building.ownerGangId === gangId;
  const actions = SITE_ACTIONS.filter(action => {
    if (mine && action.group === 'crime') return false;
    // Do not advertise purchase/ownership information about unknown rivals.
    if (action.type === 'buyPremises' && (building.knowledge[gangId] ?? 0) < 2) return false;
    if (action.type === 'setUpBusiness' && (building.discovered || building.fbiClosedWeek != null)) return false;
    const target = ORDERS[action.type].target;
    return (target === 'building' || target === 'area') &&
      selectableOrderSite(w, gangId, { type: action.type, opts: defaultOptions(action.opts) }, building);
  });
  const shopkeeper = knownShopkeeper(w, building, gangId);
  if (shopkeeper) for (const [type, label, group] of [
    ['bribe', 'Bribe proprietor', 'protection'],
    ['assault', 'Assault proprietor', 'crime'],
    ['kidnap', 'Kidnap proprietor', 'crime'],
    ['kill', 'Kill proprietor', 'crime'],
  ] as const) {
    if (selectableOrderPerson(w, gangId, type, shopkeeper))
      actions.push({ type, label, group, personId: shopkeeper.id });
  }
  return actions;
}
