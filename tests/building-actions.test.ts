import { afterEach, describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { useGame } from '../src/app/store';
import { Sim } from '../src/sim/sim';
import { buildingActions } from '../src/ui/buildingActions';
import { prepareBuildingOrder } from '../src/ui/prepareBuildingOrder';

afterEach(() => useGame.setState({
  sim: null, selectedBuildingId: null, selectedPersonId: null,
  selectedPersonIds: [], jobCard: null, pickMode: null, organizerOpen: false,
}));

function fixture() {
  const sim = new Sim({ ...defaultGameOptions(), citySize: 10, seed: 409, startMoney: 100_000 });
  const w = sim.world, gang = sim.playerGang;
  const site = Object.values(w.buildings).find(b => b.cls === 'commercial' && b.ownerGangId == null) ??
    Object.values(w.buildings).find(b => b.cls === 'commercial')!;
  expect(site).toBeDefined();
  site.typeId = 'cafe'; site.cls = 'commercial'; site.state = 'trading';
  site.ownerGangId = null; site.protection = null; site.knowledge[gang.id] = 3;
  useGame.setState({ sim, selectedBuildingId: site.id, jobCard: null,
    specialistCard: null, pickMode: null, organizerOpen: false });
  return { sim, w, gang, site };
}

describe('building dossier action catalogue', () => {
  it('offers the ordinary on-site and area commands without bypassing the target rules', () => {
    const s = fixture(), actions = buildingActions(s.w, s.gang.id, s.site.id);
    expect(actions.map(a => a.type)).toContain('explore');
    expect(actions.map(a => a.type)).toContain('raid');
    expect(actions.map(a => a.type)).toContain('extort');
    expect(actions.map(a => a.type)).not.toContain('collectProtection');
  });

  it('updates protection actions as the shop signs or refuses', () => {
    const s = fixture();
    s.site.protection = { gangId: s.gang.id, weekly: 90, base: 90, refusing: false, grievance: 0 };
    let types = buildingActions(s.w, s.gang.id, s.site.id).map(a => a.type);
    expect(types).toContain('collectProtection');
    expect(types).toContain('adjustProtection');
    expect(types).not.toContain('extort');
    expect(types).not.toContain('intimidate');
    s.site.protection.refusing = true;
    types = buildingActions(s.w, s.gang.id, s.site.id).map(a => a.type);
    expect(types).toContain('intimidate');
  });

  it('hides unknown illicit sites and never exposes an unverified proprietor', () => {
    const s = fixture();
    s.site.cls = 'illegal'; s.site.knowledge[s.gang.id] = 0;
    expect(buildingActions(s.w, s.gang.id, s.site.id)).toEqual([]);
    s.site.cls = 'commercial'; s.site.knowledge[s.gang.id] = 1;
    const actions = buildingActions(s.w, s.gang.id, s.site.id);
    expect(actions.some(a => a.personId != null)).toBe(false);
    expect(actions.some(a => a.type === 'buyPremises')).toBe(false);
  });

  it('uses a verified independent shopkeeper as a person target, not a hidden enemy', () => {
    const s = fixture();
    const citizen = Object.values(s.w.people).find(p => p.role === 'citizen' && p.status === 'active' && p.gangId == null)!;
    expect(citizen).toBeDefined();
    s.site.ownerPersonId = citizen.id;
    const bribe = buildingActions(s.w, s.gang.id, s.site.id).find(a => a.type === 'bribe');
    expect(bribe?.personId).toBe(citizen.id);
    s.site.knowledge[s.gang.id] = 1;
    expect(buildingActions(s.w, s.gang.id, s.site.id).some(a => a.personId === citizen.id)).toBe(false);
  });

  it('opens the existing job card pretargeted to the site without creating an order', () => {
    const s = fixture(), teamId = s.gang.teamIds[0];
    expect(teamId).toBeDefined();
    const action = buildingActions(s.w, s.gang.id, s.site.id).find(a => a.type === 'raid')!;
    const existing = Object.keys(s.w.orders).length;
    expect(prepareBuildingOrder(s.site.id, teamId, action)).toBe(true);
    const state = useGame.getState();
    expect(state.jobCard?.type).toBe('raid');
    expect(state.jobCard?.teamId).toBe(teamId);
    expect(state.jobCard?.buildingIds).toEqual([s.site.id]);
    expect(state.selectedBuildingId).toBeNull();
    expect(state.organizerOpen).toBe(true);
    expect(Object.keys(s.w.orders)).toHaveLength(existing);
  });

  it('rejects a stale site action before replacing the active map order', () => {
    const s = fixture(), teamId = s.gang.teamIds[0];
    const extort = buildingActions(s.w, s.gang.id, s.site.id).find(a => a.type === 'extort')!;
    s.site.protection = { gangId: s.gang.id, weekly: 80, base: 80, refusing: false, grievance: 0 };
    expect(prepareBuildingOrder(s.site.id, teamId, extort)).toBe(false);
    expect(useGame.getState().jobCard).toBeNull();
    expect(useGame.getState().selectedBuildingId).toBe(s.site.id);
  });
});
