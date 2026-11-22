import { useState } from 'react';
import { act, useGame } from '../app/store';
import { issueStreetOrder } from '../sim/api';
import { buildingMapIntel } from '../sim/mapIntel';
import type { ID } from '../sim/types';
import { buildingDoor, buildingName } from '../sim/world';
import {
  availableDispatchIds, buildingDispatchRoster, validateDispatchSelection,
  type BuildingDispatchOrder, type BuildingDispatchSource,
} from './buildingDispatchSelection';

const CHOICES: { kind: BuildingDispatchOrder; label: string; description: string }[] = [
  { kind: 'goTo', label: 'Move', description: 'Go to the building entrance, then return to normal duty.' },
  { kind: 'guard', label: 'Guard', description: 'Hold position outside the building until recalled.' },
  { kind: 'patrol', label: 'Patrol', description: 'Travel repeatedly between current position and the building.' },
];

/** Building-first live orders: target is fixed, choose action and actors, then confirm. */
export function BuildingDispatch({ buildingId, onClose }: { buildingId: ID; onClose: () => void }) {
  const sim = useGame(s => s.sim)!;
  const globalSelected = useGame(s => s.selectedPersonIds);
  const pickMode = useGame(s => s.pickMode);
  const jobCard = useGame(s => s.jobCard);
  const specialistCard = useGame(s => s.specialistCard);
  useGame(s => s.version);

  const [source, setSource] = useState<BuildingDispatchSource>('selected');
  const [chosenIds, setChosenIds] = useState<ID[]>(() =>
    availableDispatchIds(buildingDispatchRoster(
      sim.world, sim.playerGang.id, 'selected', useGame.getState().selectedPersonIds,
    )));
  const [order, setOrder] = useState<BuildingDispatchOrder>('goTo');
  const [review, setReview] = useState(false);

  const w = sim.world, gang = sim.playerGang, building = w.buildings[buildingId];
  if (!building || w.phase !== 'week' || !buildingMapIntel(building, gang.id).siteKnown) return null;

  const roster = buildingDispatchRoster(w, gang.id, source, globalSelected);
  const selected = validateDispatchSelection(w, gang.id, source, globalSelected, chosenIds);
  const eligibleIds = new Set(availableDispatchIds(roster));
  const name = buildingName(w, buildingId);
  const canOrder = !pickMode && !jobCard && !specialistCard;
  const selectedNames = selected.ids.map(id => w.people[id]?.name ?? 'Unknown');

  const changeSource = (next: BuildingDispatchSource) => {
    const nextRoster = buildingDispatchRoster(w, gang.id, next, globalSelected);
    setSource(next);
    setChosenIds(next === 'pool' ? [] : availableDispatchIds(nextRoster));
    setReview(false);
  };

  const toggle = (id: ID) => {
    if (!eligibleIds.has(id)) return;
    setChosenIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setReview(false);
  };

  const confirm = () => {
    const state = useGame.getState();
    const freshSim = state.sim, freshBuilding = freshSim?.world.buildings[buildingId];
    if (!freshSim || freshSim.world.phase !== 'week' || !freshBuilding ||
        !buildingMapIntel(freshBuilding, freshSim.playerGang.id).siteKnown ||
        state.selectedBuildingId !== buildingId) {
      state.notify('The selected building is no longer available.'); onClose(); return;
    }
    if (state.pickMode || state.jobCard || state.specialistCard) {
      state.notify('Finish or cancel the current map target selection first.'); return;
    }
    const check = validateDispatchSelection(freshSim.world, freshSim.playerGang.id,
      source, state.selectedPersonIds, chosenIds);
    if (!check.valid) {
      state.notify('One or more selected people are unavailable. Choose the team again.');
      setReview(false); return;
    }
    // Move/Guard/Patrol all use the same live-order API as map clicks.
    // In particular the door is the same point the city draws for this facade.
    const result = act(s => {
      const b = s.world.buildings[buildingId];
      if (!b || !buildingMapIntel(b, s.playerGang.id).siteKnown)
        return { ok: false as const, error: 'The selected building is no longer available.' };
      return issueStreetOrder(s.world, s.playerGang.id, check.ids, order, null, buildingDoor(s.world, b));
    });
    if (!result) return;
    state.notify(result);
    if (result.ok) {
      // Reflect the dispatched men in the Hoods bar without closing the site.
      state.selectPeopleForBuilding(check.ids);
      onClose();
    }
  };

  return <section className="brass building-dispatch" aria-label={`Send hoods to ${name}`}>
    <header className="building-dispatch-header">
      <div>
        <small>DIRECT STREET ORDER</small>
        <h4>Send hoods to {name}</h4>
      </div>
      <button className="building-dispatch-close" onClick={onClose} aria-label="Close dispatch">×</button>
    </header>
    <div className="building-dispatch-main">
      <div className="building-dispatch-label">1. Choose action</div>
      <div className="building-dispatch-modes" role="group" aria-label="Order type">
        {CHOICES.map(c => <button key={c.kind} aria-pressed={order === c.kind}
          onClick={() => { setOrder(c.kind); setReview(false); }}>{c.label}</button>)}
      </div>
      <p className="building-dispatch-description">{CHOICES.find(c => c.kind === order)!.description}</p>

      <div className="building-dispatch-label">2. Choose hoods or a crew</div>
      <div className="building-dispatch-sources" role="group" aria-label="Choose dispatch group">
        <button aria-pressed={source === 'selected'} onClick={() => changeSource('selected')}
          title="Use the people highlighted in the Hoods bar">Hoods selection ({globalSelected.length})</button>
        {gang.teamIds.map(id => {
          const team = w.teams[id], sourceKey = `crew:${id}` as BuildingDispatchSource;
          if (!team || team.gangId !== gang.id) return null;
          return <button key={id} aria-pressed={source === sourceKey}
            onClick={() => changeSource(sourceKey)}>{team.name}</button>;
        })}
        <button aria-pressed={source === 'pool'} onClick={() => changeSource('pool')}>
          Pool ({gang.poolIds.length})</button>
      </div>
      <div className="building-dispatch-list-actions">
        <span>{selected.ids.length} chosen · {eligibleIds.size} available</span>
        <button disabled={!eligibleIds.size} onClick={() => { setChosenIds([...eligibleIds]); setReview(false); }}>All</button>
        <button disabled={!chosenIds.length} onClick={() => { setChosenIds([]); setReview(false); }}>None</button>
      </div>
      <div className="building-dispatch-people" role="group" aria-label="Available hoods">
        {!roster.length && <p className="building-dispatch-empty">
          {source === 'selected' ? 'Select people in the Hoods bar first, or choose a crew here.' :
            'Nobody is assigned to this group.'}
        </p>}
        {roster.map(p => <label key={p.id} className={`building-dispatch-person${p.status !== 'active' ? ' unavailable' : ''}`}>
          <input type="checkbox" checked={chosenIds.includes(p.id)} disabled={p.status !== 'active'}
            onChange={() => toggle(p.id)} />
          <span>{p.name}</span>
          <small>{p.status === 'active' ? p.role : p.status}</small>
        </label>)}
      </div>

      {!canOrder && <p className="building-dispatch-warning" role="status">
        Finish or cancel your active map target selection before dispatching.
      </p>}
      {review ? <>
        <div className="building-dispatch-review" role="status">
          <b>3. Confirm order</b>
          <p><strong>{CHOICES.find(c => c.kind === order)!.label}</strong> at {name}</p>
          <p>{selectedNames.join(', ')}</p>
          <small>This live command interrupts their current assignments. Eligible planned work resumes after a
            temporary street order where the existing game rules allow it. A patrol or guard order continues until stopped.</small>
        </div>
        <div className="building-dispatch-footer">
          <button onClick={() => setReview(false)}>Back</button>
          <button className="primary" disabled={!selected.valid || !canOrder} onClick={confirm}>Confirm dispatch</button>
        </div>
      </> : <div className="building-dispatch-footer">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!selected.valid || !canOrder} onClick={() => setReview(true)}>
          Review order ({selected.ids.length})
        </button>
      </div>}
    </div>
  </section>;
}
