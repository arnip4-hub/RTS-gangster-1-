import { useGame } from '../app/store';
import type { ID } from '../sim/types';
import { buildingActions, type BuildingAction } from './buildingActions';

/** Route a building command through the game's existing validated job card.
 * Preparing a job never executes it or charges the gang. */
export function prepareBuildingOrder(buildingId: ID, teamId: ID | null, action: BuildingAction): boolean {
  const state = useGame.getState();
  const sim = state.sim;
  if (!sim || !sim.world.buildings[buildingId] || state.selectedBuildingId !== buildingId) return false;
  if (state.jobCard || state.specialistCard || state.pickMode) {
    state.notify('Finish or cancel the current map order before planning another.'); return false;
  }
  if (teamId == null || !sim.playerGang.teamIds.includes(teamId) || !sim.world.teams[teamId]) {
    state.notify('Assign a lieutenant to a crew before giving orders.'); return false;
  }
  // Revalidate on click: ownership, protection, knowledge and jobs may have
  // changed since this window was painted.
  const available = buildingActions(sim.world, sim.playerGang.id, buildingId).some(candidate =>
    candidate.type === action.type && candidate.personId === action.personId &&
    candidate.opts?.recruitKind === action.opts?.recruitKind);
  if (!available) {
    state.notify('That order is no longer available at this site.'); return false;
  }
  state.setTab('lieutenants');
  state.selectTeam(teamId);
  state.beginOrder(action.type, teamId);
  if (action.personId != null) state.updateJobCard({ personId: action.personId });
  else state.updateJobCard({
    buildingIds: [buildingId], blockIds: [],
    requested: { buildingIds: [buildingId], blockIds: [] },
  });
  if (action.opts) state.updateJobOpts(action.opts);
  state.setOrganizerOpen(true);
  return true;
}
