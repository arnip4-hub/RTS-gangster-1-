import { campaignMinute, FULL_DAY_MINUTES } from './calendar';
import { addMessage, addNews, recordCrime } from './events';
import { killPerson } from './execution';
import { payCash } from './finances';
import type { Rng } from './rng';
import type { Gang, ID, Person, WorldState } from './types';

export const PRISON_NAMES = ['County Jail', 'State Penitentiary'] as const;
const contactFee = 150;
const protectionFee = 500;
const attackFee = 650;
const bossAttackFee = 2500;

export function placeInPrison(w: WorldState, person: Person): void {
  person.prisonId = (person.id % 2) as 0 | 1;
  person.prisonSince = campaignMinute(w);
  delete person.prisonOperation;
  delete person.prisonProtectedUntil;
}

export function prisonOf(w: WorldState, person: Person): 0 | 1 {
  // Older saves had no placement. A stable choice lets those inmates meet.
  void w;
  return person.prisonId ?? (person.id % 2 as 0 | 1);
}

export function knownPrisonRivals(w: WorldState, gangId: ID, inmate: Person): Person[] {
  const gang = w.gangs[gangId], prisonId = prisonOf(w, inmate);
  return Object.entries(gang?.prisonIntel ?? {}).map(([id, intel]) => {
    const person = w.people[Number(id)];
    return person && intel.prisonId === prisonId && person.status === 'jailed' &&
      person.gangId != null && person.gangId !== gangId && prisonOf(w, person) === prisonId ? person : null;
  }).filter((p): p is Person => !!p);
}

const result = (ok: boolean, message: string) => ok ? { ok: true as const, message } : { ok: false as const, error: message };
const ownInmate = (w: WorldState, gangId: ID, inmateId: ID): Person | undefined => {
  const person = w.people[inmateId];
  return person?.gangId === gangId && person.status === 'jailed' ? person : undefined;
};

export function requestPrisonContact(w: WorldState, gangId: ID, inmateId: ID) {
  const gang = w.gangs[gangId], inmate = ownInmate(w, gangId, inmateId);
  if (!gang || !inmate) return result(false, 'Choose one of your imprisoned people.');
  if (inmate.prisonOperation) return result(false, 'That inmate already has a prison task.');
  if (gang.cash < contactFee) return result(false, 'You need $150 to reach the inmate.');
  payCash(w, gang, 'purchases', contactFee);
  inmate.prisonOperation = { kind: 'contact', dueAt: campaignMinute(w) + 180 };
  return result(true, `${inmate.name} will ask around in ${PRISON_NAMES[prisonOf(w, inmate)]}.`);
}

export function requestPrisonProtection(w: WorldState, gangId: ID, inmateId: ID) {
  const gang = w.gangs[gangId], inmate = ownInmate(w, gangId, inmateId);
  if (!gang || !inmate) return result(false, 'Choose one of your imprisoned people.');
  if (gang.cash < protectionFee) return result(false, 'You need $500 for prison protection.');
  payCash(w, gang, 'purchases', protectionFee);
  inmate.prisonProtectedUntil = campaignMinute(w) + 3 * FULL_DAY_MINUTES;
  return result(true, `${inmate.name} has protection for three days.`);
}

export function requestPrisonAttack(w: WorldState, gangId: ID, inmateId: ID, targetId: ID) {
  const gang = w.gangs[gangId], inmate = ownInmate(w, gangId, inmateId), target = w.people[targetId];
  if (!gang || !inmate || !target) return result(false, 'Choose an imprisoned attacker and target.');
  if (inmate.prisonOperation) return result(false, 'That inmate already has a prison task.');
  if (!knownPrisonRivals(w, gangId, inmate).some(p => p.id === targetId))
    return result(false, 'The target is not known to be in the same prison.');
  const fee = target.role === 'boss' ? bossAttackFee : attackFee;
  if (gang.cash < fee) return result(false, `You need $${fee.toLocaleString('en-US')} to arrange the attack.`);
  payCash(w, gang, 'purchases', fee);
  inmate.prisonOperation = { kind: 'attack', targetId, dueAt: campaignMinute(w) + 240 };
  return result(true, `${inmate.name} will try to reach ${target.name} inside the prison.`);
}

function observe(w: WorldState, gang: Gang, inmate: Person, target: Person, now: number): void {
  (gang.prisonIntel ??= {})[target.id] = { prisonId: prisonOf(w, inmate), learnedAt: now, sourceId: inmate.id };
  if (gang.isPlayer) addMessage(w, 'waiting', `${inmate.name} heard that ${target.name} is in ${PRISON_NAMES[prisonOf(w, inmate)]}.`, null, target.id);
}

/** Prison contacts are resolved at the morning roll call, without world-map sight. */

/** A prison death is a killing the guards can report. It does not name the
 * attacker by truth; a guard's direct observation is an ordinary lead. */
