import { useState } from 'react';
import { act, useGame } from '../../app/store';
import {
  assignStaffVehicle,
  bribePrice,
  canGoStraight,
  COURT_APPEAL_COST,
  fileCourtAppeal,
  policeTourCapacity,
  hireRecruit,
  sackPerson,
  setGoStraight,
  setPay,
  setRunForOffice,
} from '../../sim/api';
import { GO_STRAIGHT_ASSETS } from '../../sim/constants';
import { campaignWeeklyCost, officeEntryCheck, electionBlocksRequired } from '../../sim/systems/politics';
import type { Person } from '../../sim/types';
import { gangAssets, money, placeName, territoryCount } from '../../sim/world';
import { Avatar, ConfirmDialog, Empty, Hint, Panel, Pill, Stars } from '../common';
import { VEHICLES, VEHICLE_ORDER } from '../../sim/constants';
import { SpecialistJobList } from '../SpecialistJobCard';
import { peopleList } from '../../sim/entityLists';
import { quitGangPayroll } from '../../sim/payrollMark';
import { officialLeverage } from '../../sim/officials';
import { personMapPosition } from '../../sim/mapIntel';
import { personListIds, togglePersonList } from '../../sim/personLists';
import { reportedSquealers } from '../../sim/squealers';
import type { OrderType } from '../../sim/types';
import { CRIME_INQUIRY_REQUIRED_MINUTES, queueCrimeInquiry, specialistJobActive } from '../../sim/specialistJobs';
import { knownPrisonRivals, PRISON_NAMES, prisonOf, requestPrisonAttack, requestPrisonContact, requestPrisonProtection } from '../../sim/prison';
import { specialistAskingWage } from '../../sim/originalWages';
import { campaignMinute } from '../../sim/calendar';
import { PoliceCaseFiles } from '../PoliceCasePanel';
import { activeWarrants, lawDeadline } from '../policeCaseView';

