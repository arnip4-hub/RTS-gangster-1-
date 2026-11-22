import { MoneyRoll } from './MoneyRoll';
import { useEffect, useRef, useState } from 'react';
import { act, useGame } from '../app/store';
import { streetRoster } from '../app/streetRoster';

/** The HUD redraws five times a second; the roster walks the whole city, so
 * one result serves for 400 ms (a new street order shows within that). */
let rosterCache: { w: WorldState; gangId: number; at: number; roster: ReturnType<typeof streetRoster> } | null = null;
function rosterFor(w: WorldState, gang: Gang): ReturnType<typeof streetRoster> {
  const now = performance.now();
  if (rosterCache && rosterCache.w === w && rosterCache.gangId === gang.id && now - rosterCache.at < 400) return rosterCache.roster;
  rosterCache = { w, gangId: gang.id, at: now, roster: streetRoster(w, gang) };
  return rosterCache.roster;
}
import { audio } from '../audio/audio';
import { ORDERS, WEAPONS } from '../sim/constants';
import { cargoActivity } from '../sim/cargo';
import { restingStatus } from '../sim/transport';
import type { Gang, MessageCategory, Person, WorldState } from '../sim/types';
import type { OverlayKind } from '../render/scene';
import { previewPosition } from '../sim/movement';
import { allocateWeapons } from '../sim/weapons';
import { streetLocation } from '../sim/cityLayout';
import { dayIndex } from '../sim/world';
import { VIEW_ZOOM, viewForZoom, type CityViewMode } from '../render/viewModes';
import { cameraApi } from './CityView';
import { Icon } from './common';
import { InterfaceButton, WindowHeading } from './InterfaceControls';
import { MapAccess } from './MapAccess';
import { RightSheet } from './organizer/RightSheet';
import { Portrait } from './Portrait';
import { Minimap } from './Minimap';
import { TaggedWindow } from './TaggedWindow';
import { TutorialPanel } from './TutorialPanel';
import { WeekClock, weekTime, WEEK_DAYS } from './WeekClock';
import './interface.css';
import { buildingList } from '../sim/entityLists';
import { personListIds, togglePersonList, type PersonListKind } from '../sim/personLists';
import { personMapPosition } from '../sim/mapIntel';

