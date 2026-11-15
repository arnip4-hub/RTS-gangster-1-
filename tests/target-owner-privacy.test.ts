import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { orderPeopleBySite, orderPersonAtSite, selectableOrderPerson } from '../src/app/orderSelection';
import { useGame } from '../src/app/store';
import { defaultOptions } from '../src/sim/api';
import { knownShopkeeper } from '../src/sim/mapIntel';
import { Sim } from '../src/sim/sim';
import { JobCardPanel } from '../src/ui/JobCardPanel';

// Server rendering normally reads Zustand's initial snapshot. Read the live
// fixture instead so the markup assertion exercises the actual job card.
vi.mock('../src/app/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/app/store')>();
  const useGame = Object.assign((selector: (state: ReturnType<typeof actual.useGame.getState>) => unknown) =>
    selector(actual.useGame.getState()), actual.useGame);
  return { ...actual, useGame };
});

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10, startHoods: 8 });
  const w = sim.world, gang = sim.playerGang;
  const site = Object.values(w.buildings).find(b => b.cls === 'commercial' && b.ownerPersonId != null && b.ownerGangId == null)!;
  const seller = w.people[site.ownerPersonId!];
  seller.name = 'Former Shopkeeper'; seller.status = 'active'; seller.buildingId = site.id;
  site.managerId = null; site.protection = null; site.knowledge[gang.id] = 0;
  for (const p of Object.values(w.people)) if (p.id !== seller.id && p.buildingId === site.id) p.buildingId = null;
  const manager = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
  manager.name = 'Current Manager'; manager.status = 'active';
  return { sim, w, gang, site, seller, manager };
}

describe('purchased business targeting', () => {
  it('does not select the former seller through a bought site, including the occupant fallback', () => {
    const { w, gang, site, seller, manager } = fixture();
    expect(orderPersonAtSite(w, gang.id, 'kill', site)).toBe(seller.id);
    expect(orderPeopleBySite(w, gang.id, 'kill').get(site.id)).toBe(seller.id);

    site.ownerGangId = gang.id;
    expect(orderPersonAtSite(w, gang.id, 'kill', site)).toBeNull();
    expect(orderPeopleBySite(w, gang.id, 'kill').has(site.id)).toBe(false);

    site.managerId = manager.id; manager.buildingId = site.id;
    expect(orderPersonAtSite(w, gang.id, 'kill', site)).toBe(manager.id);
    expect(orderPeopleBySite(w, gang.id, 'kill').get(site.id)).toBe(manager.id);
    // Ownership changes site picking, not the RTS ability to choose people by name.
    expect(selectableOrderPerson(w, gang.id, 'kill', seller)).toBe(true);
    expect(selectableOrderPerson(w, gang.id, 'kill', manager)).toBe(true);
  });

  it('retains civilian and family kidnapping targets and rejects people already out of action', () => {
    const { w, gang, seller } = fixture();
    const relative = Object.values(w.people).find(p => p.role === 'citizen' && p.familyOfId != null)!;
    relative.status = 'active';
    expect(selectableOrderPerson(w, gang.id, 'kidnap', seller)).toBe(true);
    expect(selectableOrderPerson(w, gang.id, 'kidnap', relative)).toBe(true);
    for (const status of ['dead', 'jailed', 'kidnapped'] as const) {
      relative.status = status;
      expect(selectableOrderPerson(w, gang.id, 'kidnap', relative)).toBe(false);
      expect(selectableOrderPerson(w, gang.id, 'kill', relative)).toBe(false);
    }
  });
});

describe('job card owner intelligence', () => {
  it('shows only an identified independent owner, then replaces the seller with the gang manager', () => {
    const { sim, w, gang, site, seller, manager } = fixture();
    const rival = Object.values(w.gangs).find(g => g.id !== gang.id)!;
    rival.name = 'Known Protection Gang';
    site.protection = { gangId: rival.id, weekly: 100, base: 100, refusing: false, grievance: 0 };
    useGame.setState({ sim, sheet: null, jobCard: {
      type: 'extort', teamId: gang.teamIds[0], buildingIds: [site.id], blockIds: [], personId: null, pos: null, opts: defaultOptions(),
    } });
    const markup = () => renderToStaticMarkup(createElement(JobCardPanel));

    for (const knowledge of [0, 1]) {
      site.knowledge[gang.id] = knowledge;
      expect(knownShopkeeper(w, site, gang.id)).toBeNull();
      expect(markup()).not.toContain(seller.name);
      expect(markup()).not.toContain(rival.name);
    }
    site.knowledge[gang.id] = 2;
    expect(knownShopkeeper(w, site, gang.id)?.id).toBe(seller.id);
    expect(markup()).toContain(seller.name);
    expect(markup()).toContain(`pays ${rival.name}`);

    site.ownerGangId = gang.id; site.protection = null;
    expect(knownShopkeeper(w, site, gang.id)).toBeNull();
    expect(markup()).not.toContain(seller.name);
    site.managerId = manager.id;
    expect(markup()).toContain(`run by ${manager.name}`);
    expect(markup()).not.toContain(seller.name);
    expect(knownShopkeeper(w, site, null)).toBeNull();
  });
});
