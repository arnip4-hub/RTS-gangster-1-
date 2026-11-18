import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { createWorld } from '../src/sim/citygen';
import { recruitQuota, replenishRecruitPool } from '../src/sim/recruitPool';

describe('generated city recruitment venues', () => {
  it('stocks each accountant and lawyer venue to its local quota and refills hires weekly', () => {
    const { world, rng } = createWorld({ ...defaultGameOptions(), citySize: 10, seed: 404 });
    const sites = Object.values(world.buildings).filter((b) => {
      const quota = recruitQuota(b);
      const serving = b.state === 'trading' || (b.cls === 'municipal' && b.state !== 'destroyed');
      return quota && serving;
    });
    const experts = (buildingId: number, role: string) => Object.values(world.people).filter((p) =>
      p.buildingId === buildingId && p.role === role && p.gangId == null && p.employedBy == null && p.status === 'active');

    for (const site of sites) {
      const quota = recruitQuota(site)!;
      expect(experts(site.id, quota.role), site.typeId).toHaveLength(quota.count);
    }

    const accountancy = sites.find((b) => b.typeId === 'accountancy')!;
    const quota = recruitQuota(accountancy)!;
    expect(quota.role).toBe('accountant');
    experts(accountancy.id, quota.role)[0].gangId = 1;
    expect(replenishRecruitPool(world, rng)).toBe(1);
    expect(experts(accountancy.id, quota.role)).toHaveLength(quota.count);
    expect(replenishRecruitPool(world, rng)).toBe(0);
  });
});
