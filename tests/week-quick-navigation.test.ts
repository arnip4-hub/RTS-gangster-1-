import { afterEach, describe, expect, it } from 'vitest';
import { useGame } from '../src/app/store';
import { openWeekSection, WEEK_QUICK_LINKS } from '../src/ui/weekQuickNavigation';

afterEach(() => useGame.setState({
  organizerTab: 'lieutenants', organizerOpen: false, organizerCollapsed: false,
  planningView: 'city', jobCard: null, pickMode: null, specialistCard: null,
}));

describe('working week top-bar navigation', () => {
  it('keeps the requested Organizer shortcuts in display order', () => {
    expect(WEEK_QUICK_LINKS.map(link => link.label)).toEqual([
      'Accountant', 'Lawyer', 'Newspaper', 'Graphs', 'City maps',
    ]);
    expect(new Set(WEEK_QUICK_LINKS.map(link => link.id)).size).toBe(5);
  });

  it.each(['accountant', 'lawyer', 'newspaper', 'graphs', 'maps', 'options'] as const)(
    'opens the %s page in the live Organizer',
    section => {
      useGame.setState({
        organizerTab: 'lieutenants', organizerOpen: false,
        organizerCollapsed: true, planningView: 'plan',
      });
      openWeekSection(section);
      const state = useGame.getState();
      expect(state.organizerTab).toBe(section);
      expect(state.organizerOpen).toBe(true);
      expect(state.organizerCollapsed).toBe(false);
      expect(state.planningView).toBe('city');
    },
  );

  it('switches pages through the same store action as the journal tabs', () => {
    openWeekSection('graphs');
    expect(useGame.getState().organizerTab).toBe('graphs');
    openWeekSection('lawyer');
    expect(useGame.getState().organizerTab).toBe('lawyer');
    expect(useGame.getState().organizerOpen).toBe(true);
  });
});
