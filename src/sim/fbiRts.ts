import { campaignMinute } from './calendar';
import { addCaseEvidence, caseEvidenceStrength, ensurePoliceFile, refreshPoliceWanted, refreshCaseIdentity, caseHasWarrant } from './caseEvidence';
import { isWeekend } from './duty';
import { addMessage, addNews } from './events';
import { stopBusinessGuards } from './execution';
import { currentFinances } from './finances';
import { clearDestination } from './movement';
import { tryCaseArrest } from './policeCases';
import { availableSpecialist } from './specialists';
import { alight } from './transport';
import type { Building, CrimeRecord, ID, Person, WorldState } from './types';
import type { Rng } from './rng';
import { buildingDoor, buildingName, dist } from './world';
import { hasWitnessLineOfSight, witnessNight } from './witnessStatements';

const legacyImported = new WeakSet<WorldState>();
const OPEN = new Set(['reported', 'investigating', 'cold', 'identified', 'wanted']);

/** A lead is an inquiry, not a fabricated second world crime. */
function siteInquiry(w: WorldState, gangId: ID, buildingId: ID, note: string, witnessId?: ID): CrimeRecord {
  const previous = w.crimes.find(c => c.leadOnly && c.gangId === gangId && c.buildingId === buildingId &&
    c.police && OPEN.has(c.police.stage));
  if (previous) return previous;
  const crime: CrimeRecord = {
    id: w.sequences.crime++, week: w.week, gangId, perpetratorId: 0,
    kind: 'racketeering', buildingId, victimId: null, witnesses: witnessId == null ? [] : [witnessId],
    reported: true, reportedAt: campaignMinute(w), arrestRisk: 0, leadOnly: true,
  };
  w.crimes.push(crime);
  ensurePoliceFile(w, crime, buildingDoor(w, w.buildings[buildingId]), 'fbi');
  if (w.gangs[gangId]?.isPlayer) addMessage(w, 'police', `The FBI opened an inquiry: ${note}`, null);
  return crime;
}

/** Old discovered flags represent already acquired knowledge, not a licence
 * to keep the original's automatic next-week raid or remote arrest. */
function importLegacyLeads(w: WorldState): void {
  if (legacyImported.has(w)) return;
  legacyImported.add(w);
  for (const agentId of w.fbiIds) {
    const p = w.people[agentId];
    if (!p?.fbiAssignment) continue;
    delete p.fbiAssignment;
    if (!p.policeTask && !p.streetOrder && p.orderId == null && !p.emergencyResponse) clearDestination(p);
  }
  for (const gang of Object.values(w.gangs)) delete gang.fbiRaidWeek;
  for (const b of Object.values(w.buildings)) {
    if (!b.discovered || b.fbiDiscoveredWeek == null || b.ownerGangId == null || b.state === 'destroyed' || b.fbiClosedWeek != null) continue;
    const front = b.frontId == null ? b : w.buildings[b.frontId] ?? b;
    const note = `Prior FBI file for premises ${front.id}`;
    // The process-local guard is only a scan optimization. The saved marker
    // prevents a concluded investigation being recreated after every reload.
    if (w.crimes.some(c => c.police?.evidence.some(e => e.note === note))) continue;
    const crime = siteInquiry(w, b.ownerGangId, front.id, 'a previously identified operation');
    addCaseEvidence(w, crime, { kind: 'scene', strength: 15, collectedAt: campaignMinute(w), buildingId: front.id,
      note });
    delete b.fbiRaidWeek;
  }
}

/** A recorded owner's complaint supplies an address, not the identities of
 * every hood, manager or hidden business at that address. */
