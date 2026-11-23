import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IllustratedPeopleWithPilot, createIllustratedCharacterRenderer } from '../src/render/illustratedCharacterRenderer';
import { LayeredPilotPeople, layeredPilotFrame, validLayeredPilotManifest } from '../src/render/layeredPilotPeople';
import { ILLUSTRATED_2D_LAYER_ORDER } from '../src/render/illustratedCharacterSpec';

const manifest = {
  version: 1, pilot: '1930s-male-fedora-suit', cell: { width: 256, height: 384 },
  directions: ['front','back','left','right'], frames: 4,
  layers: [...ILLUSTRATED_2D_LAYER_ORDER], atlas: { columns: 5, rows: 4 },
};
function camera(): THREE.Camera {
  const camera = new THREE.OrthographicCamera(-4,4,4,-4,.1,200);
  camera.position.set(8,12,10);
  camera.lookAt(0,0,0);
  return camera;
}
function mockTextureLoader() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok:true, json:async()=>manifest })));
  return vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(async path => {
    const t = new THREE.Texture();
    const s=String(path);
    t.image = s.includes('action-effects') ? { width:256, height:192 } :
      s.includes('layered-pilot') ? { width:1280, height:1536 } :
        s.includes('illustrated-people-walk-') ? { width:320, height:
          (s.includes('walk-3') ? 10 : 11)*320 } : { width:512,height:4096 };
    return t;
  });
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('editable 1930s layered-pilot sprite compiler contract',()=>{
  it('includes separately editable art for each of eight layers and four camera directions',()=>{
    for (const slot of ILLUSTRATED_2D_LAYER_ORDER) for (const direction of manifest.directions) {
      const art=readFileSync(`art-source/illustrated/layered-pilot/${slot}/${direction}.svg`,'utf8');
      expect(art).toContain('viewBox="0 0 256 384"');
      expect(art).toContain(`<g id="painted-${slot}"`);
    }
  });
  it('validates all eight aligned atlas layers and idle-plus-walk frames',()=>{
    expect(validLayeredPilotManifest(manifest)).toBe(true);
    expect(validLayeredPilotManifest({...manifest,atlas:{columns:4,rows:4}})).toBe(false);
    expect(validLayeredPilotManifest({...manifest,layers:manifest.layers.slice(1)})).toBe(false);
    expect(layeredPilotFrame(0,false)).toBe(0);
    expect(layeredPilotFrame(0,true)).toBe(1);
    expect(layeredPilotFrame(Math.PI/2,true)).toBe(2);
    expect(layeredPilotFrame(Math.PI,true)).toBe(3);
    expect(layeredPilotFrame(3*Math.PI/2,true)).toBe(4);
  });

  it('composes one selected character from eight tinted parts and a single shadow',async()=>{
    mockTextureLoader();
    const scene=new THREE.Scene();
    const renderer=new LayeredPilotPeople(scene,2,()=>{});
    await renderer.load();
    expect(renderer.ready).toBe(true);
    const p={id:8,portrait:2,female:false,role:'hood' as const};
    renderer.push(p,1,0,2,0,Math.PI/2,true);
    renderer.draw(camera());
    expect(renderer.layers.map(l=>l.count)).toEqual(Array(8).fill(1));
    expect(renderer.shadows.count).toBe(1);
    const uv=renderer.layers[0].snapshot().uv!;
    expect(uv[0]).toBeCloseTo(.2);
    expect(uv[1]).toBeCloseTo(.25);
    renderer.reset(); renderer.draw(camera());
    expect(renderer.layers.every(l=>l.count===0)).toBe(true);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('keeps normal illustration as a fallback until all pilot artwork loads',async()=>{
    const mock=mockTextureLoader();
    const scene=new THREE.Scene(); let selected=1;
    const renderer=createIllustratedCharacterRenderer(scene,12,()=>{},
      {enabled:true,selectedId:()=>selected});
    expect(renderer).toBeInstanceOf(IllustratedPeopleWithPilot);
    const composite=renderer as IllustratedPeopleWithPilot;
    await renderer.load();
    expect(renderer.ready).toBe(true);
    const own={id:1,portrait:2,female:false,role:'hood' as const};
    const others={id:2,portrait:0,female:false,role:'citizen' as const};
    renderer.push(own,0,0,0,0,0,true);
    renderer.push(others,2,0,0,0,0,false);
    renderer.draw(camera());
    expect(composite.pilot.layers[0].count).toBe(1);
    expect(composite.legacy.sprites.count).toBe(1);
    selected=2;
    renderer.reset();
    renderer.push(own,0,0,0,0,0,false);
    renderer.push(others,2,0,0,0,0,false);
    renderer.draw(camera());
    expect(composite.pilot.layers[0].count).toBe(0);
    expect(composite.legacy.sprites.count).toBe(2);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    mock.mockRestore();
  });

  it('returns a fully working legacy-only renderer by default',()=>{
    const scene=new THREE.Scene();
    const renderer=createIllustratedCharacterRenderer(scene,12,()=>{});
    expect(renderer).not.toBeInstanceOf(IllustratedPeopleWithPilot);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
