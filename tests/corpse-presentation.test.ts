import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Person, WorldState } from '../src/sim/types';
import { campaignMinute } from '../src/sim/calendar';
import { heldCorpseAction, streetCorpseStage } from '../src/render/corpsePresentation';
import { ACTION_DURATION, type CharacterAction } from '../src/render/characterActions';
import { DeathMarks } from '../src/render/deathMarks';

const world = () => ({ week: 2, minute: 700, options: { continuousTime: true }, people: {} }) as WorldState;
const victim = (extra: Partial<Person> = {}) => ({ id: 10, status: 'dead', inVehicle: false,
  diedWeek: 2, diedAt: 10700, pos: { x: 20, y: 30 }, bodyRecovery: {}, portrait: 0,
  female: false, role: 'citizen', ...extra }) as Person;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('illustrated 3D street corpse presentation', () => {
  it('holds only uncovered outside bodies and stops at police covering or collection', () => {
    const w = world(), p = victim(), now = campaignMinute(w);
    expect(streetCorpseStage(p, w)).toBe('body');
    p.bodyRecovery = { coveredAt: now + .5, collectedAt: now + 8 };
    expect(streetCorpseStage(p, w, .49)).toBe('body');
    expect(streetCorpseStage(p, w, .5)).toBe('sheet');
    w.minute += 8;
    expect(streetCorpseStage(p, w)).toBe('gone');
    expect(streetCorpseStage(victim({ bodyRecovery: null }), w)).toBeNull();
    expect(streetCorpseStage(victim({ inVehicle: true }), w)).toBeNull();
    expect(streetCorpseStage(victim({ status: 'active' }), w)).toBeNull();
  });

  it('retains the recent legacy body rule without expiring tracked recovery records', () => {
    const w = world();
    expect(streetCorpseStage(victim({ bodyRecovery: undefined, diedWeek: 1 }), w)).toBe('body');
    expect(streetCorpseStage(victim({ bodyRecovery: undefined, diedWeek: 0 }), w)).toBeNull();
    expect(streetCorpseStage(victim({ bodyRecovery: {}, diedWeek: 0 }), w)).toBe('body');
  });

  it('preserves a pending or live fall, then holds its final pose after cue expiry or reload', () => {
    const p = victim();
    for (const time of [-.2, 0, 1.5, 7.8]) {
      const cue: CharacterAction = { kind: 'death', time, target: { x: 10, y: 20 } };
      expect(heldCorpseAction(p, cue)).toBe(cue);
    }
    expect(heldCorpseAction(p)).toEqual({ kind: 'death', time: ACTION_DURATION.death });
    expect(heldCorpseAction(p, { kind: 'shock', time: 1 })).toEqual({ kind: 'death', time: ACTION_DURATION.death });
    const burned = victim({ burningEscape: { fatal: true, week: 1 } as Person['burningEscape'] });
    expect(heldCorpseAction(burned)).toEqual({ kind: 'burnDeath', time: ACTION_DURATION.burnDeath });
    const cue: CharacterAction = { kind: 'burnDeath', time: 2 };
    expect(heldCorpseAction(burned, cue)).toBe(cue);
  });

  it('uses only police sheets in 3D mode while legacy modes retain their body sprites', () => {
    const context = new Proxy({}, { get: (_object, key) => key === 'canvas' ? {} : () => {} });
    vi.stubGlobal('document', { createElement: () => ({ width: 256, height: 256, getContext: () => context }) });
    const loads = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    const w = world(), now = campaignMinute(w), p = victim();
    w.people[p.id] = p;
    const painted = new DeathMarks(8, true), legacy = new DeathMarks(8);
    const counts = (marks: DeathMarks) => marks.group.children.map(child => (child as THREE.InstancedMesh).count);
    try {
      expect(loads).toHaveBeenCalledTimes(1); // Only the legacy renderer needs the sprite atlas.
      painted.update(w); legacy.update(w);
      expect(counts(painted)).toEqual([0, 0, 0]);
      expect(counts(legacy)).toEqual([1, 0, 0]);
      p.bodyRecovery = { coveredAt: now, collectedAt: now + 5 };
      painted.update(w); legacy.update(w);
      expect(counts(painted)).toEqual([0, 1, 0]);
      expect(counts(legacy)).toEqual([0, 1, 0]);
      w.minute += 5;
      painted.update(w); legacy.update(w);
      expect(counts(painted)).toEqual([0, 0, 0]);
      expect(counts(legacy)).toEqual([0, 0, 0]);
    } finally { painted.dispose(); legacy.dispose(); }
  });
});
