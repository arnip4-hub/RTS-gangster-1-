import { describe, expect, it } from 'vitest';
import type { PersonRole } from '../src/sim/types';
import { personSkinGroup, skinGroup } from '../src/render/personAppearance';
import {
  CHARACTER_BODY_TYPES, CHARACTER_FACE_PRESETS, CHARACTER_HAIR_STYLES,
  CHARACTER_HEADWEAR, CHARACTER_HEIGHT_SCALES, CHARACTER_OUTFITS, CHARACTER_SKIN_TONES,
  CHARACTER_UNIFORMS, resolveCharacterWardrobe, withCharacterWardrobe,
} from '../src/render/characterWardrobe';

const citizen = (id: number, female = id % 2 === 0) => ({ id, portrait: id % 48, female, role: 'citizen' as const });

describe('composed 1930s character wardrobe', () => {
  it('provides fitted clothing and body choices for both sexes with valid accessory references', () => {
    expect(CHARACTER_OUTFITS).toHaveLength(50);
    expect(CHARACTER_UNIFORMS).toHaveLength(8);
    expect(CHARACTER_BODY_TYPES).toHaveLength(8);
    expect(CHARACTER_HEIGHT_SCALES).toHaveLength(3);
    expect(CHARACTER_SKIN_TONES).toHaveLength(10);
    expect(CHARACTER_FACE_PRESETS).toHaveLength(32);
    expect(CHARACTER_HAIR_STYLES).toHaveLength(18);
    expect(CHARACTER_HEADWEAR).toHaveLength(18);
    for (const sex of ['male', 'female']) {
      expect(CHARACTER_OUTFITS.filter(row => row.sex === sex)).toHaveLength(25);
      expect(CHARACTER_BODY_TYPES.filter(row => row.sex === sex).map(row => row.shape))
        .toEqual(['thin', 'average', 'stocky', 'heavy']);
    }
    for (const row of [...CHARACTER_OUTFITS, ...CHARACTER_UNIFORMS]) {
      const hat = CHARACTER_HEADWEAR.find(h => h.id === row.headwear);
      expect(hat, row.id).toBeDefined();
      expect(hat!.sex === 'any' || row.sex === 'any' || hat!.sex === row.sex, row.id).toBe(true);
      for (const color of [row.coatColor, row.accentColor, row.trousersColor])
        expect(Number.isInteger(color) && color >= 0 && color <= 0xffffff, row.id).toBe(true);
    }
    // Presets differ in their actual cut/accessories, beyond names or IDs.
    const cuts = new Set(CHARACTER_OUTFITS.map(row => [row.sex, row.silhouette, row.collar,
      row.length, row.pattern, row.headwear].join(':')));
    expect(cuts.size).toBe(50);
  });

  it('keeps identity stable through a save round trip and independent of gang membership', () => {
    const person = citizen(3527);
    const before = resolveCharacterWardrobe(person);
    expect(resolveCharacterWardrobe(JSON.parse(JSON.stringify(person)))).toEqual(before);
    expect(resolveCharacterWardrobe({ ...person, gangId: 77 })).toEqual(before);
    expect(resolveCharacterWardrobe(person).signature).not.toBe(resolveCharacterWardrobe(citizen(3529)).signature);
  });

  it('covers the catalog across 6000 citizens without correlating bodies, skin or clothes', () => {
    const population = Array.from({ length: 6000 }, (_, id) => {
      const person = citizen(id);
      return { person, wardrobe: resolveCharacterWardrobe(person) };
    });
    const outfits = new Set<string>(), bodies = new Set<string>(), skin = new Set<number>();
    const faces = new Set<string>(), hair = new Set<string>(), heights = new Set<number>();
    const bodiesByOutfit = new Map<string, Set<string>>(), bodiesBySkin = new Map<number, Set<string>>();
    for (const { person, wardrobe: w } of population) {
      const sex = person.female ? 'female' : 'male';
      expect(w.body.sex).toBe(sex); expect(w.face.sex).toBe(sex); expect(w.hair.sex).toBe(sex);
      expect(w.outfit.sex).toBe(sex);
      expect(w.headwear.sex === sex || w.headwear.sex === 'any').toBe(true);
      expect(w.skinGroup).toBe(personSkinGroup(person));
      expect(CHARACTER_SKIN_TONES[w.skinIndex].group).toBe(w.skinGroup);
      expect(CHARACTER_SKIN_TONES[w.skinIndex].color).toBe(w.skinColor);
      outfits.add(w.outfit.id); bodies.add(w.body.id); skin.add(w.skinIndex);
      faces.add(w.face.id); hair.add(w.hair.id); heights.add(w.heightScale);
      if (!bodiesByOutfit.has(w.outfit.id)) bodiesByOutfit.set(w.outfit.id, new Set());
      bodiesByOutfit.get(w.outfit.id)!.add(w.body.shape);
      if (!bodiesBySkin.has(w.skinIndex)) bodiesBySkin.set(w.skinIndex, new Set());
      bodiesBySkin.get(w.skinIndex)!.add(w.body.id);
    }
    expect(outfits.size).toBe(50); expect(bodies.size).toBe(8); expect(skin.size).toBe(10);
    expect(faces.size).toBe(32); expect(hair.size).toBe(18); expect(heights.size).toBe(3);
    for (const choices of bodiesByOutfit.values()) expect(choices.size).toBe(4);
    for (const choices of bodiesBySkin.values()) expect(choices.size).toBe(8);
    const identities = new Set(population.map(({ wardrobe }) => wardrobe.signature));
    expect(identities.size).toBeGreaterThan(5900);
  });

  it('ties uniforms to actual roles and preserves the same body and face when roles change', () => {
    const uniforms: [PersonRole, string][] = [
      ['police', 'police-patrol'], ['policeChief', 'police-chief'],
      ['fbi', 'federal-agent'], ['fbiHead', 'federal-chief'], ['firefighter', 'firefighter'],
      ['judge', 'judge-robe'], ['clergy', 'clergy-robe'],
    ];
    for (const female of [false, true]) {
      const person = citizen(1027, female);
      const civilian = resolveCharacterWardrobe(person);
      for (const [role, prefix] of uniforms) {
        const w = resolveCharacterWardrobe({ ...person, role });
        expect(w.outfit.id.startsWith(prefix)).toBe(true);
        expect(w.outfit.roles).toContain(role);
        expect(w.body).toEqual(civilian.body);
        expect(w.face).toEqual(civilian.face);
        expect(w.hair).toEqual(civilian.hair);
      }
      for (const role of ['mayor', 'da', 'lawyer', 'accountant'] as const) {
        const w = resolveCharacterWardrobe({ ...person, role });
        expect(['business', 'evening']).toContain(w.outfit.formality);
        expect(w.outfit.roles).toBeUndefined();
      }
    }
  });

  it('uses all skin families for 3D constables while retaining commissioned crew identities', () => {
    const police = Array.from({ length: 600 }, (_, id) => ({ ...citizen(id), role: 'police' as const }));
    for (const person of police) expect(resolveCharacterWardrobe(person).skinGroup).toBe(skinGroup(person));
    expect(new Set(police.map(p => resolveCharacterWardrobe(p).skinIndex)).size).toBe(10);
    for (const role of ['boss', 'lieutenant', 'hood', 'policeChief', 'fbiHead', 'mayor'] as const)
      for (let portrait = 0; portrait < 6; portrait++) {
        const person = { ...citizen(42), role, portrait };
        expect(resolveCharacterWardrobe(person).skinGroup).toBe(personSkinGroup(person));
      }
  });

  it('allows explicit gallery choices without stale hats, skin colours or material signatures', () => {
    const base = resolveCharacterWardrobe(citizen(100, false));
    const coat = CHARACTER_OUTFITS.find(row => row.id === 'm-fur-collar')!;
    const changed = withCharacterWardrobe(base, { outfit: coat, skinIndex: 9 });
    expect(changed.headwear.id).toBe(coat.headwear);
    expect(changed.skinColor).toBe(CHARACTER_SKIN_TONES[9].color);
    expect(changed.skinGroup).toBe(2);
    expect(changed.signature).not.toBe(base.signature);
    expect(withCharacterWardrobe(changed, {}).signature).toBe(changed.signature);
  });
});