function informantLeads(w: WorldState): void {
  for (const p of Object.values(w.people)) {
    if (p.status !== 'active' || !p.squealedOn) continue;
    for (const [id, at] of Object.entries(p.squealedOn)) {
      const gangId = Number(id);
      if (!w.gangs[gangId] || at > campaignMinute(w)) continue;
      const note = `Owner complaint ${p.id} at ${at}`;
      if (w.crimes.some(c => c.police?.evidence.some(e => e.note === note))) continue;
      const site = Object.values(w.buildings).find(b => b.ownerPersonId === p.id && b.state !== 'destroyed');
      if (!site) continue;
      const crime = siteInquiry(w, gangId, site.id, 'an owner reported a protection racket', p.id);
      addCaseEvidence(w, crime, { kind: 'informant', strength: 16, collectedAt: campaignMinute(w),
        witnessId: p.id, buildingId: site.id, note });
    }
  }
}

/** Federal interest follows information actually reported or disclosed. */
export function dispatchRtsFbi(w: WorldState): void {
  if (!w.options.continuousTime || w.phase !== 'week') return;
  importLegacyLeads(w);
  if (!isWeekend(w)) informantLeads(w);
  for (const crime of w.crimes) {
    if (!crime.reported || crime.charge || crime.police?.stage === 'closed') continue;
    if (!['kidnap', 'hijack', 'taxEvasion'].includes(crime.kind)) continue;
    const file = ensurePoliceFile(w, crime, undefined, 'fbi');
    if (crime.investigatorId != null && w.people[crime.investigatorId]?.role !== 'fbi' &&
      !w.people[crime.investigatorId]?.policeTask) delete crime.investigatorId;
    // A tax disclosure is usable only when the accountant supplied actual
    // recorded tax information; zeal/low Intelligence cannot invent evasion.
    if (crime.kind === 'taxEvasion') {
      const accountant = crime.witnesses.map(id => w.people[id]).find(p => p?.role === 'accountant' &&
        (p.taxRecords?.[crime.gangId] ?? 0) > 0);
      if (accountant && crime.perpetratorId > 0) addCaseEvidence(w, crime, {
        kind: 'financial', strength: 55, collectedAt: campaignMinute(w), personId: crime.perpetratorId,
        witnessId: accountant.id, note: `Disclosed tax records from ${accountant.id} for file ${crime.id}`,
      });
    }
    file.agency = 'fbi';
  }
}

/** Look only at an agent's current, physically reached lead. Goods hidden in
 * city-wide inventories are never scanned to choose surveillance targets. */
export function observeRtsFbiLead(w: WorldState, rng: Rng, agent: Person): void {
  const task = agent.policeTask;
  if (agent.role !== 'fbi' || agent.status !== 'active' || !task || task.kind !== 'surveillance' || task.phase !== 'working') return;
  const crime = w.crimes.find(c => c.id === task.crimeId), file = crime?.police;
  if (!crime || !file || file.agency !== 'fbi' || crime.buildingId == null || !OPEN.has(file.stage)) return;
  const front = w.buildings[crime.buildingId];
  if (!front || dist(agent.pos, buildingDoor(w, front)) > 12 || agent.buildingId != null) return;
  const now = campaignMinute(w);
  if (task.observedAt != null && now - task.observedAt < 15) return;
  task.observedAt = now;
  for (const [key, delivery] of Object.entries(w.goodsDeliveries ?? {})) {
    if (delivery.returning || delivery.amount <= 0 || !delivery.halted || !(delivery.unloadLeft! > 0) ||
      dist(delivery.pos, buildingDoor(w, front)) > 12 || dist(delivery.pos, agent.pos) > 18 ||
      !hasWitnessLineOfSight(w, agent.pos, delivery.pos) ||
      !['liquor', 'stolen', 'counterfeit'].includes(delivery.kind)) continue;
    // A legal manifest and a convincing front make concealment better, but
    // observation of an actual unloading can still reveal the illicit load.
    const chance = (.3 + agent.skills.intelligence * .08 - front.cover * .2 - (delivery.manifestCases ? .3 : 0)) *
      (witnessNight(w) ? .7 : 1);
    if (!rng.chance(Math.max(.05, Math.min(.8, chance)))) continue;
    const note = `Observed illicit unloading ${key} at ${front.id} on day ${Math.floor(now / 1440)}`;
    if (file.evidence.some(e => e.note === note)) continue;
    addCaseEvidence(w, crime, { kind: 'surveillance', strength: 28, collectedAt: now, buildingId: front.id, note });
    file.siteObservationCount = (file.siteObservationCount ?? 0) + 1;
  }
  if ((file.siteObservationCount ?? 0) >= 2 && caseEvidenceStrength(w, crime) >= 60 && file.raidDueAt == null) {
    file.raidDueAt = now + 120;
    if (w.gangs[crime.gangId]?.isPlayer) addMessage(w, 'police', 'The FBI has gathered grounds for a search of the premises.', null);
  }
}

