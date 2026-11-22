import { useState } from 'react';
import { act, useGame } from '../app/store';
import { clearStreetOrder, returnToBase } from '../sim/api';
import type { Person } from '../sim/types';
import { previewPosition } from '../sim/movement';
import { VIEW_ZOOM } from '../render/viewModes';
import { cameraApi } from './CityView';
import { Portrait } from './Portrait';
import { HOOD_SLOTS, hoodPage, updateHoodSelection } from './hoodSelection';

const ORDER_NAMES = {
  goTo: 'Moving', guard: 'Guarding', patrol: 'Patrolling', tail: 'Tailing',
  kill: 'Attacking', assault: 'Assaulting',
} as const;
type LiveCommand = keyof typeof ORDER_NAMES;

function personDuty(p: Person): string {
  if (p.status !== 'active') return p.status === 'beaten' ? 'Recovering' : p.status;
  if (p.streetOrder) return ORDER_NAMES[p.streetOrder.type];
  if (p.orderId != null) return 'On assignment';
  if (p.dest) return 'Travelling';
  return 'Available';
}

function isFighter(p: Person): boolean {
  return p.role !== 'accountant' && p.role !== 'lawyer';
}

/** Eight persistent visible slots, crew/pool paging and direct live RTS commands. */
export function HoodsCommandBar() {
  const sim = useGame(s => s.sim)!;
  const selectedTeamId = useGame(s => s.selectedTeamId);
  const selectedIds = useGame(s => s.selectedPersonIds);
  const weekPlanOpen = useGame(s => s.weekPlanOpen);
  useGame(s => s.version);

  const [group, setGroup] = useState<string>(() => selectedTeamId != null ? String(selectedTeamId) : 'pool');
  const [page, setPage] = useState(0);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const game = useGame.getState;
  const w = sim.world, gang = sim.playerGang;
  const teamId = group === 'pool' ? null : Number(group);
  const team = teamId != null && gang.teamIds.includes(teamId) ? w.teams[teamId] : null;
  const poolMode = !team;
  const people: Person[] = (team
    ? [team.lieutenantId, ...team.memberIds]
    : gang.poolIds
  ).map(id => w.people[id])
    .filter((p): p is Person => !!p && p.gangId === gang.id && p.status !== 'dead');
  const { page: activePage, pageCount, slots } = hoodPage(people, page);
  const shownIds = slots.filter((p): p is Person => p !== null).map(p => p.id);
  const ownSelected = [...new Set(selectedIds)]
    .map(id => w.people[id])
    .filter((p): p is Person => !!p && p.gangId === gang.id && p.status !== 'dead');
  const movable = ownSelected.filter(p => p.status === 'active');
  const fighters = movable.filter(isFighter);
  const streetOrders = ownSelected.filter(p => !!p.streetOrder);
  const activePick = useGame(s => s.pickMode);

  const showGroup = (key: string) => {
    setGroup(key); setPage(0); setAnchor(null);
    if (key === 'pool') {
      game().selectPeople([]);
    } else {
      const t = w.teams[Number(key)];
      game().selectTeam(t?.id ?? null);
      game().selectPeople(t ? [t.lieutenantId, ...t.memberIds].filter(id => !!w.people[id] && w.people[id].status !== 'dead') : []);
    }
  };

  const choose = (p: Person, modifiers: {ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean}) => {
    const next = updateHoodSelection(selectedIds, p.id, shownIds, anchor, modifiers);
    game().selectPeople(next);
    if (!modifiers.shiftKey) setAnchor(p.id);
    if (!modifiers.ctrlKey && !modifiers.metaKey && !modifiers.shiftKey)
      game().requestCamera(previewPosition(p, sim.subMinute, { x: 0, y: 0 }));
  };

  const startCommand = (kind: LiveCommand) => {
    const targeted = kind === 'kill' || kind === 'assault' || kind === 'tail';
    const actors = targeted ? fighters : movable;
    if (!actors.length) {
      game().notify(targeted ? 'Select at least one available hood or lieutenant.' : 'Select an available member of your gang.');
      return;
    }
    if (targeted && weekPlanOpen) {
      game().setWeekPlanOpen(false);
      cameraApi.ref?.setZoom(VIEW_ZOOM.roof);
    }
    game().setPickMode({ kind: 'streetOrder', orderType: kind, personIds: actors.map(p => p.id) });
    game().notify(targeted
      ? \`Click a person to \${kind} with \${actors.length} selected.\`
      : kind === 'patrol' ? 'Click the other end of the patrol route.'
      : kind === 'guard' ? 'Click the position to guard.'
      : \`Click the destination for \${actors.length} selected.\`);
  };

  const flee = () => {
    if (!movable.length) { game().notify('Nobody available to retreat.'); return; }
    const result = act(s => movable.map(p => returnToBase(s.world, s.playerGang.id, p.id)));
    if (!result) return;
    const failures = result.filter(r => !r.ok);
    game().setPickMode(null);
    game().notify(failures.length
      ? \`\${result.length - failures.length} recalled; \${failures.length} could not retreat.\`
      : \`\${result.length} member\${result.length === 1 ? '' : 's'} retreating to base.\`);
  };

  const stop = () => {
    if (!streetOrders.length) { game().notify('No active street orders to stop.'); return; }
    const result = act(s => clearStreetOrder(s.world, streetOrders.map(p => p.id)));
    if (result) {
      game().setPickMode(null);
      game().notify(\`Stopped \${streetOrders.length} street order\${streetOrders.length === 1 ? '' : 's'}.\`);
    }
  };

  const openPanel = (kind: 'hoods' | 'recruits' | 'weapons' | 'vehicles') => game().setSheet({kind});
  const openDetails = () => {
    if (!ownSelected.length) return;
    game().selectPerson(ownSelected[0].id);
  };
  const openCrew = () => {
    if (team) game().selectTeam(team.id);
    game().setTab('lieutenants');
    game().setOrganizerOpen(true);
    game().setOrganizerCollapsed(false);
    game().setPlanningView('city');
  };

  return (
    <section className={\`hood-command-bar\${collapsed ? ' is-collapsed' : ''}\`} aria-label="Hoods command bar">
      <div className="hood-bar-header">
        <strong className="hood-bar-title">HOODS <small>LIVE COMMAND</small></strong>
        <div className="hood-crew-tabs" role="group" aria-label="Select a crew or the pool">
          {gang.teamIds.map(id => {
            const t = w.teams[id];
            if (!t) return null;
            return <button key={id} aria-pressed={!poolMode && team?.id === id}
              onClick={() => showGroup(String(id))} title={\`Select all members of \${t.name}\`}>{t.name}</button>;
          })}
          <button aria-pressed={poolMode} onClick={() => showGroup('pool')}>Pool ({gang.poolIds.length})</button>
        </div>
        <div className="hood-bar-pages" aria-label="Hood pages">
          <button disabled={activePage === 0} onClick={() => setPage(Math.max(0, activePage - 1))} aria-label="Previous eight hoods">‹</button>
          <span>{activePage + 1} / {pageCount}</span>
          <button disabled={activePage >= pageCount - 1} onClick={() => setPage(activePage + 1)} aria-label="Next eight hoods">›</button>
        </div>
        <button className="hood-bar-collapse" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand Hoods bar' : 'Collapse Hoods bar'}
          onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▾ Expand' : '▴ Hide'}</button>
      </div>
      {!collapsed && <>
        <div className="hood-bar-roster" role="group" aria-label="Eight Hoods slots">
          {slots.map((p, index) => p ? <button key={p.id}
            className="hood-bar-slot" aria-pressed={selectedIds.includes(p.id)}
            aria-label={\`Slot \${index + 1}: \${p.name}, \${personDuty(p)}\`}
            title={\`\${p.name} · \${p.role} · \${personDuty(p)} · Ctrl-click to multi-select; Shift-click for a range\`}
            onClick={e => choose(p, e)}>
            <span className="hood-slot-number">{index + 1 + activePage * HOOD_SLOTS}</span>
            <Portrait person={p} gang={gang} size={34}/>
            <span className="hood-slot-text"><b>{p.name}</b><small>{personDuty(p)}</small></span>
          </button> : <div className="hood-bar-empty" key={\`empty-\${index}\`} aria-label={\`Empty slot \${index + 1}\`}>
            <span className="hood-slot-number">{index + 1 + activePage * HOOD_SLOTS}</span><span>Empty</span>
          </div>)}
        </div>
        <div className="hood-bar-controls">
          <div className="hood-bar-selection">
            <b>{ownSelected.length} selected</b>
            <button onClick={() => { game().selectPeople(people.map(p => p.id)); setAnchor(null); }}
              disabled={!people.length}>All</button>
            <button onClick={() => { game().selectPeople([]); setAnchor(null); }} disabled={!selectedIds.length}>None</button>
          </div>
          <div className="hood-bar-orders" role="group" aria-label="Live orders">
            {([
              ['goTo','Move'],['guard','Guard'],['patrol','Patrol'],['tail','Tail'],
              ['kill','Kill'],['assault','Assault'],
            ] as [LiveCommand,string][]).map(([kind,label]) =>
              <button key={kind} className="hood-action" disabled={kind === 'tail' || kind === 'kill' || kind === 'assault' ? !fighters.length : !movable.length}
                aria-pressed={activePick?.kind === 'streetOrder' && activePick.orderType === kind}
                onClick={() => startCommand(kind)} title={kind === 'guard' ? 'Hold the position selected on the map' :
                  kind === 'patrol' ? 'Keep travelling between current and selected positions' :
                  kind === 'tail' ? 'Follow a person selected on the street' :
                  kind === 'goTo' ? 'Move selected people to a location' : \`\${label} a selected target\`}>{label}</button>)}
            <button className="hood-action hood-action-retreat" disabled={!movable.length} onClick={flee}
              title="Break off assignments and retreat to the nearest gang office">Flee / HQ</button>
            <button className="hood-action" disabled={!streetOrders.length} onClick={stop}
              title="Cancel selected live street orders; do not cancel planned weekly work">Stop</button>
          </div>
        </div>
        <div className="hood-bar-resources">
          <span className="hood-bar-hint">Click: select · Ctrl: multi-select · Shift: range · Orders: choose target on map</span>
          <button disabled={!ownSelected.length} onClick={openDetails}>Hood details</button>
          <button disabled={!team} onClick={openCrew}>Crew details</button>
          <button onClick={() => openPanel('hoods')}>Hood pool</button>
          <button onClick={() => openPanel('recruits')}>Recruit</button>
          <button onClick={() => openPanel('weapons')}>Weapons</button>
          <button onClick={() => openPanel('vehicles')}>Cars</button>
        </div>
      </>}
    </section>
  );
}
