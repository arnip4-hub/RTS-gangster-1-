import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CityRenderer } from '../src/render/scene';
import { TextureOwner } from '../src/render/textureOwnership';
import type { CityArt } from '../src/render/textures';

function fixture() {
  const shopMat = new THREE.MeshStandardMaterial({ emissive: 0xffc98a });
  const cafeMat = new THREE.MeshStandardMaterial({ emissive: 0xffc98a });
  const fields = {
    shopMat, shopMats: { classicDisplay: shopMat, cafeBistro: cafeMat }, ownedTextures: new TextureOwner(), facadeMats: [], deliveredStorefronts: new Set<string>(),
    refreshBuildings: vi.fn(),
    applyArt: (_art: CityArt) => {},
  };
  const view = Object.assign(Object.create(CityRenderer.prototype), fields) as typeof fields;
  // Use the real method; the fixture avoids creating WebGL/DOM or a whole city.
  delete (view as Partial<typeof fields>).applyArt;
  const empty: CityArt = { facades: [], roof: null, storefront: null, plinth: null,
    pavement: null, kerb: null, awning: null, sawtooth: null, signs: null, road: null };
  return { view, empty };
}

describe('delivered storefront material transition', () => {
  it('keeps albedo/emission sources separate and refreshes instance tint when loaded', () => {
    const { view, empty } = fixture();
    const map = new THREE.DataTexture(new Uint8Array([90, 80, 70, 255]), 1, 1);
    const lights = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    view.applyArt({ ...empty, storefront: { map, lights } });
    expect(view.shopMat.map?.source).toBe(map.source);
    expect(view.shopMat.emissiveMap?.source).toBe(lights.source);
    expect(view.shopMat.map).not.toBe(view.shopMat.emissiveMap);
    expect(Array.from(lights.image.data)).toEqual([0, 0, 0, 255]);
    expect(view.shopMat.emissive.toArray()).toEqual([1, 1, 1]);
    expect(view.deliveredStorefronts.has('classicDisplay')).toBe(true);
    expect(view.deliveredStorefronts.has('cafeBistro')).toBe(false);
    expect(view.refreshBuildings).toHaveBeenCalledTimes(1);
    view.ownedTextures.dispose(); view.shopMat.dispose(); view.shopMats.cafeBistro.dispose(); map.dispose(); lights.dispose();
  });

  it('loads a non-default style independently without disposing another style’s texture', () => {
    const { view, empty } = fixture();
    const fallback = new THREE.Texture();
    const classic = view.ownedTextures.clone(fallback);
    const cafe = view.ownedTextures.clone(fallback);
    view.shopMat.map = classic;
    view.shopMats.cafeBistro.map = cafe;
    const classicDisposed = vi.fn(), cafeDisposed = vi.fn();
    classic.addEventListener('dispose', classicDisposed);
    cafe.addEventListener('dispose', cafeDisposed);
    const map = new THREE.Texture(), lights = new THREE.Texture();
    view.applyArt({ ...empty, storefronts: { cafeBistro: { map, lights } } });
    expect(view.shopMats.cafeBistro.map?.source).toBe(map.source);
    expect(view.shopMats.cafeBistro.emissiveMap?.source).toBe(lights.source);
    expect(view.shopMats.cafeBistro.emissive.toArray()).toEqual([1, 1, 1]);
    expect(view.shopMat.map).toBe(classic);
    expect(classicDisposed).not.toHaveBeenCalled();
    expect(cafeDisposed).toHaveBeenCalledTimes(1);
    expect([...view.deliveredStorefronts]).toEqual(['cafeBistro']);
    expect(view.refreshBuildings).toHaveBeenCalledTimes(1);
    view.ownedTextures.dispose(); view.shopMat.dispose(); view.shopMats.cafeBistro.dispose();
    fallback.dispose(); map.dispose(); lights.dispose();
  });

  it('keeps procedural colour handling when the delivered pair is missing', () => {
    const { view, empty } = fixture();
    const originalColour = view.shopMat.emissive.clone();
    view.applyArt(empty);
    expect(view.deliveredStorefronts.size).toBe(0);
    expect(view.shopMat.emissive.equals(originalColour)).toBe(true);
    expect(view.refreshBuildings).not.toHaveBeenCalled();
    view.ownedTextures.dispose(); view.shopMat.dispose(); view.shopMats.cafeBistro.dispose();
  });
});

it('daytime does not add flat emission while the existing afternoon ramp remains available', () => {
  const shopMat = new THREE.MeshStandardMaterial(), cafeMat = new THREE.MeshStandardMaterial();
  const view = Object.assign(Object.create(CityRenderer.prototype), {
    world: { phase: 'planning', minute: 0, options: { continuousTime: false } }, target: new THREE.Vector3(),
    sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), bounce: new THREE.DirectionalLight(),
    scene: new THREE.Scene(), facadeMats: [new THREE.MeshStandardMaterial()],
    shopMat, shopMats: { classicDisplay: shopMat, cafeBistro: cafeMat }, glowMat: new THREE.MeshBasicMaterial(),
    headlampMat: new THREE.MeshBasicMaterial(), taillightMat: new THREE.MeshBasicMaterial(), groundMat: new THREE.MeshStandardMaterial(),
    lampGlow: { mesh: { visible: false } },
  }) as { world: { phase: string; minute: number }; scene: THREE.Scene; shopMat: THREE.MeshStandardMaterial;
    applyTimeOfDay(): number; facadeMats: THREE.MeshStandardMaterial[] };
  view.scene.background = new THREE.Color();
  view.applyTimeOfDay();
  expect(view.shopMat.emissiveIntensity).toBe(0);
  expect(view.facadeMats[0].emissiveIntensity).toBe(0);
  expect(cafeMat.emissiveIntensity).toBe(0);
  view.world.phase = 'week'; view.world.minute = 479;
  view.applyTimeOfDay();
  expect(view.shopMat.emissiveIntensity).toBeGreaterThan(0);
  expect(view.shopMat.emissiveIntensity).toBeLessThanOrEqual(0.9);
  expect(cafeMat.emissiveIntensity).toBe(view.shopMat.emissiveIntensity);
  shopMat.dispose(); cafeMat.dispose();
});
