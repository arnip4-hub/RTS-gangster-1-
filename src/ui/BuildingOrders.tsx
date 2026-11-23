import { useState } from 'react';
import { useGame } from '../app/store';
import { prepareBuildingOrder } from './prepareBuildingOrder';
import { ORDERS } from '../sim/constants';
import type { ID } from '../sim/types';
import { Icon } from './common';
import { buildingActions, type BuildingActionGroup } from './buildingActions';

const GROUPS: { id: BuildingActionGroup; label: string }[] = [
  { id: 'property', label: 'Property and business' },
  { id: 'protection', label: 'Protection and influence' },
  { id: 'people', label: 'Personnel and surveillance' },
  { id: 'crime', label: 'Hostile operations' },
];

/** Open a fully pre-targeted, ordinary Organizer job card from the site dossier.
 * No order is created until the player confirms it on that card. */
export function BuildingOrders({ buildingId }: { buildingId: ID }) {
  const sim = useGame(s => s.sim)!;
  const preferredTeamId = useGame(s => s.selectedTeamId);
  const [teamChoice, setTeamChoice] = useState<ID | null>(
    () => preferredTeamId ?? sim.playerGang.teamIds[0] ?? null,
  );
  useGame(s => s.version);
  const w = sim.world, gang = sim.playerGang;
  const actions = buildingActions(w, gang.id, buildingId);
  const teamId = teamChoice != null && gang.teamIds.includes(teamChoice)
    ? teamChoice : gang.teamIds[0] ?? null;

  return <section className="building-order-panel" aria-label="Building orders">
    <div className="building-section-heading">
      <b>Orders for this property</b>
      <small>Choose an action, then confirm in the Organizer</small>
    </div>
    {gang.teamIds.length ? <label className="building-order-crew">
      <span>Assigned crew</span>
      <select aria-label="Crew for building order" value={teamId ?? ''}
        onChange={event => setTeamChoice(Number(event.target.value))}>
        {gang.teamIds.map(id => w.teams[id]?.gangId === gang.id &&
          <option key={id} value={id}>{w.teams[id].name}</option>)}
      </select>
    </label> : <div className="note">Promote a lieutenant and form a crew to plan orders here.</div>}
    {!actions.length && <div className="note">No building orders are currently available. The site's condition, ownership or your information may limit them.</div>}
    {GROUPS.map(group => {
      const items = actions.filter(action => action.group === group.id);
      return items.length ? <details key={group.id} className="building-order-group"
        open={group.id === 'property' || group.id === 'protection'}>
        <summary>{group.label} <span>{items.length}</span></summary>
        <div className="building-order-buttons">
          {items.map(action =>
            <button key={`${action.type}:${action.opts?.recruitKind ?? action.personId ?? ''}`}
              type="button" className="btn sm" disabled={teamId == null}
              title={ORDERS[action.type].desc}
              onClick={() => prepareBuildingOrder(buildingId, teamId, action)}>
              <Icon name={`orders/${action.type}`} size={15} />
              <span>{action.label}</span>
            </button>)}
        </div>
      </details> : null;
    })}
  </section>;
}