/** Search a known address only after grounds and an absolute RTS deadline.
 * Entry reveals what is inside; it does not arrest an absent manager or crew. */
export function raidRtsSite(w: WorldState, rng: Rng, front: Building, agent?: Person): boolean {
  if (!agent || agent.role !== 'fbi' || agent.status !== 'active' || agent.streetOrder || agent.orderId != null ||
    agent.emergencyResponse || agent.shockReaction || agent.burningEscape?.week === w.week ||
    dist(agent.pos, buildingDoor(w, front)) > 8) return false;
  const now = campaignMinute(w);
  const crime = w.crimes.find(c => c.buildingId === front.id && c.reported && c.police?.agency === 'fbi' &&
    c.police.raidDueAt != null && c.police.raidDueAt <= now && OPEN.has(c.police.stage) && caseEvidenceStrength(w, c) >= 60);
  if (!crime) return false;
  const file = crime.police!;
  delete file.raidDueAt;
  const site = front.hidesId == null ? front : w.buildings[front.hidesId] ?? front;
  if (site.state === 'destroyed' || site.fbiClosedWeek != null) return false;
  const contraband = site.stock.liquor + site.stock.stolen + site.stock.counterfeit;
  if (site.cls !== 'illegal' && contraband <= 0) {
    addCaseEvidence(w, crime, { kind: 'scene', strength: 0, collectedAt: now, buildingId: front.id,
      note: `Search at ${front.id} found no illicit operation` });
    file.stage = 'cold'; file.coldAt = now;
    return false;
  }
  // The agent has reached the door and now enters under the search authority.
  alight(w, agent);
  const entry = { ...agent.pos };
  agent.buildingId = site.id;
  agent.pos = { ...w.lots[site.lotId].center };
  clearDestination(agent);
  const manager = site.managerId == null ? undefined : w.people[site.managerId];
  addCaseEvidence(w, crime, { kind: 'scene', strength: 30, collectedAt: now, buildingId: site.id,
    note: `Search seized illicit stock or operating equipment at ${site.id}` });
  // Seized management records link a named manager, not every gang member.
  if (manager && manager.status !== 'dead' && manager.gangId === crime.gangId) {
    addCaseEvidence(w, crime, { kind: 'financial', strength: 45, collectedAt: now, personId: manager.id,
      buildingId: site.id, note: `Seized operating records identify manager ${manager.id} at ${site.id}` });
    refreshCaseIdentity(w, crime);
    file.lastKnownBuildingId = site.id;
    file.lastKnownPos = buildingDoor(w, site);
    if (manager.buildingId === site.id && manager.status === 'active') {
      file.lastKnownPos = { ...manager.pos }; file.lastSeenAt = now;
      file.warrantAt = now; file.warrantExpiresAt = now + 7 * 1440; file.stage = 'wanted';
      tryCaseArrest(w, rng, agent, manager, crime.id);
    }
  }
  stopBusinessGuards(w, site, 'The business was closed by an FBI search.');
  site.guardIds = []; site.stock = { liquor: 0, stolen: 0, counterfeit: 0 };
  site.fbiClosedWeek = w.week; site.discovered = true; site.fbiDiscoveredWeek ??= w.week;
  delete site.fbiRaidWeek; delete site.resumeTradingWeek;
  if (site.state !== 'damaged') site.state = 'ceased';
  if (manager && manager.gangId === crime.gangId && manager.status !== 'dead' && manager.teamId == null) {
    const gang = w.gangs[crime.gangId];
    if (gang && !gang.poolIds.includes(manager.id)) gang.poolIds.push(manager.id);
  }
  site.managerId = null;
  agent.buildingId = null; agent.pos = entry;
  if (w.gangs[crime.gangId]?.isPlayer) addMessage(w, 'police', `The FBI searched ${buildingName(w, front.id)} and closed the illicit operation.`, entry, agent.id);
  addNews(w, { section: 'law', headline: 'FEDERAL AGENTS SEARCH CITY PREMISES',
    body: `Federal agents searched ${buildingName(w, front.id)} and seized illicit stock or operating equipment.`, gangId: crime.gangId });
  refreshPoliceWanted(w);
  return true;
}

