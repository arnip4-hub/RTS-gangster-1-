import { describe, expect, it } from 'vitest';
import { CHARACTER_BODY_TYPES, CHARACTER_OUTFITS, CHARACTER_SKIN_TONES,
  resolveCharacterWardrobe } from '../src/render/characterWardrobe';
import { ILLUSTRATED_2D_DIRECTIONS, ILLUSTRATED_2D_WALK_FRAMES,
  ILLUSTRATED_2D_LAYER_ORDER, illustratedCharacterSpec, illustratedLayerTile,
} from '../src/render/illustratedCharacterSpec';

describe('next illustrated 2D character specification (production renderer unchanged)', () => {
  const citizen = (id: number) =>
    ({ id, portrait: id % 47, female: id % 2 === 0, role: 'citizen' as const });

  it('keeps one stable illustrated identity across save/load without modifying the save format', () => {
    const person = citizen(107);
    const first = illustratedCharacterSpec(person);
    const saved = illustratedCharacterSpec(JSON.parse(JSON.stringify(person)));
    expect(saved).toEqual(first);
    expect(first.appearanceKey).toBe(
      `${first.sex}:${resolveCharacterWardrobe(person).signature}`,
    );
    expect(first.layers.every(layer => Number.isInteger(layer.tint))).toBe(true);
  });

  it('keeps all eight body types, three heights and skin palettes available for 6000 citizens', () => {
    const bodyTypes = new Set<string>(), heights = new Set<number>(), outfits = new Set<string>();
    const skinColors = new Set<number>(), faces = new Set<string>();
    const signatures = new Set<string>();
    for (let id = 0; id < 6000; id++) {
      const person = citizen(id), spec = illustratedCharacterSpec(person);
      expect(spec.sex).toBe(person.female ? 'female' : 'male');
      expect(spec.bodyId.startsWith(spec.sex)).toBe(true);
      bodyTypes.add(spec.bodyId);
      heights.add(spec.heightScale);
      outfits.add(spec.outfitId);
      skinColors.add(spec.skinColor);
      faces.add(spec.faceId);
      signatures.add(spec.appearanceKey);
    }
    expect(bodyTypes.size).toBe(CHARACTER_BODY_TYPES.length);
    expect(heights.size).toBe(3);
    expect(outfits.size).toBe(CHARACTER_OUTFITS.length);
    expect(skinColors.size).toBe(CHARACTER_SKIN_TONES.length);
    expect(faces.size).toBeGreaterThan(10);
    expect(signatures.size).toBeGreaterThan(5000);
  });

  it('defines ordered, compatible logical art layers for every production role', () => {
    const roles = ['citizen', 'boss', 'lieutenant', 'hood', 'police', 'policeChief', 'fbi', 'fbiHead',
      'firefighter', 'judge', 'lawyer', 'reporter', 'da', 'mayor'] as const;
    for (const role of roles) for (const female of [false, true]) {
      const plan = illustratedCharacterSpec({ id: 81, portrait: 2, female, role });
      const slots = plan.layers.map(layer => layer.slot);
      expect(slots).toContain('bodyLower');
      expect(slots).toContain('clothesUpper');
      expect(slots).toContain('face');
      expect(new Set(slots).size).toBe(slots.length);
      expect(slots).toEqual([...slots].sort((a,b) =>
        ILLUSTRATED_2D_LAYER_ORDER.indexOf(a)-ILLUSTRATED_2D_LAYER_ORDER.indexOf(b)));
      expect(plan.layers.every(l => !l.key.startsWith('/') && !l.key.includes('..'))).toBe(true);
    }
  });

  it('defines four views and four gait frames per authored part, rejecting invalid frames', () => {
    const plan = illustratedCharacterSpec(citizen(5));
    const keys = new Set(ILLUSTRATED_2D_DIRECTIONS.flatMap(dir =>
      Array.from({length: ILLUSTRATED_2D_WALK_FRAMES}, (_,frame) =>
        illustratedLayerTile(plan.layers[0],dir,frame))));
    expect(keys.size).toBe(16);
    expect(() => illustratedLayerTile(plan.layers[0],'front',-1)).toThrow();
    expect(() => illustratedLayerTile(plan.layers[0],'front',4)).toThrow();
  });

  it('does not add a hat layer to a bare-headed character', () => {
    const all = Array.from({length: 100}, (_,id) => illustratedCharacterSpec(citizen(id)));
    expect(all.some(x => x.layers.some(l => l.slot === 'headwear'))).toBe(true);
    expect(all.some(x => !x.layers.some(l => l.slot === 'headwear'))).toBe(true);
  });
});
