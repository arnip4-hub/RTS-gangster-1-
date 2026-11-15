import { WAREHOUSE_CASH_CAP, WAREHOUSE_GOODS_CAP } from './constants';
import { BUILDING_BY_ID } from './data/buildings';
import type { Building, FreightKind, GoodsKind } from './types';

export const legalStock = (b: Building, kind: 'meat' | 'ice'): number => b.legalStock?.[kind] ?? 0;
export const freightStock = (b: Building, kind: FreightKind): number =>
  kind === 'meat' || kind === 'ice' ? legalStock(b, kind) : b.stock[kind];
export function changeFreightStock(b: Building, kind: FreightKind, amount: number): void {
  if (kind === 'meat' || kind === 'ice') {
    b.legalStock ??= { meat: 0, ice: 0 };
    b.legalStock[kind] += amount;
  } else b.stock[kind] += amount;
}

/** The manual gives warehouses one 300-case liquor/stolen store, plus 15
 * counterfeit cases. Older overfull stores retain their goods but cannot add. */
export function warehouseRoom(b: Building, kind: GoodsKind): number {
  if (b.typeId === 'iceHouse') return kind === 'liquor' ? Math.max(0, 450 - b.stock.liquor) : 0;
  return Math.max(0, kind === 'counterfeit' ? WAREHOUSE_CASH_CAP - b.stock.counterfeit
    : WAREHOUSE_GOODS_CAP - b.stock.liquor - b.stock.stolen);
}
export function isStorageSite(b: Building): boolean {
  return b.typeId === 'warehouse' || b.typeId === 'haulageCompany' || b.typeId === 'iceHouse';
}
export function goodsRetailer(b: Building, kind: FreightKind): boolean {
  if (isStorageSite(b) || b.state !== 'trading') return false;
  if (kind === 'meat') return b.typeId === 'butchers' || b.typeId === 'restaurant';
  if (kind === 'ice') return ['butchers', 'restaurant', 'cafe', 'jazzClub', 'speakeasy'].includes(b.typeId);
  if (kind === 'liquor') return b.typeId === 'speakeasy' || b.typeId === 'jazzClub';
  return b.cls !== 'illegal' && !!BUILDING_BY_ID[b.typeId]?.stores?.includes(kind);
}
/** Retail buffers and factory storage are remake tuning, separate from the
 * manual's warehouse capacity. A warehouse is never a retail destination. */
export function goodsRoom(b: Building, kind: FreightKind): number {
  if (kind === 'meat' || kind === 'ice') {
    if (isStorageSite(b)) return b.typeId === 'iceHouse' ? 0
      : Math.max(0, 300 - legalStock(b, kind));
    return goodsRetailer(b, kind) ? Math.max(0, 80 - legalStock(b, kind)) : 0;
  }
  if (isStorageSite(b)) return warehouseRoom(b, kind);
  if (!goodsRetailer(b, kind)) return 0;
  return Math.max(0, (kind === 'liquor' ? 120 : kind === 'stolen' ? 60 : 6) - b.stock[kind]);
}
