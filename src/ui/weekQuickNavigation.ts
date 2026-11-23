import { useGame, type OrganizerTab } from '../app/store';

/** Compact quick access along the live city's oxblood title bar. The existing
 * Organizer remains the single source of truth for pages and their controls. */
export const WEEK_QUICK_LINKS = [
  { id: 'accountant', label: 'Accountant' },
  { id: 'lawyer', label: 'Lawyer' },
  { id: 'newspaper', label: 'Newspaper' },
  { id: 'graphs', label: 'Graphs' },
  { id: 'maps', label: 'City maps' },
] as const satisfies ReadonlyArray<{ id: OrganizerTab; label: string }>;

export type WeekQuickSection = typeof WEEK_QUICK_LINKS[number]['id'] | 'options';

/** Open a top-bar section without creating a second screen or interrupting the
 * live simulation. Standard setTab rules still apply to pending job cards. */
export function openWeekSection(section: WeekQuickSection): void {
  const state = useGame.getState();
  state.setTab(section);
  state.setOrganizerOpen(true);
  state.setOrganizerCollapsed(false);
  state.setPlanningView('city');
}
