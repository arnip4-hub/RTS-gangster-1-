import { previewPosition } from '../sim/movement';
import { useEffect, useRef, useState } from 'react';
import { act, useGame } from '../app/store';
import { cancelOrder, clearStreetOrder, leaveVehicle, returnToBase, setWaiting } from '../sim/api';
import { ORDERS } from '../sim/constants';
import { cargoActivity, goodsTotal } from '../sim/cargo';
import { restingStatus } from '../sim/transport';
import { cameraApi, taggedViewApi } from './CityView';
import { VIEW_ZOOM } from '../render/viewModes';
import { Portrait } from './Portrait';
import { InterfaceButton } from './InterfaceControls';
import { cancelSpecialistJob, setSpecialistWaiting, SPECIALIST_JOB_NAMES, specialistJobActive } from '../sim/specialistJobs';
import { personProfile } from '../sim/personProfile';
import { personListIds, togglePersonList } from '../sim/personLists';
import { FULL_DAY_MINUTES } from '../sim/calendar';
import type { PersonalMemory, WorldState } from '../sim/types';

function memoryDescription(w: WorldState, memory: PersonalMemory): string {
  const person = memory.personId == null ? null : w.people[memory.personId];
  const gang = memory.gangId == null ? null : w.gangs[memory.gangId];
  const subject = person?.name ?? 'A family member';
  const by = gang ? ` by ${gang.name}` : '';
  const text = memory.kind === 'kidnapped' ? `Was kidnapped${by}`
    : memory.kind === 'familyMissing' ? `${subject} went missing`
    : memory.kind === 'familyKidnapped' ? `${subject} was kidnapped${by}`
    : memory.kind === 'familyPressured' ? `Was pressured over ${subject}${by}`
    : `${subject} was killed${by}`;
  return `Day ${Math.floor(memory.atMinute / FULL_DAY_MINUTES) + 1} · ${text}`;
}