const CATEGORIES:Record<MessageCategory,{name:string;short:string;key:string}>={
  combat:{name:'Combat messages',short:'Combat',key:'F5'},
  police:{name:'Gangsters and Police messages',short:'Police',key:'F6'},
  failed:{name:'Failed Order messages',short:'Failed',key:'F7'},
  waiting:{name:'Waiting and Priority messages',short:'Waiting',key:'F8'},
};
const OVERLAYS:{id:OverlayKind;label:string;caption:string}[]=[
  {id:'territory',label:'Territory',caption:'Turf'},
  {id:'lieutenant',label:'Lieutenant’s area',caption:'Lt. area'},
  {id:'landValue',label:'Land value',caption:'Value'},
  {id:'security',label:'Security',caption:'Security'},
  {id:'hostility',label:'Hostility',caption:'Hostility'},
  {id:'crime',label:'Crime hot spots',caption:'Crime'},
  {id:'events',label:'Recent events',caption:'Events'},
];
function currentOrder(p:Person,w:WorldState) {
  const staff = Object.values(w.specialistJobs ?? {}).find(j => j.actorId === p.id && j.week === w.week && ['travelling', 'working'].includes(j.state));
  if (staff) return staff.paused ? 'Waiting' : staff.type === 'audit' ? 'Audit' : staff.type === 'bribeOfficials' ? 'Bribe Officials' : staff.type === 'investigateCrime' ? 'Investigate case' : 'Employ Police';
  if(p.streetOrder)return ({goTo:'Go to',kill:'Kill',assault:'Assault',tail:'Tail'} as const)[p.streetOrder.type];
  const order=p.orderId==null?null:w.orders[p.orderId];
  return order?.state==='waiting'?'Waiting':cargoActivity(w,p)??(order?ORDERS[order.type].name:restingStatus(w,p));
}
export function WeekHud() {
  const sim=useGame(s=>s.sim)!;
  const paused=useGame(s=>s.paused), finishing=useGame(s=>s.finishingWeek);
  const organizerOpen=useGame(s=>s.organizerOpen);
  const selectedTeamId=useGame(s=>s.selectedTeamId);
  const selectedHoodId=useGame(s=>s.selectedPersonId);
  const sheet=useGame(s=>s.sheet);
  const [barChoice,setBarChoice]=useState<{kind:'team'|'person';id:number}|null>(null);
  const weekPlanOpen=useGame(s=>s.weekPlanOpen);
  const filter=useGame(s=>s.messageFilter), override=useGame(s=>s.messageOverride);
  const messageBox=useGame(s=>s.messageBox), taggedIds=useGame(s=>s.taggedPersonIds);
  const autoCut=useGame(s=>s.autoLowerRoofs), overlays=useGame(s=>s.overlays);
  const setMessageBox=useGame(s=>s.setMessageBox);
  useGame(s=>s.version);
  const [view,setView]=useState<CityViewMode>('street');
  const [removed,setRemoved]=useState(false),[flipped,setFlipped]=useState(false);
  const [rosterOpen,setRosterOpen]=useState(false),[rosterMode,setRosterMode]=useState<'people'|'orders'>('people');
  const [listsOpen,setListsOpen]=useState(false);
  const [messageId,setMessageId]=useState<number|null>(null);
  // The street under the view, in the original's words (manual p.74).
  const [place,setPlace]=useState('');
  const [flashes,setFlashes]=useState<MessageCategory[]>([]);
  // Messages already in a loaded city are not news: no sirens or slow-down for them.
  const lastMessage=useRef(sim.world.messages.at(-1)?.id??0);
  const w=sim.world,gang=sim.playerGang,roster=rosterFor(w,gang),loadout=rosterOpen?allocateWeapons(w):null;
  const state=useGame.getState;
  const worldRef=useRef(w);worldRef.current=w;
  useEffect(()=>{
    const sync=()=>{const city=cameraApi.ref;if(city){setView(useGame.getState().weekPlanOpen?'plan':viewForZoom(city.getZoom()));setRemoved(city.areBuildingsRemoved());setFlipped(city.isFlipped());setPlace(streetLocation(worldRef.current,city.getTarget()));}};
    sync();const timer=window.setInterval(sync,150);return ()=>clearInterval(timer);
  },[]);
  const latest=w.messages.at(-1)?.id??0;
  useEffect(()=>{
    if(latest<=lastMessage.current){lastMessage.current=latest;return;}
    const fresh=w.messages.filter(m=>m.id>lastMessage.current);lastMessage.current=latest;
    if(!fresh.length)return;
    if(fresh.some(m=>m.sound==='gunshot'))audio.gunshot();
    else if(fresh.some(m=>m.category==='combat'))audio.alert();
    else if(fresh.some(m=>m.category==='police'))audio.siren();
    else if(fresh.some(m=>m.category==='failed'))audio.alert();
    if(!override && fresh.some(m=>filter[m.category]))state().setSpeed(1);
    setFlashes([...new Set(fresh.map(m=>m.category))]);
  },[latest,w.messages,override,filter]);
  useEffect(()=>{if(!flashes.length)return;const timer=window.setTimeout(()=>setFlashes([]),5000);return ()=>clearTimeout(timer);},[flashes]);
  useEffect(()=>{setMessageId(null);},[messageBox]);
  const messages=w.messages.filter(m=>m.category===messageBox).slice().reverse();
  const messageIndex=Math.max(0,messages.findIndex(m=>m.id===messageId));
  const message=messages[messageIndex];
  const counts={combat:0,police:0,failed:0,waiting:0};
  for(const m of w.messages)counts[m.category]++;
  const zoom=(mode:CityViewMode)=>{state().setWeekPlanOpen(mode==='plan');setView(mode);cameraApi.ref?.setZoom(VIEW_ZOOM[mode]);};
  const watch=(p:Person)=>{state().selectPerson(p.id);state().requestCamera(previewPosition(p,sim.subMinute,{x:0,y:0}));};
  // A roster crew is already filtered to people currently out in the city.
  // Send all of them to one destination without first opening each person's
  // tagged window. The map click still goes through the normal live-order API.
  const moveCrew=(people:Person[],name:string)=>{
    const personIds=people.filter(p=>p.status==='active'&&p.gangId===gang.id).map(p=>p.id);
    if(!personIds.length){state().notify(`${name} has nobody available to move.`);return;}
    state().setPickMode({kind:'streetOrder',orderType:'goTo',personIds});
    state().notify(`Click where ${name} should go.`);
  };
  const eventView=(m:typeof message|undefined)=>{if(!m)return;if(m.pos)state().requestCamera(m.pos);if(m.personId!=null)state().selectPerson(m.personId);};
  // The standalone live command bar is ported from Codex commit 3d0cc1a.
  // Selection of a single hood takes precedence over the highlighted crew,
  // so a map order cannot accidentally send a whole team.
  const chosenTeamId=barChoice?.kind==='team'?barChoice.id:selectedTeamId;
  const selectedTeam=chosenTeamId!=null&&gang.teamIds.includes(chosenTeamId)?w.teams[chosenTeamId]:undefined;
  const teamPeople=selectedTeam
    ? [w.people[selectedTeam.lieutenantId],...selectedTeam.memberIds.map(id=>w.people[id])]
      .filter((p):p is Person=>!!p&&p.status!=='dead'&&p.gangId===gang.id)
    : [];
  const activePersonId=barChoice?.kind==='person'?barChoice.id:selectedHoodId;
  const candidate=activePersonId!=null?w.people[activePersonId]:undefined;
  const selectedHood=candidate?.gangId===gang.id&&candidate.status!=='dead'?candidate:null;
  const individualChosen=barChoice?.kind==='person'||(!barChoice&&!selectedTeam&&!!selectedHood);
  const chooseHood=(p:Person)=>{
    if(p.gangId!==gang.id)return;
    setBarChoice({kind:'person',id:p.id});
    state().focusPerson(p.id);
    state().requestCamera(previewPosition(p,sim.subMinute,{x:0,y:0}));
  };
  const chooseTeam=(id:number)=>{
    setBarChoice({kind:'team',id});
    state().selectTeam(id);
  };
  const orderCommandSelection=()=>{
    if(individualChosen&&selectedHood)moveCrew([selectedHood],selectedHood.name);
    else if(selectedTeam)moveCrew(teamPeople,selectedTeam.name);
    else if(selectedHood)moveCrew([selectedHood],selectedHood.name);
  };

  return <div className="classic-hud">
    <header className="week-bars">
      <div className="week-titlebar">
        <button className="week-exit" onClick={()=>state().setQuitPrompt(true)} title="Exit to the main menu (Ctrl+Q)">Exit</button>
        <span>Working week <b>{w.week}</b></span>
        <span className="week-status">{paused?'Paused':finishing?'Finishing week':`${WEEK_DAYS[dayIndex(w.minute,!!w.options.continuousTime)]} · ${weekTime(w.minute,!!w.options.continuousTime)}`}</span>
        <span className="week-place" title={place}>{place}</span>
        <span className="week-cash">Cash <b><MoneyRoll value={gang.cash} /></b></span>
      </div>
      <nav className="week-iconbar" aria-label="Working week controls">
        <div className="interface-control-group">
          <InterfaceButton label={paused&&!finishing?'Resume':'Pause'} icon={paused&&!finishing?'hud/play':'hud/pause'} caption={paused&&!finishing?'Resume':'Pause'} aria-pressed={paused&&!finishing}
            title={finishing?'Stop skipping and pause (P)':paused?'Resume (P)':'Pause (P)'} onClick={()=>finishing?state().cancelFinishWeek():state().setPaused(!paused)}/>
          <InterfaceButton label={organizerOpen?'Close Organizer':'Open Organizer'} glyph="▤" caption="Book" aria-pressed={organizerOpen} title={organizerOpen?'Close the live Organizer (O)':'Open the live Organizer (O)'} onClick={()=>{
            if(organizerOpen){state().setOrganizerOpen(false);state().setOrganizerCollapsed(false);}
            else {state().setOrganizerOpen(true);state().setOrganizerCollapsed(false);state().setPlanningView('city');}
          }}/>
          <InterfaceButton label="Help" glyph="?" caption="Help" onClick={()=>state().setHelpOpen(true)}/>
          <InterfaceButton label="City Plan View" icon="tabs/maps" caption="City plan" aria-pressed={weekPlanOpen} title="Overhead City Plan (Insert) · Move with W/A/S/D or arrow keys" onClick={()=>zoom('plan')}/>
          <InterfaceButton label="Rooftop View" glyph="▱" caption="Rooftop" aria-pressed={view==='roof'} title="Rooftop View (Home)" onClick={()=>zoom('roof')}/>
          <InterfaceButton label="Street View" icon="orders/explore" caption="Street" aria-pressed={view==='street'} title="Street View (Page Up)" onClick={()=>zoom('street')}/>
          <InterfaceButton label="Center on Headquarters" glyph="⌂" caption="HQ" onClick={()=>{
            const hq=buildingList(w).find(b=>b.ownerGangId===gang.id&&b.isHQ);
            if(hq)state().requestCamera(w.lots[hq.lotId].center);
          }}/>
          <InterfaceButton label="Tagged Characters" icon="groups/personnel" caption="People" count={roster.count} aria-expanded={rosterOpen} aria-controls="street-roster-window" onClick={()=>setRosterOpen(!rosterOpen)}/>
          <InterfaceButton label="Person lists" glyph="☷" caption="Lists"
            count={(gang.watchPersonIds?.length??0)+(gang.hitPersonIds?.length??0)} aria-expanded={listsOpen}
            aria-controls="person-lists-window" onClick={()=>setListsOpen(!listsOpen)}/>
          <InterfaceButton label="Clear Tagged Windows" glyph="×" caption="Untag" disabled={!taggedIds.length} onClick={()=>state().clearTaggedWindows()}/>
        </div>
        <div className="interface-control-group" aria-label="View options">
          {/* The ground wash shows from the rooftops too; only the street is too close for it. */}
          {view!=='street' && <>{OVERLAYS.map(o=><InterfaceButton key={o.id} label={o.label} icon={`overlays/${o.id}`} caption={o.caption} aria-pressed={overlays.includes(o.id)} onClick={()=>state().toggleOverlay(o.id)}/>)}
            <InterfaceButton label="Clear overlays" glyph="∅" caption="Clear" onClick={()=>state().setOverlays([])}/></>}
          {view!=='plan' && <>
            <InterfaceButton label="Reverse view" glyph="↔" caption="Reverse" aria-pressed={flipped} title="Reverse view (F)" onClick={()=>cameraApi.ref?.flipView()}/>
            <InterfaceButton label={removed?'Restore buildings':'Remove buildings'} icon="orders/buyPremises" caption={removed?'Restore':'Remove'} aria-pressed={removed} title="Remove or restore buildings (B)" onClick={()=>cameraApi.ref?.toggleBuildingsRemoved()}/>
            <InterfaceButton label="Automatic cutaway" icon="orders/setUpBusiness" caption="Cutaway" aria-pressed={autoCut} onClick={()=>state().setAutoLowerRoofs(!autoCut)}/>
          </>}
        </div>
        <div className="interface-control-group message-controls" aria-label="Messages">
          {(Object.keys(CATEGORIES) as MessageCategory[]).map(c=><InterfaceButton key={c} label={CATEGORIES[c].name} icon={`messages/${c}`} caption={CATEGORIES[c].short} count={counts[c]}
            className={flashes.includes(c)?'message-flash':''} aria-pressed={messageBox===c} title={`${CATEGORIES[c].name} (${CATEGORIES[c].key}); right-click to view latest event`}
            onClick={()=>{setMessageBox(c);setMessageId(null);}} onContextMenu={e=>{e.preventDefault();eventView(w.messages.filter(m=>m.category===c).at(-1));}}/>) }
          <InterfaceButton label="Message Override" icon="hud/override" caption="Override" aria-pressed={override} title="Message Override — keep accelerated time when reports arrive" onClick={()=>state().toggleMessageOverride()}/>
        </div>
        <MapAccess className="interface-map-search" label="Find…"/>
      </nav>
    </header>
    <section className="hood-command-bar" aria-label="Hoods and crews">
      <div className="hood-command-roster">
        <span className="hood-command-label">Crews</span>
        {gang.teamIds.map(id=>{
          const team=w.teams[id],leader=team&&w.people[team.lieutenantId];
          if(!team||!leader)return null;
          return <button key={id} className="hood-command-chip" aria-pressed={!!selectedTeam&&selectedTeam.id===id&&!individualChosen}
            title={`${leader.name} · ${currentOrder(leader,w)}`} onClick={()=>chooseTeam(id)}>
            <Portrait person={leader} gang={gang} size={30}/>
            <span><b>{team.name}</b><small>{leader.name} · {currentOrder(leader,w)}</small></span>
          </button>;
        })}
        {gang.poolIds.map(id=>{
          const person=w.people[id];
          if(!person||person.status==='dead'||person.gangId!==gang.id)return null;
          return <button key={`pool-${id}`} className="hood-command-chip" aria-pressed={individualChosen&&selectedHood?.id===id}
            title={`${person.name} · ${currentOrder(person,w)}`} onClick={()=>chooseHood(person)}>
            <Portrait person={person} gang={gang} size={30}/>
            <span><b>{person.name}</b><small>Pool · {currentOrder(person,w)}</small></span>
          </button>;
        })}
      </div>
      <div className="hood-command-actions">
        {(selectedTeam||selectedHood)&&<button className="hood-action" onClick={orderCommandSelection}
          disabled={individualChosen?!selectedHood||selectedHood.status!=='active':selectedTeam?!teamPeople.some(p=>p.status==='active'):selectedHood?.status!=='active'}
          title={individualChosen?'Choose a map destination for this hood':'Choose a map destination for this crew'}>Go to map</button>}
        {selectedHood&&individualChosen&&<button className="hood-action" onClick={()=>state().selectPerson(selectedHood.id)}>Hood details</button>}
        {selectedTeam&&<button className="hood-action" onClick={()=>teamPeople[0]&&state().selectPerson(teamPeople[0].id)} disabled={!teamPeople.length}>Crew details</button>}
        <button className="hood-action" onClick={()=>state().setSheet({kind:'hoods'})}>Pool · {gang.poolIds.length}</button>
        <button className="hood-action" onClick={()=>state().setSheet({kind:'recruits'})}>Recruit · {gang.recruitIds.length}</button>
        <button className="hood-action" onClick={()=>state().setSheet({kind:'weapons'})}>Weapons</button>
        <button className="hood-action" onClick={()=>state().setSheet({kind:'vehicles'})}>Cars</button>
      </div>
      {selectedTeam&&<div className="hood-team-status" aria-live="polite">
        <b>{selectedTeam.name}</b>
        {teamPeople.map(p=><button key={p.id} aria-pressed={individualChosen&&selectedHood?.id===p.id}
          onClick={()=>chooseHood(p)} title={`Select and follow ${p.name}`}>
          <Portrait person={p} gang={gang} size={20}/>
          <span>{p.name} · {currentOrder(p,w)}</span>
        </button>)}
      </div>}
    </section>
    <div className="week-windows">
      {taggedIds.map(id=><TaggedWindow key={id} id={id}/>)}
      {listsOpen && <section id="person-lists-window" className="interface-window street-list" aria-label="Person lists">
        <WindowHeading title="Person lists" onClose={()=>setListsOpen(false)}/>
        <div className="street-list-content">
          {(['watch','hit'] as PersonListKind[]).map(kind=><div className="street-list-group" key={kind}>
            <div className="street-list-heading"><b>{kind==='watch'?'Watch list':'Hit list'}</b>
              <span>{personListIds(w,gang.id,kind).length}</span></div>
            {personListIds(w,gang.id,kind).map(id=>{
              const p=w.people[id],pos=p?.status==='active'||p?.status==='beaten'?personMapPosition(w,gang.id,p):null;
              return p && <div key={id} className="person-list-entry">
                <button disabled={!pos} onClick={()=>{state().selectPerson(id);state().requestCamera(pos!);}}>
                  {p.name} <small>{p.status==='active'?'':p.status}</small>
                </button>
                {kind==='hit' && <button disabled={p.status!=='active'||!gang.teamIds.length}
                  title={`Prepare a Kill order against ${p.name}`}
                  onClick={()=>{
                    const game=state();game.setTab('lieutenants');game.beginOrder('kill',gang.teamIds[0]);
                    game.updateJobCard({personId:id});game.setOrganizerOpen(true);setListsOpen(false);
                  }}>Plan</button>}
                <button aria-label={`Remove ${p.name} from ${kind} list`}
                  onClick={()=>state().notify(act(s=>togglePersonList(s.world,gang.id,id,kind)))}>×</button>
              </div>;
            })}
            {!personListIds(w,gang.id,kind).length && <p className="street-list-summary">No people on this list.</p>}
          </div>)}
          <p className="street-list-summary">The hit list records targets; give a Kill order separately.</p>
        </div>
      </section>}
      <div className="week-tutorial"><TutorialPanel/></div>
      {rosterOpen && <section id="street-roster-window" className="interface-window street-list" aria-label="Tagged characters">
        <WindowHeading title="Tagged Characters" onClose={()=>setRosterOpen(false)}/>
        <div className="street-list-summary">On the streets · {roster.count}</div>
        <div className="street-list-content">
          {!roster.count && <p>Nobody deployed. The boss and indoor staff are not counted.</p>}
          {roster.groups.map(group=><div className="street-list-group" key={group.key}>
            <div className="street-list-heading"><b>{group.name}</b><div className="street-list-heading-actions"><span>{group.people.length}{group.team?` of ${group.crewSize}`:''} deployed</span>{group.team&&<button className="street-team-move" title={`Order every deployed member of ${group.name} to move`} onClick={()=>moveCrew(group.people,group.name)}>Move crew</button>}</div></div>
            {group.people.map(p=>{
              const weapon=loadout?.get(p.id),order=currentOrder(p,w),role=p.role==='lieutenant'?'Lieutenant':p.role==='accountant'?'Accountant':p.role==='lawyer'?'Lawyer':'Hood';
              return <button key={p.id} className={`street-list-person${group.team&&p.id!==group.team.lieutenantId?' subordinate':''}`} aria-pressed={taggedIds.includes(p.id)}
                title={`${p.name} · ${role} · ${order} · ${weapon?WEAPONS[weapon].name:'Unarmed'}`} onClick={()=>watch(p)}>
                <Icon name={p.role==='accountant'?'roles/accountant':p.role==='lawyer'?'roles/lawyer':weapon?`weapons/${weapon}`:'skills/fists'} size={20}/>
                <span><b>{rosterMode==='people'?p.name:order}</b><small>{rosterMode==='people'?role:p.name}</small></span>
              </button>;
            })}
          </div>)}
        </div>
        <footer className="interface-window-tabs">
          <button aria-pressed={rosterMode==='people'} onClick={()=>setRosterMode('people')}>People</button>
          <button aria-pressed={rosterMode==='orders'} onClick={()=>setRosterMode('orders')}>Orders</button>
        </footer>
      </section>}
    </div>
    {sheet && !organizerOpen && <RightSheet/>}
    <div className={`week-minimap${messageBox?' has-message':''}`}><Minimap size={144}/><span>City plan</span></div>
    <WeekClock/>
    {messageBox && <section className="interface-window message-window" aria-label="Message Box">
      <WindowHeading title={CATEGORIES[messageBox].name} onClose={()=>setMessageBox(null)}/>
      <div className="message-filter-row"><span>Slow time for</span>{(Object.keys(CATEGORIES) as MessageCategory[]).map(c=><button key={c} aria-label={`Slow time for ${CATEGORIES[c].short}`} aria-pressed={filter[c]} title={`${filter[c]?'Disable':'Enable'} ${CATEGORIES[c].name.toLowerCase()} slowing time`} onClick={()=>state().toggleMessageFilter(c)}><Icon name={`messages/${c}`} size={18}/></button>)}</div>
      <div className="message-paper" aria-live="polite">{message?<><time>{WEEK_DAYS[dayIndex(message.minute,!!w.options.continuousTime)]} · {weekTime(message.minute,!!w.options.continuousTime)}</time><p>{message.text}</p></>:<p>Nothing to report.</p>}</div>
      <footer className="message-navigation">
        <button aria-label="Most recent message" title="Most recent message" disabled={!message||messageIndex===0} onClick={()=>setMessageId(null)}>«</button>
        <button aria-label="Newer message" title="Newer message" disabled={!message||messageIndex===0} onClick={()=>setMessageId(messages[messageIndex-1].id)}>‹</button>
        <span>{messages.length?messageIndex+1:0} / {messages.length}</span>
        <button aria-label="Older message" title="Older message" disabled={!message||messageIndex===messages.length-1} onClick={()=>setMessageId(messages[messageIndex+1].id)}>›</button>
        <button aria-label="Earliest message" title="Earliest message" disabled={!message||messageIndex===messages.length-1} onClick={()=>setMessageId(messages.at(-1)!.id)}>»</button>
        <button disabled={!message||(!message.pos&&message.personId==null)} onClick={()=>eventView(message)}>View event</button>
        {messageBox==='police' && <button onClick={()=>{state().setTab('lawyer');state().setOrganizerOpen(true);setMessageBox(null);}}>Investigations</button>}
        <button disabled={!message} title="Remove this report from the message box" onClick={()=>{
          if(message){w.messages=w.messages.filter(m=>m.id!==message.id);state().bump();}
          setMessageId(null);
        }}>Clear</button>
      </footer>
    </section>}
  </div>;
}
