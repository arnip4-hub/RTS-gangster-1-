import * as THREE from 'three';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IllustratedPeople, illustratedPersonRow, illustratedScreenDirection, illustratedWalkFrame } from '../src/render/illustratedPeople';
import { portraitUrl } from '../src/ui/art';
import { appearanceIndex, COMPOSED_FACE_COUNT, personSkinGroup } from '../src/render/personAppearance';
import { PortraitDrawn } from '../src/ui/Portrait';
import type { Person } from '../src/sim/types';

afterEach(() => vi.unstubAllGlobals());

function camera(side: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100);
  camera.position.set(side * 10, 10, side * 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

describe('illustrated street people', () => {
  it('keeps police uniforms and federal suits distinct from civilians', () => {
    const p = { id: 4, portrait: 0 };
    expect([2, 20]).toContain(illustratedPersonRow({ ...p, female: false, role: 'police' }));
    expect([9, 21]).toContain(illustratedPersonRow({ ...p, female: true, role: 'police' }));
    expect(illustratedPersonRow({ ...p, female: false, role: 'policeChief' })).toBe(6);
    expect([7, 31, 22]).toContain(illustratedPersonRow({ ...p, female: true, role: 'fbi' }));
    expect(illustratedPersonRow({ ...p, female: false, role: 'fbiHead' })).toBe(3);
    expect(illustratedPersonRow({ ...p, female: false, role: 'boss' })).toBe(0);
    expect(illustratedPersonRow({ ...p, female: false, role: 'mayor' })).toBe(15);
    expect([0, 4, 14, 18, 24, 8, 26]).toContain(illustratedPersonRow({ ...p, female: false, role: 'citizen' }));
  });

  it('gives 1536 stable composed identities and skin-matched street rows', () => {
    const identities = new Set(Array.from({ length: COMPOSED_FACE_COUNT }, (_, id) => appearanceIndex({ id, portrait: 0 })));
    expect(identities.size).toBe(COMPOSED_FACE_COUNT);
    const rows = { male: [[0, 4, 14], [18, 24], [8, 26]], female: [[1, 10, 12, 19], [13, 25, 28], [5, 17, 27]] };
    for (let id = 0; id < 100; id++) for (const female of [false, true]) {
      const person = { id, portrait: 0, female, role: 'citizen' as const };
      expect(rows[female ? 'female' : 'male'][personSkinGroup(person)]).toContain(illustratedPersonRow(person));
    }
  });

  it('composes different visible face markup for different saved people', () => {
    const base = { portrait: 0, female: false, role: 'citizen', status: 'active', name: 'Test Person' } as Person;
    const first = renderToStaticMarkup(createElement(PortraitDrawn, { person: { ...base, id: 101 }, size: 80 }));
    const second = renderToStaticMarkup(createElement(PortraitDrawn, { person: { ...base, id: 102 }, size: 80 }));
    expect(first).toContain('<svg');
    expect(first).not.toBe(second);
    expect(renderToStaticMarkup(createElement(PortraitDrawn, { person: { ...base, id: 101 }, size: 80 }))).toBe(first);
  });

  it('turns a person around when the camera flips', () => {
    const normal = camera(1), flipped = camera(-1);
    expect(illustratedScreenDirection(Math.PI / 4, normal)).toBe(0);
    expect(illustratedScreenDirection(Math.PI / 4, flipped)).toBe(1);
    expect(illustratedScreenDirection(-Math.PI / 4, normal)).toBe(2);
    expect(illustratedScreenDirection(3 * Math.PI / 4, normal)).toBe(3);
  });

  it('renders moving common silhouettes from gait frames and leaves still figures in the base atlas', async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async path => {
      const image = new THREE.Texture();
      image.image = { width: 512, height: String(path).includes('walk') ? 1536 : 4096 };
      return image;
    });
    const scene = new THREE.Scene(), people = new IllustratedPeople(scene, 8, () => {});
    await people.load();
    expect(people.ready).toBe(true);
    expect(illustratedWalkFrame(0)).toBe(0);
    expect(illustratedWalkFrame(Math.PI / 2)).toBe(1);
    expect(illustratedWalkFrame(Math.PI)).toBe(2);
    expect(illustratedWalkFrame(3 * Math.PI / 2)).toBe(3);
    const p = { id: 0, portrait: 0, female: false, role: 'boss' as const };
    people.push(p, 0, 0, 0, 0, Math.PI, true);
    people.push(p, 2, 0, 0, 0, 0, false);
    people.draw(camera(1));
    expect(people.walkingSprites.count).toBe(1);
    expect(people.sprites.count).toBe(1);
    expect(people.shadows.count).toBe(2);
    people.dispose();
    load.mockRestore();
  });

  it('uses distinct illustrated portraits for crews, police and the FBI', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'illustrated' });
    expect(portraitUrl({ portrait: 8, female: false, role: 'boss' })).toContain('/gang-m-03.png');
    expect(portraitUrl({ portrait: 8, female: false, role: 'police' })).toContain('/police-m-03.png');
    expect(portraitUrl({ portrait: 8, female: false, role: 'fbi' })).toContain('/fbi-m-03.png');
    expect(portraitUrl({ portrait: 8, female: true, role: 'police' })).toContain('/police-f-01.png');
    expect(portraitUrl({ portrait: 8, female: true, role: 'citizen' })).toContain('/f-09.png');
  });
});