export function LawyerTab() {
  const sim = useGame((s) => s.sim)!;
  const notify = useGame((s) => s.notify);
  const beginSpecialistOrder = useGame(s => s.beginSpecialistOrder);
  const requestCamera = useGame((s) => s.requestCamera);
  const setTab = useGame((s) => s.setTab);
  const beginOrder = useGame((s) => s.beginOrder);
  const updateJobCard = useGame((s) => s.updateJobCard);
  const setOrganizerOpen = useGame((s) => s.setOrganizerOpen);
  useGame((s) => s.version);
  const [officialKind, setOfficialKind] = useState<'mayor' | 'policeChief' | 'judge' | 'da' | 'police'>('mayor');
  const [sacking, setSacking] = useState(false);

  const w = sim.world;
  const gang = sim.playerGang;
  const continuous = !!w.options.continuousTime;
  const lawyer = gang.lawyerId != null ? w.people[gang.lawyerId] : null;
  const straight = canGoStraight(w, gang.id);
  const officeEntry = officeEntryCheck(w, gang.id);
  const cases = Object.values(w.cases).filter((c) => c.gangId === gang.id);
  const squealers = reportedSquealers(w, gang.id);
  const planAgainst = (type: OrderType, personId: number) => {
    const teamId = gang.teamIds[0];
    if (teamId == null) return;
    setTab('lieutenants');
    beginOrder(type, teamId);
    updateJobCard({ personId });
    setOrganizerOpen(true);
  };
  const wanted = Object.values(w.people)
    .filter((p) => p.gangId === gang.id && p.status !== 'dead' &&
      (continuous ? activeWarrants(w, p.id).length > 0 : p.wanted > 25))
    .sort((a, b) => b.wanted - a.wanted);
  const crimes = w.crimes.filter((c) => c.gangId === gang.id && c.week >= w.week - 1 && !c.charge);
  const investigations = (continuous ? w.crimes.filter(c => c.gangId === gang.id && (c.police || !c.charge)) : crimes)
    .filter(c => c.reported && (c.reportedAt == null || c.reportedAt <= campaignMinute(w)));
  const detained = peopleList(w).filter(p => p.gangId === gang.id && p.status === 'arrested' && p.custody);
  const imprisoned = peopleList(w).filter(p => p.gangId === gang.id && p.status === 'jailed');
  const lawyerInvestigation = (crimeId: number) => Object.values(w.specialistJobs ?? {}).find(j =>
    j.crimeId === crimeId && specialistJobActive(j));
  const lawyerInvestigating = (crimeId: number) => !!lawyerInvestigation(crimeId);
  const lawyerInquiryStatus = (crimeId: number) => {
    const job = lawyerInvestigation(crimeId);
    if (!job) return null;
    if (job.paused) return 'Lawyer waiting; the file visit will resume when available.';
    if (job.state === 'queued') return 'Lawyer is preparing to leave for the courthouse.';
    if (job.state === 'travelling') return 'Lawyer is travelling to the courthouse.';
    return `At the courthouse · ${Math.min(CRIME_INQUIRY_REQUIRED_MINUTES, Math.floor(job.progressMinutes ?? 0))}/${CRIME_INQUIRY_REQUIRED_MINUTES} minutes`;
  };

  const officials: Person[] = (() => {
    switch (officialKind) {
      case 'mayor':
        return [w.people[w.mayorId]].filter(Boolean);
      case 'policeChief':
        return [w.people[w.policeChiefId]].filter(Boolean);
      case 'judge':
        return w.judgeIds.map((id) => w.people[id]).filter(Boolean);
      case 'da':
        return w.daIds.map((id) => w.people[id]).filter(Boolean);
      case 'police':
        return w.policeIds
          .map((id) => w.people[id])
          .filter((p) => p && p.status === 'active')
          .slice(0, 24);
    }
  })();

  const freeLawyers = peopleList(w).filter(
    (p) => p.role === 'lawyer' && p.gangId == null && p.employedBy == null && p.status === 'active',
  ).sort((a, b) => Number(gang.recruitIds.includes(b.id)) - Number(gang.recruitIds.includes(a.id)) || a.name.localeCompare(b.name));

  return (
    <div>
      <Panel title="The Lawyer">
        {lawyer ? (
          <>
            <div className="row" style={{ gap: 10 }}>
              <Avatar person={lawyer} gang={gang} />
              <div style={{ flex: 1 }}>
                <div className="row between">
                  <b style={{ color: lawyer.pay < lawyer.payDemand ? 'var(--blood)' : undefined }}>{lawyer.name}</b>
                  <Stars value={lawyer.skills.intelligence} />
                </div>
                <div className="muted tiny">
                  Pay {money(lawyer.pay)} · wants {money(lawyer.payDemand)}
                </div>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 4, marginTop: 8 }}>
              <button
                className="btn sm"
                onClick={() => notify(act((s) => setPay(s.world, lawyer.id, lawyer.payDemand))!)}
              >
                Meet Pay
              </button>
              <button
                className="btn sm danger"
                onClick={() => setSacking(true)}
              >
                Sack
              </button>
            </div>
            {sacking && (
              <ConfirmDialog
                text={`Sack ${lawyer.name}? He leaves bearing a grudge, and you will need a new lawyer.`}
                onYes={() => { setSacking(false); notify(act((s) => sackPerson(s.world, gang.id, lawyer.id))!); }}
                onNo={() => setSacking(false)}
              />
            )}
            <Hint>He defends your people in court automatically. Everything else you must ask for.</Hint>
          </>
        ) : (
          <>
            <Empty>
              No lawyer. Your hoods will face the district attorney alone, and you cannot bribe
              officials, employ police, run for office or go straight.
            </Empty>
            {freeLawyers.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="muted tiny" style={{ marginBottom: 4 }}>
                  {freeLawyers.length} free lawyers in the city · {freeLawyers.filter((p) => gang.recruitIds.includes(p.id)).length} willing to join. Recruit at law offices or the courthouse to find more.
                </div>
                <div style={{ maxHeight: 190, overflowY: 'auto', paddingRight: 4 }}>
                  {freeLawyers.map((p) => (
                    <div key={p.id} className="row between" style={{ padding: '3px 0', gap: 8 }}>
                      <span className="tiny" style={{ minWidth: 0 }}>
                        {p.name}<br />
                        <span className="muted">{p.buildingId != null && w.buildings[p.buildingId] ? placeName(w, w.buildings[p.buildingId]) : 'Location unknown'}</span>
                      </span>
                      <div className="row" style={{ gap: 5, flexShrink: 0 }}>
                        <span className="muted tiny">{gang.recruitIds.includes(p.id) ? 'Willing' : 'Not on your list'}</span>
                        <Stars value={p.skills.intelligence} />
                        <span className="muted tiny mono">{money(specialistAskingWage(w, p, gang.id))}</span>
                        {gang.recruitIds.includes(p.id) && (
                          <button
                            className="btn sm"
                            onClick={() => notify(act((s) => hireRecruit(s.world, gang.id, p.id, 'pool'))!)}
                          >
                            Hire
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {lawyer && (
        <>
          <Panel title="Employ Police">
            <Hint>
              He tours an area you mark on the map and puts the officers on its beats on a weekly retainer to
              overlook your crimes — {policeTourCapacity(gang)} of them in a week{gang.staffVehicles?.lawyer ? ' with the car' : ', twice that with a car'}.
            </Hint>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <button className="btn brass" onClick={() => beginSpecialistOrder('employPolice')}>Mark the area</button>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <span className="tiny muted">
                Car: {gang.staffVehicles?.lawyer ? VEHICLES[gang.staffVehicles.lawyer].name : 'none'}
              </span>
              {VEHICLE_ORDER.filter((v) => (gang.vehicles[v] ?? 0) > 0 && gang.staffVehicles?.lawyer !== v).map((v) => (
                <button key={v} className="btn sm" onClick={() => notify(act((s) => assignStaffVehicle(s.world, gang.id, 'lawyer', v))!)}>
                  Give {VEHICLES[v].name}
                </button>
              ))}
              {gang.staffVehicles?.lawyer && (
                <button className="btn sm" onClick={() => notify(act((s) => assignStaffVehicle(s.world, gang.id, 'lawyer', null))!)}>
                  Take the car back
                </button>
              )}
            </div>
          </Panel>

          <Panel title="Bribe Officials">
            <div className="row wrap" style={{ gap: 4, marginBottom: 8 }}>
              {(
                [
                  ['mayor', 'Mayor'],
                  ['policeChief', 'Chief'],
                  ['judge', 'Judges'],
                  ['da', 'DAs'],
                  ['police', 'Officers'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`btn sm${officialKind === k ? ' on' : ''}`}
                  onClick={() => setOfficialKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {officialKind === 'police' && (
              <div className="row between" style={{ gap: 8, marginBottom: 8 }}>
                <span className="muted tiny">One officer at a time here. To put every officer on an area's beats on the payroll, mark the area on the map.</span>
                <button className="btn sm brass" onClick={() => beginSpecialistOrder('employPolice')}>Mark an area</button>
              </div>
            )}
            <div className="scroll-list">
              {officials.map((p) => {
                const view = p.opinion[gang.id] ?? 0;
                return (
                  <div key={p.id} className="row between" style={{ padding: '4px 0', borderBottom: '1px dotted #bdb094' }}>
                    <button
                      className="name tiny"
                      style={{ textAlign: 'left', flex: 1 }}
                      onClick={() => requestCamera({ x: p.pos.x, y: p.pos.y })}
                    >
                      {p.name}
                      {p.bribedBy === gang.id && ' ✓'}
                    </button>
                    <div className="row" style={{ gap: 5 }}>
                      <Pill kind={view > 20 ? 'good' : view < -20 ? 'bad' : undefined}>
                        {view > 20 ? 'friendly' : view < -20 ? 'hostile' : 'neutral'}
                      </Pill>
                      {officialLeverage(w, p, gang.id) && <Pill kind="good">Leverage</Pill>}
                      <span className="muted tiny mono">{money(bribePrice(w, p, gang.id))}</span>
                      <button
                        className="btn sm"
                        onClick={() => beginSpecialistOrder('bribeOfficials', p.id)}
                      >
                        Bribe
                      </button>
                      {p.role === 'police' && p.employedBy == null && !quitGangPayroll(p, gang.id) && (
                        <button
                          className="btn sm"
                          onClick={() => beginSpecialistOrder('employPolice', p.id)}
                        >
                          Employ
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Hint>
              The head of the Bureau cannot be bought. Bribe a judge while he is hearing your case and
              it will be thrown out; bribe the DA and you will learn who is testifying.
            </Hint>
          </Panel>

          <Panel title="The Long Game">
            <div className="row between" style={{ marginBottom: 6 }}>
              <div>
                <b className="tiny">Go Straight</b>
                <div className="muted tiny">{straight.reason}</div>
              </div>
              <button
                className={`btn sm${gang.goingStraight ? ' on' : ''}`}
                disabled={!straight.can && !gang.goingStraight}
                onClick={() => notify(act((s) => setGoStraight(s.world, gang.id, !gang.goingStraight))!)}
              >
                {gang.goingStraight ? 'Cancel' : 'Begin'}
              </button>
            </div>
            <div className="row between tiny muted" style={{ marginBottom: 10 }}>
              <span>
                Assets excluding cash: {money(gangAssets(w, gang))} of {money(GO_STRAIGHT_ASSETS)}
              </span>
            </div>

            <div className="row between">
              <div>
                <b className="tiny">Run for Office</b>
                <div className="muted tiny">
                  {w.election.active
                    ? `Election in ${w.election.weeksLeft} week(s). You hold ${territoryCount(w, gang.id)} of ${electionBlocksRequired(w)} blocks needed.`
                    : 'No election is under way.'}
                </div>
                {w.election.active && <div className="muted tiny">
                  {money(campaignWeeklyCost(w, gang.id))} a week · changes with your territory and land values.
                  {!gang.runningForOffice && !officeEntry.can && ` ${officeEntry.reason}`}
                </div>}
              </div>
              <button
                className={`btn sm${gang.runningForOffice ? ' on' : ''}`}
                disabled={!officeEntry.can && !gang.runningForOffice}
                onClick={() => notify(act((s) => setRunForOffice(s.world, gang.id, !gang.runningForOffice))!)}
              >
                {gang.runningForOffice ? 'Withdraw' : 'Stand'}
              </button>
            </div>
          </Panel>
        </>
      )}

      <SpecialistJobList role="lawyer" />
      {w.election.active && (
        <Panel title="The Election">
          {gang.runningForOffice && <Hint>Campaign costs are paid after wages. If you cannot pay the full bill, you withdraw. Keep a lawyer available through the campaign; replace a lost lawyer before week's end to stay in the race.</Hint>}
          {w.election.candidates.map((c) => (
            <div key={c.id} className="row between tiny" style={{ padding: '3px 0' }}>
              <span>
                {w.people[c.id]?.name ?? 'Candidate'}
                {c.gangId != null && ` (${w.gangs[c.gangId]?.name})`}
              </span>
              <b className="mono">{c.votes}</b>
            </div>
          ))}
        </Panel>
      )}

      {!w.election.active && w.election.lastResult && w.week - w.election.lastResult.week <= 1 && (
        <Panel title="The Election Result">
          {w.election.lastResult.candidates.map((c) => (
            <div key={c.id} className="row between tiny" style={{ padding: '3px 0' }}>
              <span>
                {c.id === w.election.lastResult!.winnerId ? <b>{w.people[c.id]?.name ?? 'Candidate'} · elected</b> : w.people[c.id]?.name ?? 'Candidate'}
                {c.gangId != null && ` (${w.gangs[c.gangId]?.name})`}
              </span>
              <b className="mono">{c.votes}</b>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Prison Contacts">
        {imprisoned.length === 0 ? <Empty>None of your people are serving a sentence.</Empty> : imprisoned.map(inmate => (
          <div key={inmate.id} style={{ padding: '5px 0', borderBottom: '1px dotted #bdb094' }}>
            <div className="row between tiny"><b>{inmate.name}</b><span>{PRISON_NAMES[prisonOf(w, inmate)]} · {inmate.jailWeeks} week(s)</span></div>
            <div className="row wrap" style={{ gap: 5, marginTop: 4 }}>
              <button className="btn sm" disabled={!!inmate.prisonOperation} onClick={() => notify(act(s => requestPrisonContact(s.world, gang.id, inmate.id)))}>Ask around · $150</button>
              <button className="btn sm" onClick={() => notify(act(s => requestPrisonProtection(s.world, gang.id, inmate.id)))}>Protection · $500</button>
              {inmate.prisonOperation && <span className="muted tiny">{inmate.prisonOperation.kind} pending</span>}
            </div>
            {knownPrisonRivals(w, gang.id, inmate).map(target => <div key={target.id} className="row wrap tiny" style={{ gap: 5, marginTop: 4 }}>
              <span style={{ flex: 1 }}>Known inmate: {target.name}</span>
              <button className="btn sm danger" disabled={!!inmate.prisonOperation}
                onClick={() => notify(act(s => requestPrisonAttack(s.world, gang.id, inmate.id, target.id)))}>Arrange attack · $650</button>
            </div>)}
          </div>
        ))}
        <Hint>Inmates learn only about people they share a prison with. Contacts and attacks resolve at morning roll call; an attack can extend a sentence and draw police attention.</Hint>
      </Panel>

      {continuous ? <PoliceCaseFiles world={w} viewer={gang.id} crimes={investigations}
        canInquire={!!lawyer} canHit={gang.teamIds.length > 0} investigationStatus={lawyerInquiryStatus}
        onInquiry={crimeId => notify(act(s => queueCrimeInquiry(s.world, gang.id, crimeId)))}
        onBribeOfficer={id => beginSpecialistOrder('bribeOfficials', id)} onPlanHit={id => planAgainst('kill', id)} /> :
      <Panel title="Police Investigations">
        {investigations.length === 0 ? <Empty>No open police files against your gang.</Empty> :
          investigations.slice(-12).map(crime => {
            const officer = crime.investigatorId == null ? undefined : w.people[crime.investigatorId];
            const known = !!crime.investigatorKnown || officer?.employedBy === gang.id || officer?.bribedBy === gang.id;
            return <div key={crime.id} style={{ padding: '5px 0', borderBottom: '1px dotted #bdb094' }}>
              <div className="tiny"><b>{crime.kind}</b> · {w.people[crime.perpetratorId]?.name ?? 'Unknown'} · {crime.investigatedAt == null ? 'police review pending' : cases.some(court => court.sourceCrimeId === crime.id && ['awaiting', 'onTrial'].includes(court.status)) ? 'court case open' : 'police review complete'}</div>
              {known && officer ? <div className="row wrap tiny" style={{ gap: 5, marginTop: 3 }}>
                <span style={{ flex: 1 }}>Officer: {officer.name}{officer.employedBy === gang.id ? ' · on your payroll' : ''}</span>
                <button className="btn sm" disabled={!lawyer} onClick={() => beginSpecialistOrder('bribeOfficials', officer.id)}>Bribe</button>
                <button className="btn sm danger" disabled={!gang.teamIds.length} onClick={() => planAgainst('kill', officer.id)}>Plan hit</button>
              </div> : <div className="row wrap tiny" style={{ gap: 5, marginTop: 3 }}>
                <span style={{ flex: 1 }}>Lead officer unknown</span>
                <button className="btn sm" disabled={!lawyer || lawyerInvestigating(crime.id)}
                  onClick={() => notify(act(s => queueCrimeInquiry(s.world, gang.id, crime.id)))}>
                  {lawyerInvestigating(crime.id) ? `Investigating · ${lawyerInquiryStatus(crime.id)}` : 'Ask lawyer'}
                </button>
              </div>}
            </div>;
          })}
        <Hint>A paid officer can identify a file he handles. Bribery may weaken its case; if an officer is killed, another takes over.</Hint>
      </Panel>}

      {continuous && detained.length > 0 && <Panel title="Custody review">
        {detained.map(person => <div className="police-file tiny" key={person.id}>
          <b>{person.name}</b>
          <div>Prosecutor review: {lawDeadline(w, person.custody!.reviewAt)}</div>
          <div>Charging deadline: {lawDeadline(w, person.custody!.releaseAt)}</div>
        </div>)}
        <Hint>The prosecutor must charge, request further investigation or release the suspect.
          Your lawyer defends your people when a case reaches court.</Hint>
      </Panel>}

      <Panel title="Legal Proceedings">
        {cases.length === 0 ? (
          <Empty>Nobody of yours is before the courts.</Empty>
        ) : (
          cases.map((c) => (
            <div key={c.id} style={{ padding: '5px 0', borderBottom: '1px dotted #bdb094' }}>
              <div className="row between">
                <b className="tiny">{w.people[c.defendantId]?.name}</b>
                <Pill kind={c.status === 'convicted' ? 'bad' : c.status === 'awaiting' || c.status === 'onTrial' || c.status === 'appealing' ? 'warn' : 'good'}>
                  {c.status}
                </Pill>
              </div>
              <div className="muted tiny">
                {c.crime} · Judge {w.people[c.judgeId]?.name} · DA {w.people[c.daId]?.name}
                {continuous && c.trialAt != null && ['awaiting', 'onTrial'].includes(c.status)
                  ? ` · hearing ${lawDeadline(w, c.trialAt)}` : !continuous && c.weeksToTrial > 0 && ` · trial in ${c.weeksToTrial} week(s)`}
                {continuous && c.status === 'appealing' && c.appealDueAt != null ? ` · appeal review ${lawDeadline(w, c.appealDueAt)}` : ''}
              </div>
              {continuous && (w.people[c.judgeId]?.publicService || w.people[c.daId]?.publicService) && <div className="muted tiny">
                Court records — Judge integrity {w.people[c.judgeId]?.publicService?.integrity ?? 'unknown'}; prosecutor integrity {w.people[c.daId]?.publicService?.integrity ?? 'unknown'}.
              </div>}
              {c.appealDecision === 'overturned' && <div className="tiny">Appeal overturned the conviction.</div>}
              {c.appealDecision === 'upheld' && <div className="tiny">Appeal upheld the conviction.</div>}
              {continuous && c.status === 'convicted' && (c.appealCount ?? 0) === 0 && <div className="row wrap tiny" style={{ gap: 5, marginTop: 3 }}>
                <span style={{ flex: 1 }}>File one appeal · ${COURT_APPEAL_COST.toLocaleString('en-US')}</span>
                <button className="btn sm" disabled={!lawyer || gang.cash < COURT_APPEAL_COST || w.people[c.defendantId]?.status !== 'jailed'}
                  onClick={() => notify(act(s => fileCourtAppeal(s.world, gang.id, c.id)))}>Appeal conviction</button>
              </div>}
              {['awaiting', 'onTrial'].includes(c.status) && <div className="row wrap tiny" style={{ gap: 5, marginTop: 3 }}>
                <span style={{ flex: 1 }}>Prosecutor: {w.people[c.daId]?.name ?? 'Unknown'}</span>
                <button className="btn sm" disabled={!lawyer} onClick={() => beginSpecialistOrder('bribeOfficials', c.daId)}>Bribe</button>
                <button className="btn sm danger" disabled={!gang.teamIds.length} onClick={() => planAgainst('kill', c.daId)}>Plan hit</button>
              </div>}
              {c.investigatorId != null && (() => {
                const officer = w.people[c.investigatorId];
                return officer && (c.investigatorKnown || officer.employedBy === gang.id || officer.bribedBy === gang.id) ?
                  <div className="row wrap tiny" style={{ gap: 5, marginTop: 3 }}>
                    <span style={{ flex: 1 }}>Investigating officer: {officer.name}</span>
                    <button className="btn sm" disabled={!lawyer} onClick={() => beginSpecialistOrder('bribeOfficials', officer.id)}>Bribe</button>
                    <button className="btn sm danger" disabled={!gang.teamIds.length} onClick={() => planAgainst('kill', officer.id)}>Plan hit</button>
                  </div> : null;
              })()}
              {c.knowsWitnesses && (
                <div className="tiny" style={{ marginTop: 2 }}>
                  <b>Witnesses</b>
                  {c.witnessIds.filter(id => w.people[id]?.status === 'active').length === 0 && <span>: none left</span>}
                  {c.witnessIds.map(id => w.people[id]).filter((p): p is Person => !!p && p.status === 'active').map(p => (
                    <div key={p.id} className="row wrap" style={{ gap: 5, marginTop: 3 }}>
                      <span style={{ flex: 1 }}>{p.name}{c.bribedWitnessIds?.includes(p.id) ? ' · bought' : c.silencedWitnessIds?.includes(p.id) ? ' · silent' : ''}</span>
                      <button className="btn sm" disabled={!gang.teamIds.length || !!c.silencedWitnessIds?.includes(p.id)} onClick={() => planAgainst('bribe', p.id)}>Bribe</button>
                      <button className="btn sm" disabled={!gang.teamIds.length || !!c.bribedWitnessIds?.includes(p.id) || !!c.silencedWitnessIds?.includes(p.id)}
                        onClick={() => planAgainst('pressureWitness', p.id)}>Pressure</button>
                      <button className="btn sm danger" disabled={!gang.teamIds.length} onClick={() => planAgainst('kill', p.id)}>Plan hit</button>
                    </div>
                  ))}
                </div>
              )}
              {c.knowsJurors && (
                <div className="tiny">
                  <b>Jurors</b>
                  {c.jurorIds.map(id => w.people[id]).filter((p): p is Person => !!p && p.status === 'active').map(p => (
                    <div key={p.id} className="row wrap" style={{ gap: 5, marginTop: 3 }}>
                      <span style={{ flex: 1 }}>{p.name}{c.bribedJurorIds?.includes(p.id) ? ' · bought' : ''}</span>
                      <button className="btn sm" disabled={!gang.teamIds.length} onClick={() => planAgainst('bribe', p.id)}>Bribe</button>
                      <button className="btn sm danger" disabled={!gang.teamIds.length} onClick={() => planAgainst('kill', p.id)}>Plan hit</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        <Hint>Bribed witnesses can withdraw; bribed jurors help the defence. Killing a juror forces a replacement and delays the hearing.</Hint>
      </Panel>

      <Panel title={continuous ? 'Outstanding warrants' : 'Most Wanted'}>
        {wanted.length === 0 ? (
          <Empty>{continuous ? 'No outstanding arrest warrants for your people.' : 'None of your people are being watched.'}</Empty>
        ) : (
          wanted.slice(0, 12).map((p) => (
            <div key={p.id} className="row between tiny" style={{ padding: '2px 0' }}>
              <span>{p.name}</span>
              <b className="mono">{continuous ? `${activeWarrants(w, p.id).length} warrant(s)` : Math.round(p.wanted)}</b>
            </div>
          ))
        )}
        <Hint>{continuous ? 'A warrant belongs to a particular case. Your lawyer can review it; hiding alone does not clear it.'
          : 'Keep a hot hood off the streets for a week or two and the heat falls away.'}</Hint>
      </Panel>

      <Panel title="Squealers">
        {squealers.length === 0 ? (
          <Empty>Nobody is talking.</Empty>
        ) : (
          squealers.slice(0, 12).map((p) => {
            const pos = personMapPosition(w, gang.id, p);
            return <div key={p.id} className="row wrap tiny" style={{ gap: 5, padding: '3px 0' }}>
              <button className="btn sm" style={{ flex: 1, textAlign: 'left' }} disabled={!pos}
                onClick={() => requestCamera(pos!)}>{p.name}</button>
              <Pill kind="bad">reported</Pill>
              <button className="btn sm" onClick={() => notify(act(s => togglePersonList(s.world, gang.id, p.id, 'hit')))}>
                {personListIds(w, gang.id, 'hit').includes(p.id) ? 'Unmark' : 'Hit list'}
              </button>
              <button className="btn sm danger" disabled={!gang.teamIds.length} onClick={() => planAgainst('kill', p.id)}>Plan hit</button>
            </div>;
          })
        )}
        <Hint>These people actually reported your gang. A planned hit still needs a crew and may draw another investigation.</Hint>
      </Panel>

      <Panel title="Crimes — This Week">
        {crimes.length === 0 ? (
          <Empty>Nothing on the books.</Empty>
        ) : (
          crimes.slice(-14).map((c) => (
            <div key={c.id} className="row between tiny" style={{ padding: '2px 0' }}>
              <span>
                {w.people[c.perpetratorId]?.name ?? 'Unknown'} — {c.kind}
              </span>
              <span className="muted mono">{continuous ? c.reported ? 'Reported' : 'No police report' : `${Math.round(c.arrestRisk * 100)}% risk`}</span>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
