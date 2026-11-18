import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CourtCase, CrimeRecord, Person, PoliceFile, WorldState } from '../src/sim/types';
import { PoliceCaseFiles } from '../src/ui/PoliceCasePanel';
import { activeWarrants, lawDeadline, personWantedLabel, policeCaseView, policeFileDisclosed } from '../src/ui/policeCaseView';

function fixture() {
  const person = (id: number, name: string, role: Person['role'], gangId: number | null) =>
    ({ id, name, role, gangId, status: 'active', wanted: 0, employedBy: null, bribedBy: null } as Person);
  const file: PoliceFile = { agency: 'police', stage: 'investigating', openedAt: 500,
    pos: { x: 20, y: 30 }, identityConfidence: 0, nextReviewAt: 630, lastLeadAt: 550,
    statements: [{ witnessId: 4, observation: 'description', confidence: 45, reliability: 70,
      observedAt: 500, reportedAt: 510, description: 'A tall figure in a dark coat.' }],
    evidence: [{ kind: 'scene', strength: 10, collectedAt: 550, note: 'Recovered cartridge at the scene.' }],
  };
  const crime: CrimeRecord = { id: 1, week: 1, gangId: 1, perpetratorId: 1, kind: 'kill',
    buildingId: null, victimId: null, witnesses: [4], arrestRisk: .8, reported: true, reportedAt: 510,
    investigatorId: 3, police: file };
  const w = { options: { continuousTime: true }, week: 1, minute: 600, crimes: [crime], cases: {},
    people: { 1: person(1, 'Actual culprit', 'hood', 1), 2: person(2, 'Named suspect', 'hood', 1),
      3: person(3, 'Assigned officer', 'police', null), 4: person(4, 'Hidden witness', 'citizen', null),
      5: person(5, 'District attorney', 'da', null), 6: person(6, 'Other officer', 'police', null) },
  } as unknown as WorldState;
  return { w, crime, file };
}
function render(w: WorldState, crime: CrimeRecord) {
  return renderToStaticMarkup(createElement(PoliceCaseFiles, { world: w, viewer: 1, crimes: [crime], canInquire: true,
    canHit: true, investigationStatus: () => null, onInquiry() {}, onBribeOfficer() {}, onPlanHit() {} }));
}

describe('RTS police file presentation', () => {
  it('does not turn the actual culprit into a named suspect, even after a file inquiry', () => {
    const { w, crime, file } = fixture();
    expect(policeCaseView(w, crime, 1).suspectName).toBeNull();
    expect(render(w, crime)).not.toContain('Actual culprit');
    file.disclosureKnown = true;
    const view = policeCaseView(w, crime, 1);
    expect(view.status).toContain('offender unidentified');
    expect(view.suspectName).toBeNull();
    expect(render(w, crime)).not.toContain('Actual culprit');
  });

  it('discloses the police identification rather than silently substituting ground truth', () => {
    const { w, crime, file } = fixture();
    file.suspectId = 2; file.identityConfidence = 65;
    file.prosecutorId = 5; file.prosecutorDecision = 'investigate';
    expect(render(w, crime)).not.toContain('Named suspect');
    expect(render(w, crime)).not.toContain('Recovered cartridge');
    expect(render(w, crime)).not.toContain('Assigned officer');
    expect(render(w, crime)).not.toContain('District attorney');
    file.disclosureKnown = true;
    const html = render(w, crime);
    expect(html).toContain('Named suspect');
    expect(html).not.toContain('Actual culprit');
    expect(html).toContain('Assigned officer');
    expect(html).toContain('Recovered cartridge');
    expect(html).toContain('Further investigation requested');
    expect(html).not.toContain('Hidden witness');
  });

  it('does not reveal future reports or observations before police receive them', () => {
    const { w, crime, file } = fixture(); file.disclosureKnown = true;
    file.statements[0].reportedAt = 700;
    file.evidence[0].collectedAt = 700;
    expect(policeCaseView(w, crime, 1).statements).toEqual([]);
    expect(policeCaseView(w, crime, 1).evidence).toEqual([]);
    w.minute = 700;
    expect(policeCaseView(w, crime, 1).statements).toHaveLength(1);
    expect(policeCaseView(w, crime, 1).evidence).toHaveLength(1);
  });

  it('only a paid officer assigned to the file grants access', () => {
    const { w, crime } = fixture(); w.people[6].employedBy = 1;
    expect(policeFileDisclosed(w, crime, 1)).toBe(false);
    w.people[3].employedBy = 1;
    expect(policeFileDisclosed(w, crime, 1)).toBe(true);
    expect(policeFileDisclosed(w, crime, 2)).toBe(false);
  });

  it('does not let an unreceived statement change the known description or incident title', () => {
    const { w, crime, file } = fixture(); file.disclosureKnown = true; file.evidence = [];
    file.statements[0].observation = 'sound';
    file.statements.push({ witnessId: 4, observation: 'face', confidence: 80, reliability: 80,
      observedAt: 500, reportedAt: 700 });
    expect(policeCaseView(w, crime, 1).title).toBe('Reported disturbance');
    expect(policeCaseView(w, crime, 1).status).toBe('Offender unidentified');
    w.minute = 700;
    expect(policeCaseView(w, crime, 1).title).toBe('kill');
    expect(policeCaseView(w, crime, 1).status).toContain('Description only');
  });

  it('shows a public warrant without exposing statements or officer identities', () => {
    const { w, crime, file } = fixture();
    file.suspectId = 2; file.stage = 'wanted'; file.warrantAt = 590;
    const html = render(w, crime);
    expect(html).toContain('Named suspect');
    expect(html).toContain('Arrest warrant');
    expect(html).not.toContain('Hidden witness');
    expect(html).not.toContain('Assigned officer');
    expect(html).not.toContain('Recovered cartridge');
  });

  it('uses actual active warrants rather than stale numerical heat in RTS mode', () => {
    const { w, file } = fixture(); w.people[1].wanted = 100;
    expect(personWantedLabel(w, w.people[1])).toBe('No active warrant');
    file.suspectId = 2; file.stage = 'wanted'; file.warrantAt = 590; file.warrantExpiresAt = 650;
    expect(personWantedLabel(w, w.people[2])).toBe('Arrest warrant');
    expect(activeWarrants(w, 1)).toEqual([]);
    w.minute = 651;
    expect(personWantedLabel(w, w.people[2])).toBe('No active warrant');
    w.options.continuousTime = false;
    expect(personWantedLabel(w, w.people[1])).toBe('Wanted 100');
  });

  it('shows the known defendant after charging without exposing undisclosed evidence', () => {
    const { w, crime } = fixture();
    w.cases[7] = { id: 7, sourceCrimeId: 1, defendantId: 2, gangId: 1, daId: 5, status: 'awaiting' } as CourtCase;
    const view = policeCaseView(w, crime, 1);
    expect(view.suspectName).toBe('Named suspect');
    expect(view.prosecutorId).toBe(5);
    expect(view.disclosed).toBe(false);
    expect(view.evidence).toEqual([]);
  });

  it('formats deadlines in the seven-day 24-hour calendar across a week boundary', () => {
    const { w } = fixture(); w.minute = 10050;
    expect(lawDeadline(w, 10140)).toBe('Mon 01:00 · in 1h 30m');
    w.week = 2; w.minute = 60;
    expect(lawDeadline(w, 10140)).toBe('due now');
  });
});
