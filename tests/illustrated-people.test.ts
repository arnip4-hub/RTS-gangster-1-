import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { illustratedPersonRow, illustratedScreenDirection } from '../src/render/illustratedPeople';
import { portraitUrl } from '../src/ui/art';

afterEach(() => vi.unstubAllGlobals());

function camera(side: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100);
  camera.position.set(side * 10, 10, side * 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

describe('illustrated street people', () => {
  it('keeps police uniforms and federal suits distinct from civilians', () => {
    expect(illustratedPersonRow({ id: 4, female: false, role: 'police' })).toBe(2);
    expect(illustratedPersonRow({ id: 4, female: true, role: 'police' })).toBe(9);
    expect(illustratedPersonRow({ id: 4, female: false, role: 'policeChief' })).toBe(6);
    expect(illustratedPersonRow({ id: 4, female: true, role: 'fbi' })).toBe(7);
    expect(illustratedPersonRow({ id: 4, female: false, role: 'fbiHead' })).toBe(11);
    expect(illustratedPersonRow({ id: 4, female: false, role: 'boss' })).toBe(0);
    expect(illustratedPersonRow({ id: 5, female: false, role: 'hood' })).toBe(8);
    expect(illustratedPersonRow({ id: 4, female: false, role: 'citizen' })).toBe(4);
  });

  it('turns a person around when the camera flips', () => {
    const normal = camera(1), flipped = camera(-1);
    expect(illustratedScreenDirection(Math.PI / 4, normal)).toBe(0);
    expect(illustratedScreenDirection(Math.PI / 4, flipped)).toBe(1);
    expect(illustratedScreenDirection(-Math.PI / 4, normal)).toBe(2);
    expect(illustratedScreenDirection(3 * Math.PI / 4, normal)).toBe(3);
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
