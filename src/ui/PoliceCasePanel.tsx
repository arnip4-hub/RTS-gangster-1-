import { useState } from 'react';
import type { CrimeRecord, ID, Person, WorldState } from '../sim/types';
import { bribePrice } from '../sim/api';
import { money } from '../sim/world';
import { Empty, Hint, Modal, Panel, Pill } from './common';
import { activeWarrants, lawDeadline, OBSERVATION_LABELS, policeCaseView } from './policeCaseView';

interface Props {
  world: WorldState;
  viewer: ID;
  crimes: CrimeRecord[];
  canInquire: boolean;
  canHit: boolean;
  investigationStatus: (crimeId: ID) => string | null;
  onInquiry: (crimeId: ID) => void;
  onBribeOfficer: (personId: ID) => void;
  onPlanHit: (personId: ID) => void;
  onBribeCitizen?: (personId: ID) => void;
}

/** The lawyer's view of a file, rather than the simulation's incident record. */
export function PoliceCaseFiles({ world: w, viewer, crimes, canInquire, canHit,
  investigationStatus, onInquiry, onBribeOfficer, onPlanHit, onBribeCitizen }: Props) {
  const [openId, setOpenId] = useState<ID | null>(null);
  const [picked, setPicked] = useState<ID | null>(null);
  const open = openId == null ? undefined : crimes.find(c => c.id === openId);
  return <Panel title="Police and Bureau files">
    {!crimes.length ? <Empty>No reported police files against your gang.</Empty> : crimes.slice(-16).map(crime => {
      const view = policeCaseView(w, crime, viewer), file = crime.police;
      const officer = crime.investigatorId == null ? undefined : w.people[crime.investigatorId];
      const status = investigationStatus(crime.id), reviewing = status != null;
      return <article key={crime.id} className="police-file police-file-open" aria-label={`Case file ${crime.id}`}
        onClick={() => { setOpenId(crime.id); setPicked(null); }}>
        <div className="row between tiny">
          <b>#{crime.id} · {view.title}</b>
          <Pill kind={view.disclosed && file?.stage === 'closed' ? 'good' : 'warn'}>{view.disclosed || view.suspectName
            ? file?.agency === 'fbi' ? 'FBI' : 'Police' : 'Authorities'}</Pill>
        </div>
        <div className="tiny">{view.status}</div>
        {view.reason && <div className="muted tiny">{view.reason}</div>}
        <div className="muted tiny">{view.suspectName ? `Named suspect: ${view.suspectName}`
          : view.disclosed ? 'No offender has been identified.' : 'Suspect details require a file inquiry.'}</div>
        {view.disclosed && officer ? <div className="row wrap tiny" style={{ gap: 5, marginTop: 4 }}>
          <span style={{ flex: 1 }}>Lead officer: {officer.name}{officer.employedBy === viewer ? ' · on your payroll' : ''}</span>
          {officer.role === 'police' && <button className="btn sm" disabled={!canInquire}
            onClick={e => { e.stopPropagation(); onBribeOfficer(officer.id); }}>Bribe</button>}
          <button className="btn sm danger" disabled={!canHit} onClick={e => { e.stopPropagation(); onPlanHit(officer.id); }}>Plan hit</button>
        </div> : <div className="row wrap tiny" style={{ gap: 5, marginTop: 4 }}>
          <span style={{ flex: 1 }}>{view.disclosed ? 'An investigator has not been assigned.' : 'File contents not disclosed.'}</span>
          {!view.disclosed && <button className="btn sm" disabled={!canInquire || reviewing}
            onClick={e => { e.stopPropagation(); onInquiry(crime.id); }}>{reviewing ? 'Investigation in progress' : 'Ask lawyer to investigate'}</button>}
        </div>}
        {reviewing && <div className="muted tiny" style={{ marginTop: 4 }}>{status}</div>}
        {view.disclosed && <>
          {officer?.publicService && <div className="muted tiny">Investigator record: {officer.publicService.casesHandled} case(s), {officer.publicService.mistakes} recorded error(s), integrity {officer.publicService.integrity}/100.</div>}
          <dl className="police-file-facts tiny">
            {file?.suspectId != null && <><dt>Identification</dt><dd>{Math.round(file.identityConfidence)}% confidence</dd></>}
            {file?.warrantAt != null && <><dt>Warrant</dt><dd>{file.suspectId != null && activeWarrants(w, file.suspectId).some(c => c.id === crime.id)
              ? file.warrantExpiresAt != null ? `Expires: ${lawDeadline(w, file.warrantExpiresAt)}` : 'Outstanding until served or withdrawn'
              : 'No active warrant'}</dd></>}
            {view.prosecutorId != null && <><dt>Prosecutor</dt><dd>{w.people[view.prosecutorId]?.name ?? 'Assignment pending'}</dd></>}
            {view.prosecutorDecision && <><dt>Charging review</dt><dd>{({ pending: 'Decision pending', investigate: 'Further investigation requested',
              charge: 'Proceed with charges', decline: 'Charges declined' })[view.prosecutorDecision]}</dd></>}
            {file?.reviewDueAt != null && file.prosecutorDecision === 'pending' && <><dt>Decision due</dt><dd>{lawDeadline(w, file.reviewDueAt)}</dd></>}
            {file?.proceduralError && <><dt>Investigative error</dt><dd>{file.proceduralError.correctedAt == null
              ? 'Early scene handling error; independent review pending'
              : `Corrected by ${w.people[file.proceduralError.correctedBy ?? -1]?.name ?? 'a supervisor'}`}</dd></>}
            {file?.politicalPressure && <><dt>Political pressure</dt><dd>{w.people[file.politicalPressure.sourceId]?.name ?? 'An official'} delayed the review until {lawDeadline(w, file.politicalPressure.until)}</dd></>}
            {file?.interrogation && <><dt>Detention interview</dt><dd>{w.people[file.interrogation.interviewerId]?.name ?? 'Investigator'} · {{
              'no-comment': 'declined to answer', inconsistent: 'account changed', 'new-lead': 'gave a lead for follow-up',
            }[file.interrogation.outcome]} · {file.interrogation.reliability}% reliability</dd></>}
          </dl>
          <details className="police-file-details" onClick={e => e.stopPropagation()}>
            <summary className="tiny">Statements ({view.statements.length}) · Evidence ({view.evidence.length})</summary>
            {view.statements.length === 0 && <p className="tiny muted">No statements on file.</p>}
            {view.statements.map((statement, i) => <div className="police-statement tiny" key={`${statement.witnessId}-${i}`}>
              <b>{view.disclosed || view.court?.knowsWitnesses ? w.people[statement.witnessId]?.name ?? `Witness ${i + 1}` : `Statement ${i + 1}`}</b>
              {' · '}{OBSERVATION_LABELS[statement.observation]} · {Math.round(statement.confidence)}% confidence
              {statement.withdrawn && <span> · withdrawn</span>}
              {statement.interviewedAt == null && <span> · interview pending</span>}
              {statement.description && <div className="muted">{statement.description}</div>}
            </div>)}
            {view.evidence.map((evidence, i) => <div className="police-statement tiny" key={`${evidence.kind}-${i}`}>
              <b>{evidence.kind}</b> · {evidence.note}
            </div>)}
          </details>
        </>}
      </article>;
    })}
    <Hint>Click a file to choose an officer, a prosecutor or a juror. The lawyer buys officials; a crew buys or silences jurors.</Hint>
    {open && <CaseDesk world={w} viewer={viewer} crime={open} canInquire={canInquire} canHit={canHit}
      picked={picked} onPick={setPicked} onClose={() => setOpenId(null)}
      onInquiry={onInquiry} onBribeOfficer={onBribeOfficer} onPlanHit={onPlanHit} onBribeCitizen={onBribeCitizen} />}
  </Panel>;
}

