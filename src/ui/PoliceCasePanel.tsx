import type { CrimeRecord, ID, WorldState } from '../sim/types';
import { Empty, Hint, Panel, Pill } from './common';
import { activeWarrants, lawDeadline, OBSERVATION_LABELS, policeCaseView } from './policeCaseView';

interface Props {
  world: WorldState;
  viewer: ID;
  crimes: CrimeRecord[];
  canInquire: boolean;
  canHit: boolean;
  isInvestigating: (crimeId: ID) => boolean;
  onInquiry: (crimeId: ID) => void;
  onBribeOfficer: (personId: ID) => void;
  onPlanHit: (personId: ID) => void;
}

/** The lawyer's view of a file, rather than the simulation's incident record. */
export function PoliceCaseFiles({ world: w, viewer, crimes, canInquire, canHit, isInvestigating,
  onInquiry, onBribeOfficer, onPlanHit }: Props) {
  return <Panel title="Police and Bureau files">
    {!crimes.length ? <Empty>No reported police files against your gang.</Empty> : crimes.slice(-16).map(crime => {
      const view = policeCaseView(w, crime, viewer), file = crime.police;
      const officer = crime.investigatorId == null ? undefined : w.people[crime.investigatorId];
      const reviewing = isInvestigating(crime.id);
      return <article key={crime.id} className="police-file" aria-label={`Case file ${crime.id}`}>
        <div className="row between tiny">
          <b>#{crime.id} · {view.title}</b>
          <Pill kind={view.disclosed && file?.stage === 'closed' ? 'good' : 'warn'}>{view.disclosed || view.suspectName
            ? file?.agency === 'fbi' ? 'FBI' : 'Police' : 'Authorities'}</Pill>
        </div>
        <div className="tiny">{view.status}</div>
        <div className="muted tiny">{view.suspectName ? `Named suspect: ${view.suspectName}`
          : view.disclosed ? 'No offender has been identified.' : 'Suspect details require a file inquiry.'}</div>
        {view.disclosed && officer ? <div className="row wrap tiny" style={{ gap: 5, marginTop: 4 }}>
          <span style={{ flex: 1 }}>Lead officer: {officer.name}{officer.employedBy === viewer ? ' · on your payroll' : ''}</span>
          {officer.role === 'police' && <button className="btn sm" disabled={!canInquire}
            onClick={() => onBribeOfficer(officer.id)}>Bribe</button>}
          <button className="btn sm danger" disabled={!canHit} onClick={() => onPlanHit(officer.id)}>Plan hit</button>
        </div> : <div className="row wrap tiny" style={{ gap: 5, marginTop: 4 }}>
          <span style={{ flex: 1 }}>{view.disclosed ? 'An investigator has not been assigned.' : 'File contents not disclosed.'}</span>
          {!view.disclosed && <button className="btn sm" disabled={!canInquire || reviewing}
            onClick={() => onInquiry(crime.id)}>{reviewing ? 'Reviewing file' : 'Ask lawyer'}</button>}
        </div>}
        {view.disclosed && <>
          <dl className="police-file-facts tiny">
            {file?.suspectId != null && <><dt>Identification</dt><dd>{Math.round(file.identityConfidence)}% confidence</dd></>}
            {file?.warrantAt != null && <><dt>Warrant</dt><dd>{file.suspectId != null && activeWarrants(w, file.suspectId).some(c => c.id === crime.id)
              ? file.warrantExpiresAt != null ? `Expires: ${lawDeadline(w, file.warrantExpiresAt)}` : 'Outstanding until served or withdrawn'
              : 'No active warrant'}</dd></>}
            {view.prosecutorId != null && <><dt>Prosecutor</dt><dd>{w.people[view.prosecutorId]?.name ?? 'Assignment pending'}</dd></>}
            {view.prosecutorDecision && <><dt>Charging review</dt><dd>{({ pending: 'Decision pending', investigate: 'Further investigation requested',
              charge: 'Proceed with charges', decline: 'Charges declined' })[view.prosecutorDecision]}</dd></>}
            {file?.reviewDueAt != null && file.prosecutorDecision === 'pending' && <><dt>Decision due</dt><dd>{lawDeadline(w, file.reviewDueAt)}</dd></>}
          </dl>
          <details className="police-file-details">
            <summary className="tiny">Statements ({view.statements.length}) · Evidence ({view.evidence.length})</summary>
            {view.statements.length === 0 && <p className="tiny muted">No statements on file.</p>}
            {view.statements.map((statement, i) => <div className="police-statement tiny" key={`${statement.witnessId}-${i}`}>
              <b>{view.court?.knowsWitnesses ? w.people[statement.witnessId]?.name ?? `Witness ${i + 1}` : `Statement ${i + 1}`}</b>
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
    <Hint>The lawyer can obtain file details. A paid lead officer can disclose his own file.
      A report or a description does not establish who committed the crime.</Hint>
  </Panel>;
}
