import { describe, expect, it } from 'vitest';
import { defaultGameOptions, newCampaignOptions } from '../src/app/newGame';
import { createPerson, createWorld, giveFamilySurname } from '../src/sim/citygen';
import { FEMALE_FIRST, MALE_FIRST, SURNAMES } from '../src/sim/data/names';
import { ensureOwnerRelative } from '../src/sim/officialFamilies';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { WorldState } from '../src/sim/types';

const emptyWorld = () => ({ people: {}, nextId: 1, options: { continuousTime: true } }) as unknown as WorldState;

describe('distinct citizen and family names', () => {
  it('has enough distinct name combinations for the full original city', () => {
    expect(new Set(SURNAMES).size).toBe(SURNAMES.length);
    expect(new Set(MALE_FIRST).size).toBe(MALE_FIRST.length);
    expect(new Set(FEMALE_FIRST).size).toBe(FEMALE_FIRST.length);
    expect(FEMALE_FIRST.length * SURNAMES.length).toBeGreaterThan(10_000);
    const sim = new Sim({ ...newCampaignOptions(), seed: 404 });
    const people = Object.values(sim.world.people);
    expect(people.length).toBeGreaterThan(8_000);
    expect(new Set(people.map(p => p.name)).size).toBe(people.length);
    const relatives = people.filter(p => p.familyOfId != null);
    expect(relatives.length).toBeGreaterThan(5);
    for (const relative of relatives) {
      expect(relative.name.split(' ').at(-1)).toBe(sim.world.people[relative.familyOfId!].name.split(' ').at(-1));
    }
  });

  it('reserves the player boss name before generating the surrounding population', () => {
    const options = { ...defaultGameOptions(), continuousTime: true, seed: 404, citySize: 10 };
    const baseline = createWorld(options).world;
    const playerName = Object.values(baseline.people).find(p => p.role === 'owner')!.name;
    const sim = new Sim({ ...options, playerName, playerNickname: '' });
    expect(sim.world.people[sim.playerGang.bossId].name).toBe(playerName);
    expect(Object.values(sim.world.people).filter(p => p.name === playerName)).toHaveLength(1);
    const duplicate = new Sim({ ...options, playerName, playerNickname: '' });
    expect(Object.values(duplicate.world.people).map(p => p.name)).toEqual(Object.values(sim.world.people).map(p => p.name));
    expect(duplicate.rng.state).toBe(sim.rng.state);
  });

  it('resolves a collision after load without consuming extra simulation randomness', () => {
    const original = emptyWorld(), rng = new Rng(42);
    const first = createPerson(original, rng, 'citizen', { x: 0, y: 0 });
    const loaded = structuredClone(original), repeat = new Rng(42);
    const next = createPerson(loaded, repeat, 'citizen', { x: 0, y: 0 });
    expect(next.name).not.toBe(first.name);
    expect(next.skills).toEqual(first.skills);
    expect(repeat.state).toBe(rng.state);
  });

  it('keeps household surnames without making the relative a namesake', () => {
    const w = emptyWorld(), rng = new Rng(42);
    const head = createPerson(w, rng, 'owner', { x: 0, y: 0 }, { name: 'Tony Doyle' });
    const relative = createPerson(w, rng, 'citizen', { x: 0, y: 0 }, { name: 'Rosa Moretti', female: true });
    createPerson(w, rng, 'police', { x: 10, y: 10 }, { name: 'Rosa Doyle', female: true });
    expect(ensureOwnerRelative(w, rng, head)).toBe(relative);
    expect(relative.name).not.toBe('Rosa Doyle');
    expect(relative.name.split(' ').at(-1)).toBe('Doyle');
    expect(new Set(Object.values(w.people).map(p => p.name)).size).toBe(3);
    expect(ensureOwnerRelative(w, rng, head)).toBe(relative);
  });

  it('keeps subsequent generated names identical across a save after a family rename', () => {
    const w = emptyWorld(), rng = new Rng(42);
    const relative = createPerson(w, rng, 'citizen', { x: 0, y: 0 });
    const formerName = relative.name;
    const head = createPerson(w, rng, 'owner', { x: 0, y: 0 }, { name: 'Tony Different' });
    giveFamilySurname(w, relative, head);
    const loaded = structuredClone(w);
    const liveNext = createPerson(w, new Rng(42), 'citizen', { x: 0, y: 0 });
    const loadedNext = createPerson(loaded, new Rng(42), 'citizen', { x: 0, y: 0 });
    expect(liveNext.name).toBe(formerName);
    expect(loadedNext.name).toBe(liveNext.name);
  });

  it('uses a middle initial if a household surname has exhausted the first-name pool', () => {
    const w = emptyWorld(), rng = new Rng(42);
    for (const first of FEMALE_FIRST) {
      createPerson(w, rng, 'citizen', { x: 0, y: 0 }, { name: `${first} Doyle`, female: true });
    }
    const head = createPerson(w, rng, 'owner', { x: 0, y: 0 }, { name: 'Tony Doyle' });
    const relative = createPerson(w, rng, 'citizen', { x: 0, y: 0 }, { name: 'Rosa Moretti', female: true });
    giveFamilySurname(w, relative, head);
    expect(relative.name).toBe('Rosa A. Doyle');
    const people = Object.values(w.people);
    expect(new Set(people.map(p => p.name)).size).toBe(people.length);
  });

  it('retains saved names and family ties on restore', () => {
    const sim = new Sim({ ...defaultGameOptions(), continuousTime: true, seed: 405, citySize: 10 });
    const snapshot = structuredClone(sim.world);
    // Existing campaigns keep their historical names, even legacy namesakes.
    const people = Object.values(snapshot.people);
    people[1].name = people[0].name;
    const names = people.map(p => [p.id, p.name, p.familyOfId]);
    const restored = Sim.fromSave(snapshot);
    expect(Object.values(restored.world.people).map(p => [p.id, p.name, p.familyOfId])).toEqual(names);
  });
});
