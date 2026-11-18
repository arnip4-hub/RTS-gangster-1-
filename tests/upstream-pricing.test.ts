import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { buySnitchInfo, hireRecruit, snitchPrice } from '../src/sim/api';
import { createWorld, hoodPayDemand } from '../src/sim/citygen';
import { originalWageQuote, specialistAskingWage } from '../src/sim/originalWages';
import { SKILLS } from '../src/sim/types';
import { selectableOrderPerson } from '../src/app/orderSelection';

function fixture(original = false) {
  const options = original ? newCampaignOptions() : { ...defaultGameOptions(), citySize: 10 };
  const { world: w, rng } = createWorld({ ...options, seed: 404, startMoney: 100_000 });
  const gang = Object.values(w.gangs).find(g => g.isPlayer)!;
  return { w, rng, gang };
}

function snitchFixture(count: number) {
  const s = fixture();
  const people = Object.values(s.w.people);
  const candidates = people.filter(p => p.gangId == null && p.role === 'hood').slice(0, count);
  expect(candidates).toHaveLength(count);
  const unknown = new Set(candidates.map(p => p.id));
  s.gang.knownPeople = people.filter(p => !unknown.has(p.id)).map(p => p.id);
  const snitch = people.find(p => p.role === 'snitch')!;
  return { ...s, candidates, snitch };
}

describe('snitch quote and charge', () => {
  it('caps the quoted and paid name charge at six, even with fifty unknown recruits', () => {
    const { w, rng, gang, snitch } = snitchFixture(50);
    const beforeCash = gang.cash, beforeKnown = gang.knownPeople.length;
    expect(snitchPrice(w, gang.id, [0])).toBe(580);
    expect(buySnitchInfo(w, rng, gang.id, snitch.id, [0]).ok).toBe(true);
    expect(beforeCash - gang.cash).toBe(580);
    expect(gang.knownPeople.length - beforeKnown).toBeGreaterThanOrEqual(2);
    expect(gang.knownPeople.length - beforeKnown).toBeLessThanOrEqual(6);
  });

  it('charges only the available names when fewer than six are unknown', () => {
    const { w, rng, gang, snitch, candidates } = snitchFixture(2);
    expect(snitchPrice(w, gang.id, [0])).toBe(460);
    const before = gang.cash;
    expect(buySnitchInfo(w, rng, gang.id, snitch.id, [0]).ok).toBe(true);
    expect(before - gang.cash).toBe(460);
    expect(candidates.every(p => gang.knownPeople.includes(p.id))).toBe(true);
  });

  it('retains the per-group fee while capping the total names across groups', () => {
    const { w, gang } = snitchFixture(50);
    const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    expect(snitchPrice(w, gang.id, [0, rival.id])).toBe(980);
  });

  it('reveals a rival accountant and lawyer before ordinary names, then makes them selectable targets', () => {
    const { w, rng, gang } = fixture();
    const rival = Object.values(w.gangs).find(g => !g.isPlayer)!;
    const accountant = Object.values(w.people).find(p => p.role === 'accountant' && p.gangId == null && p.status === 'active')!;
    const lawyer = Object.values(w.people).find(p => p.role === 'lawyer' && p.gangId == null && p.status === 'active')!;
    expect(hireRecruit(w, rival.id, accountant.id, 'pool').ok).toBe(true);
    expect(hireRecruit(w, rival.id, lawyer.id, 'pool').ok).toBe(true);
    gang.knownPeople = gang.knownPeople.filter(id => id !== accountant.id && id !== lawyer.id);

    const snitch = Object.values(w.people).find(p => p.role === 'snitch')!;
    const result = buySnitchInfo(w, rng, gang.id, snitch.id, [rival.id]);
    if (!result.ok) throw new Error(result.error);
    expect(gang.knownPeople).toContain(accountant.id);
    expect(gang.knownPeople).toContain(lawyer.id);
    expect(result.message).toContain(`${accountant.name} (accountant)`);
    expect(result.message).toContain(`${lawyer.name} (lawyer)`);
    for (const p of [accountant, lawyer]) {
      expect(selectableOrderPerson(w, gang.id, 'assault', p)).toBe(true);
      expect(selectableOrderPerson(w, gang.id, 'kidnap', p)).toBe(true);
      expect(selectableOrderPerson(w, gang.id, 'kill', p)).toBe(true);
    }
  });

  it('rejects an unaffordable quote without payment, disclosure or consuming the purchase', () => {
    const { w, rng, gang, snitch } = snitchFixture(50);
    gang.cash = 579;
    const known = [...gang.knownPeople], used = gang.snitchUsedWeek;
    expect(buySnitchInfo(w, rng, gang.id, snitch.id, [0]).ok).toBe(false);
    expect(gang.cash).toBe(579);
    expect(gang.knownPeople).toEqual(known);
    expect(gang.snitchUsedWeek).toBe(used);
  });
});

describe('specialist hiring wages', () => {
  it.each(['accountant', 'lawyer'] as const)('prices compact %s by Intelligence, independent of fighting skills', role => {
    const { w, gang } = fixture();
    const p = Object.values(w.people).find(p => p.role === role && p.gangId == null)!;
    for (const skill of SKILLS) p.skills[skill] = 1;
    p.skills.intelligence = 5;
    expect(hoodPayDemand(p, role)).toBe(310);
    expect(specialistAskingWage(w, p, gang.id)).toBe(310);
    for (const skill of SKILLS) p.skills[skill] = 5;
    p.skills.intelligence = 1;
    expect(hoodPayDemand(p, role)).toBe(135);
    expect(specialistAskingWage(w, p, gang.id)).toBe(135);
  });

  it.each([
    [false, 'accountant'], [false, 'lawyer'],
    [true, 'accountant'], [true, 'lawyer'],
  ] as const)('uses the displayed quote on hiring (original=%s, role=%s), including stale saved demands', (original, role) => {
    const { w, gang } = fixture(original);
    const p = Object.values(w.people).find(p => p.role === role && p.gangId == null)!;
    p.skills.intelligence = 2.5;
    p.payDemand = 1; // An older save or a quote made for another prospective employer.
    const quote = specialistAskingWage(w, p, gang.id);
    expect(quote).toBe(original ? originalWageQuote(p, gang.id) : 200);
    expect(p.payDemand).toBe(1); // Merely viewing a price does not change the save.
    expect(hireRecruit(w, gang.id, p.id, 'pool').ok).toBe(true);
    expect(p.pay).toBe(quote);
    expect(p.payDemand).toBe(quote);
  });

  it('does not requote wages already contracted by a gang', () => {
    const { w, gang } = fixture();
    const p = Object.values(w.people).find(p => p.role === 'accountant' && p.gangId == null)!;
    expect(hireRecruit(w, gang.id, p.id, 'pool').ok).toBe(true);
    p.pay = 350; p.payDemand = 350;
    const before = { pay: p.pay, demand: p.payDemand };
    expect(hireRecruit(w, gang.id, p.id, 'pool').ok).toBe(false);
    expect({ pay: p.pay, demand: p.payDemand }).toEqual(before);
  });
});
