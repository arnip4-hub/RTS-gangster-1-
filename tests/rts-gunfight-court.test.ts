import { describe, expect, it } from 'vitest';
import { defaultGameOptions } from '../src/app/newGame';
import { campaignMinute, FULL_DAY_MINUTES } from '../src/sim/calendar';
import { addCaseEvidence, ensurePoliceFile, refreshCaseIdentity } from '../src/sim/caseEvidence';
import { completeOfficialBribe } from '../src/sim/officials';
import { placeInPrison, requestPrisonAttack, tickPrison } from '../src/sim/prison';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { fileGunfight, SHOOTOUT_HOMICIDE } from '../src/sim/systems/combat';
import { tickRtsCourts } from '../src/sim/rtsCourts';
import { policeCaseView } from '../src/ui/policeCaseView';

function city() {
  const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, citySize: 10, seed: 7 });
  const w = sim.world;
  w.phase = 'week';
  w.minute = 600;
  w.crimes = [];
  w.cases = {};
  return { sim, w, gang: sim.playerGang };
}

describe('gunfight files and charges', () => {
  it('gives two shooters separate files and joins a later shot from the same shooter', () => {
    const { w, sim, gang } = city();
    const team = w.teams[gang.teamIds[0]];
    const [a, b] = [w.people[team.lieutenantId], w.people[team.memberIds[0]]];
    const victim = Object.values(w.people).find(p => p.role === 'citizen')!;
    a.gangId = gang.id;
    b.gangId = gang.id;
    fileGunfight(w, sim.rng, a, { x: 100, y: 100 }, true, victim.id);
    fileGunfight(w, sim.rng, b, { x: 104, y: 100 }, true, victim.id);
    fileGunfight(w, sim.rng, a, { x: 130, y: 100 }, false);
    const files = w.crimes.filter(c => c.kind === SHOOTOUT_HOMICIDE);
    expect(files).toHaveLength(2);
    expect(files.find(c => c.perpetratorId === a.id)?.shots).toBe(2);
    expect(files.find(c => c.perpetratorId === b.id)?.shots).toBe(1);
  });

  it('charges a second homicide naming the same suspect with the first', () => {
    const { w, sim, gang } = city();
    const suspect = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
    const [v1, v2] = Object.values(w.people).filter(p => p.role === 'citizen').slice(0, 2);
    const witness = Object.values(w.people).find(p => p.role === 'owner')!;
    const now = campaignMinute(w);
    for (const victim of [v1, v2]) {
      fileGunfight(w, sim.rng, suspect, victim.pos, true, victim.id);
      const crime = w.crimes.at(-1)!;
      const file = ensurePoliceFile(w, crime, victim.pos);
      file.statements.push({
        witnessId: witness.id, observation: 'face', confidence: 95, reliability: 95,
        observedAt: now - 10, reportedAt: now - 5, interviewedAt: now - 1, suspectId: suspect.id,
      });
      addCaseEvidence(w, crime, { kind: 'scene', strength: 40, collectedAt: now, note: 'Scene' });
      refreshCaseIdentity(w, crime);
      file.identityConfidence = 90;
      file.suspectId = suspect.id;
      crime.reported = true;
      crime.reportedAt = now - 5;
    }
    suspect.gangId = gang.id;
    suspect.status = 'arrested';
    suspect.custody = { crimeId: w.crimes[0].id, officerId: w.policeIds[0], arrestedAt: now, reviewAt: now, releaseAt: now + FULL_DAY_MINUTES };
    tickRtsCourts(w, sim.rng);
    const court = Object.values(w.cases).find(c => c.defendantId === suspect.id);
    expect(court?.companionCrimeIds).toEqual([w.crimes[1].id]);
    expect(court?.crime).toContain('2 counts');
    expect(policeCaseView(w, w.crimes[1], gang.id).court?.id).toBe(court?.id);
  });

  it('lets a bought prosecutor sit on an uncharged file', () => {
    const { w, sim, gang } = city();
    const suspect = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
    const da = w.people[w.daIds[0]];
    const witness = Object.values(w.people).find(p => p.role === 'owner')!;
    const now = campaignMinute(w);
    fileGunfight(w, sim.rng, suspect, { x: 20, y: 20 }, true, witness.id);
    const crime = w.crimes[0];
    const file = ensurePoliceFile(w, crime, { x: 20, y: 20 });
    file.statements.push({
      witnessId: witness.id, observation: 'face', confidence: 95, reliability: 95,
      observedAt: now - 10, reportedAt: now - 5, interviewedAt: now - 1, suspectId: suspect.id,
    });
    addCaseEvidence(w, crime, { kind: 'scene', strength: 50, collectedAt: now, note: 'Scene' });
    refreshCaseIdentity(w, crime);
    file.identityConfidence = 90;
    file.suspectId = suspect.id;
    file.prosecutorId = da.id;
    gang.cash = 100000;
    expect(completeOfficialBribe(w, gang.id, da, 1).ok).toBe(true);
    expect(file.statusNote).toBe('The prosecutor is sitting on this case.');
    suspect.status = 'arrested';
    suspect.custody = { crimeId: crime.id, officerId: w.policeIds[0], arrestedAt: now, reviewAt: now, releaseAt: now + FULL_DAY_MINUTES };
    tickRtsCourts(w, new Rng(1));
    expect(suspect.status).toBe('active');
    expect(file.prosecutorDecision).toBe('decline');
    expect(Object.values(w.cases)).toHaveLength(0);
  });
});

describe('prison killings', () => {
  it('files a murder with a guard observation when an inmate is killed', () => {
    const { w, sim, gang } = city();
    w.minute = 360;
    const attacker = w.people[w.teams[gang.teamIds[0]].memberIds[0]];
    const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const target = w.people[w.teams[rival.teamIds[0]].memberIds[0]];
    attacker.status = 'jailed';
    target.status = 'jailed';
    attacker.hp = 100;
    target.hp = 10;
    attacker.jailWeeks = 10;
    placeInPrison(w, attacker);
    placeInPrison(w, target);
    attacker.prisonId = 0;
    target.prisonId = 0;
    attacker.prisonSince = campaignMinute(w) - FULL_DAY_MINUTES;
    target.prisonSince = campaignMinute(w) - FULL_DAY_MINUTES;
    (gang.prisonIntel ??= {})[target.id] = { prisonId: 0, learnedAt: campaignMinute(w), sourceId: attacker.id };
    gang.cash = 10000;
    expect(requestPrisonAttack(w, gang.id, attacker.id, target.id).ok).toBe(true);
    attacker.prisonOperation!.dueAt = campaignMinute(w);
    viChance(sim);
    tickPrison(w, sim.rng);
    expect(target.status).toBe('dead');
    const crime = w.crimes.find(c => c.kind === 'kill' && c.victimId === target.id);
    expect(crime?.perpetratorId).toBe(attacker.id);
    expect(crime?.police?.statements.some(s => s.observation === 'direct' && s.suspectId === attacker.id)).toBe(true);
    expect(attacker.jailWeeks).toBeGreaterThanOrEqual(8);
  });
});

function viChance(sim: Sim) {
  sim.rng.chance = () => true;
  sim.rng.int = () => 100;
}