/** A headquarters visit serves only this file's named warrants, on people
 * actually located inside or at its door. Distant crewmates are untouched. */
export function serveRtsSiteWarrants(w: WorldState, rng: Rng, site: Building, agent?: Person): number {
  if (!agent || agent.role !== 'fbi' || agent.status !== 'active' || dist(agent.pos, buildingDoor(w, site)) > 8) return 0;
  let taken = 0;
  const entry = { ...agent.pos };
  for (const crime of w.crimes) {
    const file = crime.police, person = file?.suspectId == null ? undefined : w.people[file.suspectId];
    if (!person || person.status !== 'active' || !caseHasWarrant(w, crime, person.id)) continue;
    if (person.buildingId === site.id && file!.lastKnownBuildingId === site.id) {
      agent.buildingId = site.id; agent.pos = { ...w.lots[site.lotId].center };
    } else if (person.buildingId != null || dist(person.pos, entry) > 5) continue;
    if (tryCaseArrest(w, rng, agent, person, crime.id)) taken++;
    agent.buildingId = null; agent.pos = { ...entry };
  }
  return taken;
}

export function tickRtsFbi(w: WorldState, rng: Rng, minutes: number): void {
  if (!w.options.continuousTime || w.phase !== 'week' || minutes <= 0) return;
  if (w.minute % 30 === 0) dispatchRtsFbi(w);
  for (const id of w.fbiIds) {
    const agent = w.people[id];
    if (!agent) continue;
    observeRtsFbiLead(w, rng, agent);
    const crime = agent.policeTask && w.crimes.find(c => c.id === agent.policeTask!.crimeId);
    if (crime?.buildingId != null && crime.police?.raidDueAt != null && crime.police.raidDueAt <= campaignMinute(w))
      raidRtsSite(w, rng, w.buildings[crime.buildingId], agent);
  }
}

/** Financial pressure is an investigative priority, not proof of a hood's
 * crime. Only reported files contribute; hidden stock and team membership do not. */
export function weeklyRtsFbi(w: WorldState): void {
  dispatchRtsFbi(w);
  for (const gang of Object.values(w.gangs)) {
    const legal = Math.max(0, gang.lastWeekIncome.legal), accountant = availableSpecialist(w, gang, 'accountant');
    const cover = accountant ? legal * (.5 + accountant.skills.intelligence * .22) + accountant.skills.intelligence * 400 : legal * .2;
    gang.riskyMoney = Math.max(0, (currentFinances(w, gang).riskyIncome ?? 0) - cover);
    const known = w.crimes.filter(c => c.gangId === gang.id && c.reported && c.police?.agency === 'fbi' && OPEN.has(c.police.stage));
    gang.suspicion = Math.min(100, known.reduce((n, c) => n + caseEvidenceStrength(w, c) * .25, 0));
  }
  refreshPoliceWanted(w);
}
