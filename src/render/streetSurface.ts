import { blockRect, cityBlockAt } from '../sim/cityLayout';
import { BLOCK_SIZE, CELL } from '../sim/constants';
import type { ID, WorldState } from '../sim/types';
import { riverBank, riverCrossing } from './riverBanks';
import { KERB_H, PAVE_W, paveWidth, smoothstep } from './util';

const SLAB_HALF = BLOCK_SIZE / 2 + PAVE_W;

const bankCache = new WeakMap<WorldState, Map<ID, { x: number; y: number; w: number; h: number }[]>>();

/** Pavement height with a short visual step at the kerb; movement/collision remain in simulation metres. */
export function streetSurfaceHeight(w: WorldState, x: number, z: number): number {
  if (w.cityLayout) {
    const b = cityBlockAt(w, Math.floor(x / CELL), Math.floor(z / CELL));
    if (b && (b.layout?.use === 'water' || riverCrossing(b))) {
      // On a river block (or under a crossing) only the banks are raised.
      let banks = bankCache.get(w);
      if (!banks) bankCache.set(w, banks = new Map());
      let rects = banks.get(b.id);
      if (!rects) banks.set(b.id, rects = riverBank(w, b).banks);
      for (const r of rects) {
        const inside = Math.min(x - r.x, r.x + r.w - x, z - r.y, r.y + r.h - z);
        if (inside > -.16) return KERB_H * smoothstep(-.16, .16, inside);
      }
      return 0;
    }
    if (!b) return 0;
    const r = blockRect(b), pave = paveWidth(w);
    const inside = Math.min(x - r.x + pave, r.x + r.w + pave - x, z - r.y + pave, r.y + r.h + pave - z);
    return KERB_H * smoothstep(-.16, .16, inside);
  }
  const lx = ((x % CELL) + CELL) % CELL - CELL / 2;
  const lz = ((z % CELL) + CELL) % CELL - CELL / 2;
  const inside = SLAB_HALF - Math.max(Math.abs(lx), Math.abs(lz));
  return KERB_H * smoothstep(-.16, .16, inside);
}