function CaseDesk({ world: w, viewer, crime, canInquire, canHit, picked, onPick, onClose,
  onInquiry, onBribeOfficer, onPlanHit, onBribeCitizen }: {
  world: WorldState; viewer: ID; crime: CrimeRecord; canInquire: boolean; canHit: boolean;
  picked: ID | null; onPick: (id: ID) => void; onClose: () => void;
  onInquiry: (crimeId: ID) => void; onBribeOfficer: (personId: ID) => void;
  onPlanHit: (personId: ID) => void; onBribeCitizen?: (personId: ID) => void;
}) {
  const view = policeCaseView(w, crime, viewer);
  const file = crime.police;
  const court = view.court;
  const lead = view.disclosed && crime.investigatorId != null ? w.people[crime.investigatorId] : undefined;
  const assignedDa = view.disclosed && view.prosecutorId != null ? w.people[view.prosecutorId] : undefined;
  const assignedJudge = court ? w.people[court.judgeId] : undefined;
  const jurorsKnown = !!court?.knowsJurors;
  const jurors = jurorsKnown ? court!.jurorIds.map(id => w.people[id]).filter((p): p is Person => !!p) : [];
  const chosen = picked == null ? undefined : w.people[picked];
  const official = chosen && ['police', 'da', 'judge', 'policeChief', 'mayor'].includes(chosen.role);
  const charging = file?.prosecutorDecision ? ({ pending: 'Decision pending', investigate: 'Further investigation requested',
    charge: 'Proceed with charges', decline: 'Charges declined' })[file.prosecutorDecision] : undefined;
  const charged = file?.prosecutorDecision === 'charge' || !!court;
  const bribeEffect = !chosen ? ''
    : chosen.role === 'da' && !charged ? 'He will sit on this case and your man will be released.'
    : chosen.role === 'da' && court && !court.knowsWitnesses ? 'He will name the witnesses. A second bribe names the jurors.'
    : chosen.role === 'da' && court && !court.knowsJurors ? 'He will name the jurors.'
    : chosen.role === 'da' ? 'He has already opened the lists. This bribe buys nothing more.'
    : chosen.role === 'judge' && court ? 'He will hear this case, and the prosecution will be weakened.'
    : chosen.role === 'police' ? 'A bought lead officer weakens the prosecution.'
    : 'A crew bribe. A bought juror helps the defence.';
  return <Modal title={`#${crime.id} · ${view.title}`} kicker="Case desk" onClose={onClose} width={640}
    footer={<button className="btn" onClick={onClose}>Close</button>}>
    <dl className="police-file-facts tiny">
      <dt>Where it stands</dt><dd>{view.status}</dd>
      {view.suspectName && <><dt>Named suspect</dt><dd>{view.suspectName}</dd></>}
      {charging && <><dt>Charging</dt><dd>{charging}</dd></>}
      {court && <><dt>Court</dt><dd>{{ awaiting: 'Awaiting hearing', onTrial: 'Hearing in progress', appealing: 'Appeal pending',
        acquitted: 'Acquitted', convicted: 'Convicted', dismissed: 'Dismissed' }[court.status]}{court.trialAt != null && ['awaiting', 'onTrial'].includes(court.status) ? ` · hearing ${lawDeadline(w, court.trialAt)}` : ''}</dd></>}
      {file?.reviewDueAt != null && file.prosecutorDecision === 'pending' && <><dt>Decision due</dt><dd>{lawDeadline(w, file.reviewDueAt)}</dd></>}
      {file?.warrantAt != null && <><dt>Warrant</dt><dd>{file.suspectId != null && activeWarrants(w, file.suspectId).some(c => c.id === crime.id) ? 'Outstanding' : 'None active'}</dd></>}
    </dl>
    {view.reason && <div className="muted tiny" style={{ marginBottom: 8 }}>{view.reason}</div>}
    {!view.disclosed && <button className="btn sm" disabled={!canInquire} onClick={() => onInquiry(crime.id)}>Ask lawyer to investigate</button>}

    <h4 className="tiny" style={{ margin: '12px 0 4px' }}>Police</h4>
    <Slot person={lead} empty={view.disclosed ? 'No lead officer assigned.' : '—  The lawyer has not opened this file.'}
      picked={picked} onPick={onPick} tag={lead?.bribedBy === viewer ? 'bought' : lead?.employedBy === viewer ? 'on payroll' : ''} />

    <h4 className="tiny" style={{ margin: '12px 0 4px' }}>Prosecutor</h4>
    <Slot person={assignedDa} empty="—  No prosecutor assigned."
      picked={picked} onPick={onPick} tag={assignedDa?.bribedBy === viewer ? 'bought' : ''} />

    <h4 className="tiny" style={{ margin: '12px 0 4px' }}>Judge</h4>
    <Slot person={court ? assignedJudge : undefined} empty="—  No judge until charges are filed."
      picked={picked} onPick={onPick} tag={court?.judgeBribed ? 'bought' : ''} />

    <h4 className="tiny" style={{ margin: '12px 0 4px' }}>Witnesses</h4>
    {!view.disclosed && !court?.knowsWitnesses ? <Slot empty="—  Names come with the file." />
      : view.statements.length === 0 ? <Slot empty="—  No witnesses on file." />
      : <div className="case-slots">{view.statements.map((s, i) => {
          const person = w.people[s.witnessId];
          return <Slot key={`${s.witnessId}-${i}`} person={person} picked={picked} onPick={onPick}
            tag={s.withdrawn ? 'withdrawn' : s.observation === 'face' || s.observation === 'direct' ? s.observation : ''} />;
        })}</div>}

    <h4 className="tiny" style={{ margin: '12px 0 4px' }}>Jury</h4>
    {!court ? <Slot empty="—  No jury until charges are filed." />
      : !jurorsKnown ? <div className="case-slots">{Array.from({ length: 6 }, (_, i) =>
          <Slot key={i} empty="—  Not disclosed." />)}</div>
      : <div className="case-slots">{jurors.map(p => <Slot key={p.id} person={p} picked={picked} onPick={onPick}
          tag={court.bribedJurorIds?.includes(p.id) ? 'bought' : ''} />)}</div>}

    {chosen && <div style={{ marginTop: 12 }}>
      <div className="muted tiny" style={{ marginBottom: 6 }}>{bribeEffect}</div>
      <div className="row wrap tiny" style={{ gap: 6 }}>
        <b style={{ flex: 1 }}>{chosen.name}{official ? ` · ${money(bribePrice(w, chosen, viewer))}` : ''}</b>
        {official ? <button className="btn sm" disabled={!canInquire} onClick={() => onBribeOfficer(chosen.id)}>Bribe</button>
          : <button className="btn sm" disabled={!canHit || !onBribeCitizen} onClick={() => onBribeCitizen?.(chosen.id)}>Bribe</button>}
        <button className="btn sm danger" disabled={!canHit} onClick={() => onPlanHit(chosen.id)}>Plan hit</button>
      </div>
    </div>}
  </Modal>;
}

function Slot({ person, empty, picked, onPick, tag }: {
  person?: Person; empty?: string; picked?: ID | null; onPick?: (id: ID) => void; tag?: string;
}) {
  if (!person) return <div className="case-slot empty">{empty ?? '—'}</div>;
  return <button type="button" className={`case-slot${picked === person.id ? ' selected' : ''}`}
    aria-pressed={picked === person.id} onClick={() => onPick?.(person.id)}>
    <span>{person.name}</span>
    {tag && <span className="muted">{tag}</span>}
  </button>;
}