/** Manual pp. 78-79: a live, independent view of the selected character. */
export function TaggedWindow({id}: {id: number}) {
  const sim = useGame(s => s.sim)!;
  const closeTaggedPerson = useGame(s => s.closeTaggedPerson);
  const requestCamera = useGame(s => s.requestCamera);
  const setPickMode = useGame(s => s.setPickMode);
  const pickMode = useGame(s => s.pickMode);
  const notify = useGame(s => s.notify);
  const paused = useGame(s => s.paused);
  const setPaused = useGame(s => s.setPaused);
  useGame(s => s.version);
  const [mode, setMode] = useState<'street' | 'roof'>('street');
  const [showProfile, setShowProfile] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const candidate = id == null ? null : sim.world.people[id];
  const person = candidate;

  useEffect(() => {
    if (!viewport.current || id == null || !person) return;
    const view = { element: viewport.current, personId: id, mode };
    taggedViewApi.views.set(id, view);
    return () => { if (taggedViewApi.views.get(id) === view) taggedViewApi.views.delete(id); };
  }, [id, mode, sim, !!person]);

  if (!person) return null;
  const w = sim.world;
  const profile = personProfile(w, person);
  const mine = person.gangId === sim.playerGang.id;
  const order = person.orderId == null ? null : w.orders[person.orderId];
  const staff = Object.values(w.specialistJobs ?? {}).find(j => j.actorId === person.id && j.week === w.week && specialistJobActive(j) && j.state !== 'queued');
  const active = person.status === 'active' || person.status === 'beaten';
  const waiting = order?.state === 'waiting' || !!staff?.paused;
  const streetTarget = person.streetOrder?.targetPersonId == null ? null : w.people[person.streetOrder.targetPersonId];
  const pursuit = streetTarget ? person.halted ? 'Waiting for traffic' : person.dest ? 'Approaching' :
    person.streetOrder?.type === 'tail' ? 'Watching' : 'Attacking' : null;
  const orderName = person.streetOrder
    ? ({ goTo: 'Go to', enterBuilding: 'Inside building', guard: 'Guard', patrol: 'Patrol', kill: 'Kill', assault: 'Assault', tail: 'Tail' }[person.streetOrder.type] ?? person.streetOrder.type)
    : cargoActivity(w,person) ?? (order ? ORDERS[order.type].name : staff ? SPECIALIST_JOB_NAMES[staff.type] : restingStatus(w, person));
  const cargo=person.vehicleKey?w.vehicleFleet?.[person.vehicleKey]?.cargo:undefined;
  const command = (kind: 'kill' | 'assault' | 'tail' | 'goTo' | 'enterBuilding') => {
    if (kind !== 'goTo' && useGame.getState().weekPlanOpen) {
      useGame.getState().setWeekPlanOpen(false);
      cameraApi.ref?.setZoom(VIEW_ZOOM.roof);
    }
    setPickMode({ kind: 'streetOrder', orderType: kind, personIds: [person.id] });
    notify(kind === 'goTo' ? 'Click where they should go.' : kind === 'enterBuilding' ? 'Click one of your gang\'s buildings.' : 'Click the person to target.');
  };

  const pickingHere = pickMode?.kind === 'streetOrder' && pickMode.personIds.includes(id);
  return <section className="tagged-window" aria-label={`Tagged window: ${person.name}`} data-person-id={id}>
    <header className="tagged-heading interface-window-heading">
      <button className="close" aria-label={`Close tagged window: ${person.name}`} onClick={() => closeTaggedPerson(id)}>×</button>
      <Portrait person={person} gang={person.gangId == null ? undefined : w.gangs[person.gangId]} size={24} />
      <h4>{person.name}</h4>
    </header>
    <div className="tagged-toolbar" aria-label="Tagged window controls">
      <InterfaceButton label="Person profile" glyph="ⓘ" aria-pressed={showProfile} title={`Show ${person.name}'s household details`}
        onClick={() => setShowProfile(!showProfile)}/>
      <InterfaceButton label="Center View" icon="hud/follow" title="Center the main view on this character" onClick={() => requestCamera(previewPosition(person, sim.subMinute, { x: 0, y: 0 }))}/>
      <InterfaceButton label="Toggle Display" glyph="▱" aria-pressed={mode === 'roof'} title={`Toggle Display — show ${mode==='street'?'Rooftop':'Street'} View in this window`}
        onClick={() => setMode(mode === 'street' ? 'roof' : 'street')}/>
      {mine && active && <>
        <InterfaceButton label="Cancel Order" glyph="×" disabled={!order&&!person.streetOrder&&!staff} onClick={() => notify(act(s =>
          person.streetOrder ? clearStreetOrder(s.world, [person.id]) : staff ? cancelSpecialistJob(s.world, sim.playerGang.id, staff.id) : cancelOrder(s.world, order!.id)))}/>
        <InterfaceButton label={waiting?'Continue':'Wait'} icon={waiting?'hud/play':'messages/waiting'} disabled={!order&&!staff} aria-pressed={waiting}
          onClick={() => {if(staff)notify(act(s => setSpecialistWaiting(s.world, sim.playerGang.id, staff.id, !waiting))); else if(order)notify(act(s => setWaiting(s.world, order.id, !waiting)));}}/>
        <InterfaceButton label="Get out of Vehicle" icon="vehicles/coupe" disabled={!person.inVehicle} onClick={() => notify(act(s => leaveVehicle(s.world, s.playerGang.id, person.id)))}/>
        <InterfaceButton label="Return to Base" glyph="⌂" onClick={() => notify(act(s => returnToBase(s.world, s.playerGang.id, person.id)))}/>
      </>}
    </div>
    {showProfile && <div className="paper tagged-profile" aria-label={`Profile: ${person.name}`}>
      <div><b>{person.name}</b> · {profile.age} years old</div>
      <div>Spouse: {profile.spouse ?? 'None listed'}</div>
      <div>Children: {profile.children} · Household: {profile.householdSize}</div>
      {person.familyOfId != null && <div>{person.familyRelation} of {w.people[person.familyOfId]?.name ?? 'a resident'}</div>}
      {(person.personalMemories ?? []).length > 0 && <div className="tagged-memory-list" aria-label="Recent personal and family memories">
        <b>Recent memories</b>
        {(person.personalMemories ?? []).slice(-4).reverse().map((memory, index) =>
          <div key={`${memory.atMinute}-${memory.kind}-${index}`}>{memoryDescription(w, memory)}</div>)}
      </div>}
      <div className="tagged-profile-actions">
        <button aria-pressed={personListIds(w,sim.playerGang.id,'watch').includes(person.id)}
          onClick={()=>notify(act(s=>togglePersonList(s.world,s.playerGang.id,person.id,'watch')))}>Watch list</button>
        <button aria-pressed={personListIds(w,sim.playerGang.id,'hit').includes(person.id)}
          onClick={()=>notify(act(s=>togglePersonList(s.world,s.playerGang.id,person.id,'hit')))}>Hit list</button>
      </div>
      <small>Children and unlinked spouses live off the city map.</small>
    </div>}
    <div className="paper tagged-status">
      <b>{mine && active ? (paused ? 'Paused · ' : waiting ? 'Waiting · ' : '') + orderName + (pursuit ? ` · ${pursuit}` : '') : person.status}</b>
      <span>{Math.round(person.hp)} hp{person.inVehicle ? ' · In vehicle' : ''}{cargo?` · ${goodsTotal(cargo.goods)} cases`:''}</span>
    </div>
    <div ref={viewport} className="tagged-viewport" data-mode={mode} role="img"
      aria-label={`Live ${mode === 'street' ? 'street' : 'rooftop'} view following ${person.name}`}>
      <span className="tagged-reversed">↔ Reversed</span>
      <span className="tagged-marker" />
      <span className="tagged-cutaway">Cutaway view</span>
      <span className="tagged-obscured">Location marked here</span>
    </div>
    {mine && streetTarget && <div className="paper tagged-target">Target: {streetTarget.name} · {Math.max(0,Math.ceil(streetTarget.hp))} hp</div>}
    {mine && active && <div className="paper street-order-box" aria-label="Street orders">
      {paused && (person.streetOrder || order || person.dest) &&
        <button className="tagged-resume" title="Clock paused — resume to carry out orders" onClick={() => setPaused(false)}>▶ Resume to carry out orders</button>}
      <div className="street-order-buttons">
      {person.role !== 'accountant' && person.role !== 'lawyer' && <>
        <InterfaceButton label="Kill" caption="Kill" icon="street/kill" aria-pressed={pickingHere&&pickMode.orderType==='kill'} onClick={() => command('kill')}/>
        <InterfaceButton label="Assault" caption="Assault" icon="street/assault" aria-pressed={pickingHere&&pickMode.orderType==='assault'} onClick={() => command('assault')}/>
        <InterfaceButton label="Tail" caption="Tail" icon="street/tail" aria-pressed={pickingHere&&pickMode.orderType==='tail'} onClick={() => command('tail')}/>
      </>}
      <InterfaceButton label="Go to" caption="Go to" icon="street/goTo" aria-pressed={pickingHere&&pickMode.orderType==='goTo'} onClick={() => command('goTo')}/>
      <InterfaceButton label="Enter building" caption="Enter" glyph="⌂" aria-pressed={pickingHere&&pickMode.orderType==='enterBuilding'} onClick={() => command('enterBuilding')}/>
      <InterfaceButton label="Cancel target selection" caption="Cancel" glyph="×" disabled={!pickingHere} onClick={()=>setPickMode(null)}/>
      </div>
    </div>}
  </section>;
}