function filePrisonKilling(w: WorldState, rng: Rng, attacker: Person, victim: Person): void {
  if (attacker.gangId == null) return;
  const crime = recordCrime(w, rng, {
    gangId: attacker.gangId, perpetratorId: attacker.id, type: 'kill',
    pos: attacker.pos, victimId: victim.id, severity: 9,
  });
  const guard = w.policeIds.map(id => w.people[id]).find(p => p?.status === 'active');
  const file = crime.police;
  if (!guard || !file) return;
  file.statements.push({
    witnessId: guard.id, observation: 'direct', confidence: 62, reliability: 70,
    observedAt: campaignMinute(w), reportedAt: campaignMinute(w), suspectId: attacker.id,
    description: 'A guard saw the attack on the wing.',
  });
}

export function tickPrison(w: WorldState, rng: Rng): void {
  if (!w.options.continuousTime || w.phase !== 'week' || w.minute % FULL_DAY_MINUTES !== 360) return;
  const now = campaignMinute(w);
  const inmates = Object.values(w.people).filter(p => p.status === 'jailed' && p.gangId != null);
  for (const inmate of inmates) {
    const gang = w.gangs[inmate.gangId!], operation = inmate.prisonOperation;
    if (!gang) continue;
    if (operation?.dueAt != null && operation.dueAt <= now &&
      now - (inmate.prisonSince ?? now - FULL_DAY_MINUTES) >= FULL_DAY_MINUTES) {
      delete inmate.prisonOperation;
      const peers = inmates.filter(p => p.id !== inmate.id && p.gangId !== inmate.gangId &&
        prisonOf(w, p) === prisonOf(w, inmate) && now - (p.prisonSince ?? now - FULL_DAY_MINUTES) >= FULL_DAY_MINUTES);
      if (operation.kind === 'contact') {
        const unknown = peers.filter(p => !gang.prisonIntel?.[p.id]);
        if (unknown.length && rng.chance(.7)) observe(w, gang, inmate, rng.pick(unknown), now);
        else if (gang.isPlayer) addMessage(w, 'waiting', `${inmate.name} found no reliable new prison contact.`, null, inmate.id);
      } else {
        const target = operation.targetId == null ? undefined : w.people[operation.targetId];
        if (!target || !peers.includes(target)) {
          if (gang.isPlayer) addMessage(w, 'failed', `${inmate.name} lost track of the prison target.`, null, inmate.id);
          continue;
        }
        if ((target.prisonProtectedUntil ?? 0) > now) {
          delete target.prisonProtectedUntil;
          if (gang.isPlayer) addMessage(w, 'failed', `${inmate.name} could not reach ${target.name}; the protection held.`, null, target.id);
          if (target.gangId != null && w.gangs[target.gangId]?.isPlayer && !gang.isPlayer)
            addMessage(w, 'police', `${target.name}'s prison protection stopped an attack.`, null, target.id);
          continue;
        }
        const chance = Math.max(.08, Math.min(.65, .25 + (inmate.skills.fists - target.skills.fists) * .065));
        const success = rng.chance(chance);
        if (success) {
          target.hp = Math.max(0, target.hp - rng.int(65, 115));
          const killed = target.hp === 0;
          if (killed) {
            killPerson(w, target, `was killed in prison by an associate of ${gang.name}`, gang.id);
            filePrisonKilling(w, rng, inmate, target);
            addNews(w, { section: 'crime', headline: 'PRISON KILLING', body: `${target.name} was killed in custody. Police are investigating.`, gangId: gang.id });
          }
          if (inmate.jailWeeks < 999) inmate.jailWeeks = Math.min(998, inmate.jailWeeks + (killed ? 8 : 2));
          gang.evidence = Math.min(100, gang.evidence + (killed ? 12 : 8));
          gang.suspicion = Math.min(100, gang.suspicion + (killed ? 8 : 5));
          if (gang.isPlayer) addMessage(w, 'combat', `${inmate.name} attacked ${target.name} in prison${killed ? ', killing him' : ''}. The sentence was extended.`, null, target.id);
          if (target.gangId != null && w.gangs[target.gangId]?.isPlayer && !gang.isPlayer)
            addMessage(w, 'combat', `${target.name} was attacked in prison${killed ? ' and killed' : ''}.`, null, target.id);
        } else {
          gang.suspicion = Math.min(100, gang.suspicion + 2);
          if (gang.isPlayer) addMessage(w, 'failed', `${inmate.name} failed to attack ${target.name} in prison.`, null, target.id);
        }
      }
    }
    // AI inmates hear only a few names after sharing a facility for a day.
    if (!gang.isPlayer && now - (inmate.prisonSince ?? now - FULL_DAY_MINUTES) >= FULL_DAY_MINUTES && rng.chance(.12)) {
      const unknown = inmates.filter(p => p.gangId !== inmate.gangId && prisonOf(w, p) === prisonOf(w, inmate) &&
        now - (p.prisonSince ?? now - FULL_DAY_MINUTES) >= FULL_DAY_MINUTES && !gang.prisonIntel?.[p.id]);
      if (unknown.length) observe(w, gang, inmate, rng.pick(unknown), now);
    }
    if (!gang.isPlayer && !inmate.prisonOperation && rng.chance(.025)) {
      const rivals = knownPrisonRivals(w, gang.id, inmate);
      const target = rivals.length ? rng.pick(rivals) : undefined;
      if (target && gang.cash >= attackFee) requestPrisonAttack(w, gang.id, inmate.id, target.id);
    }
  }
}
