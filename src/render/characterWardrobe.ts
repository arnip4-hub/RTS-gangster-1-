import type { Person, PersonRole } from '../sim/types';
import { personSkinGroup, skinGroup, type AppearancePerson, type SkinGroup } from './personAppearance';

export type CharacterSex = 'male' | 'female';
export type BodyShape = 'thin' | 'average' | 'stocky' | 'heavy';
export interface CharacterBodyType {
  id: string;
  sex: CharacterSex;
  shape: BodyShape;
  widthScale: number;
  depthScale: number;
  shoulderScale: number;
  /** Extra belly projection in normalized model metres. */
  belly: number;
}

export const CHARACTER_BODY_TYPES: readonly CharacterBodyType[] = [
  { id: 'male-thin', sex: 'male', shape: 'thin', widthScale: .88, depthScale: .88, shoulderScale: .94, belly: -.015 },
  { id: 'male-average', sex: 'male', shape: 'average', widthScale: 1, depthScale: 1, shoulderScale: 1, belly: 0 },
  { id: 'male-stocky', sex: 'male', shape: 'stocky', widthScale: 1.14, depthScale: 1.10, shoulderScale: 1.13, belly: .035 },
  { id: 'male-heavy', sex: 'male', shape: 'heavy', widthScale: 1.26, depthScale: 1.25, shoulderScale: 1.08, belly: .13 },
  { id: 'female-thin', sex: 'female', shape: 'thin', widthScale: .88, depthScale: .89, shoulderScale: .96, belly: -.01 },
  { id: 'female-average', sex: 'female', shape: 'average', widthScale: 1, depthScale: 1, shoulderScale: 1, belly: 0 },
  { id: 'female-stocky', sex: 'female', shape: 'stocky', widthScale: 1.12, depthScale: 1.09, shoulderScale: 1.08, belly: .025 },
  { id: 'female-heavy', sex: 'female', shape: 'heavy', widthScale: 1.24, depthScale: 1.23, shoulderScale: 1.06, belly: .11 },
];

export const CHARACTER_HEIGHT_SCALES = [.94, 1, 1.06] as const;

export interface CharacterSkinTone { id: string; color: number; group: SkinGroup }
/** Shades remain inside the portrait's light/medium/deep identity family. */
export const CHARACTER_SKIN_TONES: readonly CharacterSkinTone[] = [
  { id: 'porcelain', color: 0xf0d0b4, group: 0 },
  { id: 'fair-rose', color: 0xe7bea1, group: 0 },
  { id: 'fair-warm', color: 0xdcb188, group: 0 },
  { id: 'light-olive', color: 0xd0aa83, group: 0 },
  { id: 'golden', color: 0xc99b72, group: 1 },
  { id: 'medium-olive', color: 0xb98a63, group: 1 },
  { id: 'warm-brown', color: 0xac7e56, group: 1 },
  { id: 'brown', color: 0x8b6140, group: 2 },
  { id: 'deep-brown', color: 0x744e34, group: 2 },
  { id: 'deep-umber', color: 0x5d3c2a, group: 2 },
];

export type HeadwearKind = 'none' | 'fedora' | 'trilby' | 'bowler' | 'flatCap' | 'straw' |
  'cloche' | 'beret' | 'brimmed' | 'pillbox' | 'uniformCap' | 'fireHelmet';
export interface CharacterHeadwear {
  id: string; sex: CharacterSex | 'any'; kind: HeadwearKind; color: number;
  brimScale: number; crownScale: number;
}
export const CHARACTER_HEADWEAR: readonly CharacterHeadwear[] = [
  { id: 'bare', sex: 'any', kind: 'none', color: 0x30271e, brimScale: 0, crownScale: 0 },
  { id: 'fedora-brown', sex: 'male', kind: 'fedora', color: 0x49382b, brimScale: 1, crownScale: 1 },
  { id: 'fedora-grey', sex: 'male', kind: 'fedora', color: 0x44454a, brimScale: 1.08, crownScale: .96 },
  { id: 'trilby', sex: 'male', kind: 'trilby', color: 0x5a4a38, brimScale: .82, crownScale: .91 },
  { id: 'bowler', sex: 'male', kind: 'bowler', color: 0x282725, brimScale: .87, crownScale: 1.08 },
  { id: 'flat-cap', sex: 'male', kind: 'flatCap', color: 0x68604d, brimScale: .81, crownScale: .50 },
  { id: 'newsboy-cap', sex: 'male', kind: 'flatCap', color: 0x655241, brimScale: .87, crownScale: .66 },
  { id: 'straw-boater', sex: 'male', kind: 'straw', color: 0xc4b185, brimScale: 1.04, crownScale: .69 },
  { id: 'cloche-ochre', sex: 'female', kind: 'cloche', color: 0x9a764b, brimScale: .77, crownScale: .94 },
  { id: 'cloche-burgundy', sex: 'female', kind: 'cloche', color: 0x693a3d, brimScale: .88, crownScale: .98 },
  { id: 'beret', sex: 'female', kind: 'beret', color: 0x394b44, brimScale: .67, crownScale: .57 },
  { id: 'wide-brim', sex: 'female', kind: 'brimmed', color: 0x54433b, brimScale: 1.36, crownScale: .76 },
  { id: 'straw-brim', sex: 'female', kind: 'straw', color: 0xcbb68a, brimScale: 1.20, crownScale: .70 },
  { id: 'pillbox', sex: 'female', kind: 'pillbox', color: 0x343d54, brimScale: .58, crownScale: .51 },
  { id: 'patrol-cap', sex: 'any', kind: 'uniformCap', color: 0x28385e, brimScale: .91, crownScale: .75 },
  { id: 'chief-cap', sex: 'any', kind: 'uniformCap', color: 0x202c4c, brimScale: .95, crownScale: .83 },
  { id: 'federal-fedora', sex: 'any', kind: 'fedora', color: 0x30343b, brimScale: 1.01, crownScale: 1 },
  { id: 'fire-helmet', sex: 'any', kind: 'fireHelmet', color: 0x5b4931, brimScale: 1.14, crownScale: .85 },
];

export type HairStyle = 'short' | 'parted' | 'slick' | 'balding' | 'bald' | 'bob' | 'wave' | 'bun' | 'curl';
export interface CharacterHair { id: string; sex: CharacterSex; style: HairStyle; color: number }
export const CHARACTER_HAIR_STYLES: readonly CharacterHair[] = [
  { id: 'short-black', sex: 'male', style: 'short', color: 0x211b17 },
  { id: 'short-brown', sex: 'male', style: 'short', color: 0x493322 },
  { id: 'side-part', sex: 'male', style: 'parted', color: 0x3d2b20 },
  { id: 'fair-part', sex: 'male', style: 'parted', color: 0x987749 },
  { id: 'slick-black', sex: 'male', style: 'slick', color: 0x211f1e },
  { id: 'slick-auburn', sex: 'male', style: 'slick', color: 0x67432e },
  { id: 'balding-brown', sex: 'male', style: 'balding', color: 0x554535 },
  { id: 'balding-grey', sex: 'male', style: 'balding', color: 0x9a9488 },
  { id: 'bald', sex: 'male', style: 'bald', color: 0x6f655b },
  { id: 'black-bob', sex: 'female', style: 'bob', color: 0x26201d },
  { id: 'brown-bob', sex: 'female', style: 'bob', color: 0x503824 },
  { id: 'auburn-bob', sex: 'female', style: 'bob', color: 0x784c32 },
  { id: 'blonde-wave', sex: 'female', style: 'wave', color: 0xa58957 },
  { id: 'dark-wave', sex: 'female', style: 'wave', color: 0x32251d },
  { id: 'brown-bun', sex: 'female', style: 'bun', color: 0x5c402e },
  { id: 'grey-bun', sex: 'female', style: 'bun', color: 0x9a9488 },
  { id: 'dark-curl', sex: 'female', style: 'curl', color: 0x2e231e },
  { id: 'copper-curl', sex: 'female', style: 'curl', color: 0x895638 },
];

export interface CharacterFacePreset {
  id: string; sex: CharacterSex; width: number; jawWidth: number;
  length: number; nose: number; cheeks: number;
}
const FACE_SHAPES = [
  ['oval', 1, .98, 1.02, 1, .98], ['round', 1.08, 1.04, .95, .92, 1.09],
  ['long', .94, .97, 1.08, 1.08, .95], ['square', 1.05, 1.13, .98, 1.03, 1.02],
  ['tapered', .99, .90, 1.03, 1.02, 1.03], ['broad', 1.10, 1.08, 1, .98, 1.06],
  ['narrow', .93, .95, 1.02, 1.07, .93], ['high-cheek', 1.02, .94, 1.04, .97, 1.13],
  ['soft-jaw', 1.03, .92, .99, .93, 1.05], ['strong-jaw', 1.02, 1.14, 1.01, 1.07, .98],
  ['compact', .98, 1.03, .94, .89, 1.02], ['aquiline', .97, .99, 1.06, 1.15, .96],
  ['full-cheek', 1.07, 1.01, .98, .96, 1.15], ['lean', .95, .96, 1.07, 1.04, .89],
  ['wide-chin', 1.04, 1.10, 1.03, 1.01, .96], ['small-chin', .98, .88, .98, .94, 1.02],
] as const;
export const CHARACTER_FACE_PRESETS: readonly CharacterFacePreset[] = (['male', 'female'] as const)
  .flatMap(sex => FACE_SHAPES.map(([name, width, jawWidth, length, nose, cheeks]) => ({
    id: `${sex}-${name}`, sex, width, jawWidth, length, nose, cheeks,
  })));

export type OutfitSilhouette = 'suit' | 'work' | 'coat' | 'dress' | 'robe' | 'uniform';
export type OutfitCollar = 'shirt' | 'tie' | 'bow' | 'scarf' | 'fur' | 'plain';
export type OutfitLength = 'waist' | 'hip' | 'knee' | 'ankle';
export type OutfitPattern = 'plain' | 'pinstripe' | 'tweed' | 'check';
export interface CharacterOutfit {
  id: string; label: string; sex: CharacterSex | 'any'; silhouette: OutfitSilhouette;
  coatColor: number; accentColor: number; trousersColor: number;
  /** Default headwear ID; the resolver may pick a compatible colour variant. */
  headwear: string; collar: OutfitCollar; length: OutfitLength; pattern: OutfitPattern;
  formality: 'work' | 'casual' | 'business' | 'evening';
  roles?: readonly PersonRole[];
}
type OutfitSpec = readonly [string, string, OutfitSilhouette, OutfitCollar, OutfitLength, OutfitPattern, string, number, number, number, CharacterOutfit['formality']];
function outfits(sex: CharacterSex, rows: readonly OutfitSpec[]): CharacterOutfit[] {
  return rows.map(([id, label, silhouette, collar, length, pattern, headwear, coatColor, accentColor, trousersColor, formality]) =>
    ({ id, label, sex, silhouette, collar, length, pattern, headwear, coatColor, accentColor, trousersColor, formality }));
}

/** Each row changes garment cut/accessories as well as its authored colours. */
export const CHARACTER_OUTFITS: readonly CharacterOutfit[] = [
  ...outfits('male', [
    ['m-tweed-suit', 'Tweed three-piece suit', 'suit', 'tie', 'hip', 'tweed', 'fedora-brown', 0x604832, 0x6a342f, 0x493b2e, 'business'],
    ['m-pinstripe', 'Pinstripe business suit', 'suit', 'tie', 'hip', 'pinstripe', 'fedora-grey', 0x343c4d, 0x704531, 0x2f3542, 'business'],
    ['m-check-suit', 'Checked country suit', 'suit', 'bow', 'hip', 'check', 'trilby', 0x635c42, 0x713f35, 0x514d3c, 'casual'],
    ['m-morning-suit', 'Formal morning suit', 'suit', 'tie', 'knee', 'plain', 'bowler', 0x343437, 0x756755, 0x47464c, 'business'],
    ['m-evening-suit', 'Evening dinner suit', 'suit', 'bow', 'hip', 'plain', 'bare', 0x25262a, 0x252126, 0x24262a, 'evening'],
    ['m-linen-suit', 'Summer linen suit', 'suit', 'tie', 'waist', 'plain', 'straw-boater', 0xc0ad8d, 0x5b4031, 0xb6a384, 'business'],
    ['m-double-breasted', 'Double-breasted town suit', 'suit', 'scarf', 'hip', 'plain', 'trilby', 0x494a47, 0xad9b77, 0x3b3d3b, 'business'],
    ['m-velvet-jacket', 'Velvet evening jacket', 'suit', 'bow', 'waist', 'plain', 'fedora-brown', 0x583c45, 0x26252b, 0x2e2b2e, 'evening'],
    ['m-waistcoat', 'Shirt and waistcoat', 'work', 'tie', 'waist', 'pinstripe', 'bare', 0x706653, 0x5a352d, 0x4c463b, 'business'],
    ['m-shop-jacket', 'Shopkeeper jacket', 'suit', 'shirt', 'waist', 'check', 'bowler', 0x696153, 0xd1c7ac, 0x4c4b43, 'business'],
    ['m-work-shirt', 'Rolled-sleeve work shirt', 'work', 'shirt', 'waist', 'plain', 'flat-cap', 0xb6aa8c, 0x665545, 0x514d43, 'work'],
    ['m-work-vest', 'Work vest and cap', 'work', 'plain', 'waist', 'tweed', 'newsboy-cap', 0x70604a, 0xbaad8b, 0x564c3e, 'work'],
    ['m-dock-jacket', 'Dockworker short jacket', 'work', 'scarf', 'hip', 'plain', 'flat-cap', 0x4a5555, 0x9b7555, 0x3e4646, 'work'],
    ['m-overall-jacket', 'Workshop jacket', 'work', 'shirt', 'hip', 'check', 'newsboy-cap', 0x4c5d6a, 0xc0b292, 0x3f4c55, 'work'],
    ['m-delivery-driver', 'Delivery driver jacket', 'work', 'tie', 'waist', 'plain', 'flat-cap', 0x6b5a44, 0x453b32, 0x514a40, 'work'],
    ['m-knit-cardigan', 'Cardigan and open collar', 'work', 'shirt', 'waist', 'tweed', 'bare', 0x776c50, 0xc6b89b, 0x4d4a40, 'casual'],
    ['m-newsboy', 'Newsboy jacket and scarf', 'work', 'scarf', 'waist', 'check', 'newsboy-cap', 0x7b6248, 0x6b3e32, 0x514536, 'casual'],
    ['m-raincoat', 'Belted raincoat', 'coat', 'shirt', 'knee', 'plain', 'fedora-grey', 0xa39170, 0x5d5648, 0x4b4942, 'casual'],
    ['m-wool-overcoat', 'Wool town overcoat', 'coat', 'tie', 'knee', 'tweed', 'fedora-brown', 0x645545, 0x6f342f, 0x423a31, 'business'],
    ['m-fur-collar', 'Fur-collared overcoat', 'coat', 'fur', 'knee', 'plain', 'bowler', 0x443a34, 0x8e7c61, 0x363332, 'evening'],
    ['m-long-duster', 'Long travelling duster', 'coat', 'scarf', 'ankle', 'plain', 'trilby', 0x8d7a59, 0x5a4437, 0x50483c, 'casual'],
    ['m-peacoat', 'Short wool peacoat', 'coat', 'plain', 'hip', 'plain', 'flat-cap', 0x35424a, 0x9b8c6f, 0x30393d, 'work'],
    ['m-check-overcoat', 'Checked overcoat', 'coat', 'bow', 'knee', 'check', 'fedora-grey', 0x6f6c5a, 0x583737, 0x4e4d44, 'business'],
    ['m-camel-coat', 'Camel coat and silk scarf', 'coat', 'scarf', 'knee', 'tweed', 'straw-boater', 0xad8d60, 0x6e4638, 0x54483a, 'evening'],
    ['m-short-leather', 'Short leather driving coat', 'coat', 'fur', 'waist', 'plain', 'newsboy-cap', 0x4b382c, 0xa08a66, 0x48423b, 'casual'],
  ]),
  ...outfits('female', [
    ['f-day-dress', 'Day dress with bow', 'dress', 'bow', 'knee', 'plain', 'cloche-ochre', 0x6d7c60, 0xc0ae8d, 0x6d7c60, 'casual'],
    ['f-shirtwaist', 'Shirtwaist dress', 'dress', 'shirt', 'knee', 'pinstripe', 'straw-brim', 0x8d8063, 0xd2c4a7, 0x8d8063, 'casual'],
    ['f-check-day', 'Checked day dress', 'dress', 'plain', 'knee', 'check', 'beret', 0x775b58, 0xbca58e, 0x775b58, 'casual'],
    ['f-scarf-dress', 'Scarf-neck afternoon dress', 'dress', 'scarf', 'knee', 'plain', 'pillbox', 0x566e6a, 0xb09368, 0x566e6a, 'casual'],
    ['f-long-day', 'Long house dress', 'dress', 'shirt', 'ankle', 'plain', 'bare', 0x8c7661, 0xc5b697, 0x8c7661, 'casual'],
    ['f-evening-gown', 'Long evening gown', 'dress', 'bow', 'ankle', 'plain', 'bare', 0x643c42, 0xc6ae79, 0x643c42, 'evening'],
    ['f-satin-gown', 'Satin gown and scarf', 'dress', 'scarf', 'ankle', 'plain', 'pillbox', 0x344e61, 0xb4a885, 0x344e61, 'evening'],
    ['f-cocktail', 'Cocktail dress', 'dress', 'plain', 'knee', 'plain', 'wide-brim', 0x3c3c43, 0xb8a77c, 0x3c3c43, 'evening'],
    ['f-dance-dress', 'Dance dress with bow', 'dress', 'bow', 'knee', 'pinstripe', 'bare', 0x9a7650, 0x594439, 0x9a7650, 'evening'],
    ['f-party-dress', 'Party dress and stole', 'dress', 'fur', 'knee', 'plain', 'pillbox', 0x6b4a66, 0xaf9b7c, 0x6b4a66, 'evening'],
    ['f-skirt-suit', 'Tailored skirt suit', 'suit', 'tie', 'hip', 'pinstripe', 'cloche-burgundy', 0x50566b, 0xc7b99a, 0x444b60, 'business'],
    ['f-tweed-suit', 'Tweed skirt suit', 'suit', 'shirt', 'hip', 'tweed', 'beret', 0x6b7155, 0xc8b895, 0x5c614b, 'business'],
    ['f-short-suit', 'Short jacket and skirt', 'suit', 'bow', 'waist', 'plain', 'pillbox', 0x795852, 0xc8b6a0, 0x654b47, 'business'],
    ['f-check-suit', 'Checked jacket and skirt', 'suit', 'scarf', 'hip', 'check', 'wide-brim', 0x7b725e, 0x6e4845, 0x5e594c, 'business'],
    ['f-clerk-blouse', 'Clerk blouse and waistcoat', 'work', 'shirt', 'waist', 'plain', 'bare', 0xb5a98e, 0x66594c, 0x4f514c, 'work'],
    ['f-shop-worker', 'Shop worker dress and jacket', 'work', 'bow', 'hip', 'plain', 'cloche-ochre', 0x7e6c58, 0xc4b79b, 0x635745, 'work'],
    ['f-work-cardigan', 'Cardigan over work dress', 'work', 'plain', 'waist', 'tweed', 'bare', 0x6d7666, 0xbcad8f, 0x565f53, 'work'],
    ['f-service-blouse', 'Service blouse and scarf', 'work', 'scarf', 'waist', 'check', 'beret', 0x8c8170, 0x6f4a43, 0x63594e, 'work'],
    ['f-wool-coat', 'Wool coat and cloche', 'coat', 'shirt', 'knee', 'tweed', 'cloche-ochre', 0x79664c, 0xc3ad86, 0x574a3b, 'casual'],
    ['f-fur-coat', 'Fur coat', 'coat', 'fur', 'knee', 'plain', 'cloche-burgundy', 0x5c4435, 0x9e7f5d, 0x45372e, 'evening'],
    ['f-long-fur', 'Long fur-trimmed coat', 'coat', 'fur', 'ankle', 'tweed', 'wide-brim', 0x494144, 0xa99a7c, 0x3b3439, 'evening'],
    ['f-raincoat', 'Belted raincoat', 'coat', 'scarf', 'knee', 'plain', 'beret', 0xa2926f, 0x6a5041, 0x6e604c, 'casual'],
    ['f-travel-coat', 'Travelling coat', 'coat', 'tie', 'ankle', 'check', 'cloche-burgundy', 0x686b62, 0xa89576, 0x4d5048, 'business'],
    ['f-short-cape', 'Short cape over dress', 'coat', 'plain', 'waist', 'plain', 'wide-brim', 0x5b4e64, 0xb5a189, 0x4d4353, 'casual'],
    ['f-town-overcoat', 'Town overcoat and bow', 'coat', 'bow', 'knee', 'pinstripe', 'pillbox', 0x445a63, 0xae9270, 0x3c4e55, 'business'],
  ]),
];

const uniform = (id: string, label: string, roles: readonly PersonRole[], coatColor: number,
  accentColor: number, headwear: string, sex: CharacterSex | 'any' = 'any', silhouette: OutfitSilhouette = 'uniform'): CharacterOutfit =>
  ({ id, label, roles, coatColor, accentColor, headwear, sex, silhouette, trousersColor: coatColor,
    collar: silhouette === 'robe' ? 'plain' : 'tie', length: silhouette === 'robe' ? 'ankle' : 'hip',
    pattern: 'plain', formality: 'work' });

export const CHARACTER_UNIFORMS: readonly CharacterOutfit[] = [
  uniform('police-patrol-male', 'Patrol uniform', ['police'], 0x2a3a64, 0xb9a66d, 'patrol-cap', 'male'),
  uniform('police-patrol-female', 'Women patrol uniform', ['police'], 0x2a3a64, 0xb9a66d, 'patrol-cap', 'female'),
  uniform('police-chief', 'Police chief uniform', ['policeChief'], 0x232f52, 0xc6ad6e, 'chief-cap'),
  uniform('federal-agent', 'Federal field suit', ['fbi'], 0x303840, 0xa29b88, 'federal-fedora'),
  uniform('federal-chief', 'Federal chief suit', ['fbiHead'], 0x292e36, 0xc0b29a, 'federal-fedora'),
  uniform('firefighter', 'Firefighter turnout coat', ['firefighter'], 0x625037, 0xb7a37c, 'fire-helmet'),
  uniform('judge-robe', 'Judicial robe', ['judge'], 0x29282a, 0xb6ab98, 'bare', 'any', 'robe'),
  uniform('clergy-robe', 'Clerical coat', ['clergy'], 0x343133, 0xd5cbb4, 'bare', 'any', 'robe'),
];

export interface ResolvedCharacterWardrobe {
  body: CharacterBodyType;
  heightScale: number;
  skinColor: number;
  skinIndex: number;
  skinGroup: SkinGroup;
  outfit: CharacterOutfit;
  colorIndex: number;
  face: CharacterFacePreset;
  hair: CharacterHair;
  headwear: CharacterHeadwear;
  signature: string;
}
export type CharacterWardrobe = ResolvedCharacterWardrobe;
export type WardrobePerson = AppearancePerson & Partial<Pick<Person, 'gangId'>>;

/** Independent salts keep body, outfit and complexion from tracking together. */
function roll(person: Pick<Person, 'id' | 'portrait'>, salt: number): number {
  let h = Math.imul((person.id | 0) ^ salt, 0x45d9f3b) ^ Math.imul(person.portrait | 0, 0x27d4eb2d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function choose<T>(rows: readonly T[], person: WardrobePerson, salt: number): T {
  return rows[roll(person, salt) % rows.length];
}

const FORMAL_ROLES: ReadonlySet<PersonRole> = new Set(['boss', 'lieutenant', 'accountant', 'lawyer', 'da', 'mayor']);
const COAT_PALETTES: Record<OutfitSilhouette, readonly number[]> = {
  suit: [0x514437, 0x3e485b, 0x48474a, 0x74654d, 0x4f5946, 0x6b4b48],
  work: [0x7e7056, 0x52616a, 0x71765e, 0x80654e, 0x655c51, 0x9d8d6e],
  coat: [0x655443, 0x4c5756, 0x8d7959, 0x54454e, 0x3d4659, 0x786a57],
  dress: [0x62775e, 0x79514f, 0x4a6371, 0x8b7653, 0x674e68, 0x3f4448],
  robe: [0x29282a], uniform: [0x2a3a64],
};

/** Recompute after a deliberate gallery override, including palette changes. */
export function withCharacterWardrobe(base: ResolvedCharacterWardrobe,
  overrides: Partial<Omit<ResolvedCharacterWardrobe, 'signature'>>): ResolvedCharacterWardrobe {
  const next = { ...base, ...overrides };
  if (overrides.outfit && !overrides.headwear)
    next.headwear = CHARACTER_HEADWEAR.find(row => row.id === overrides.outfit!.headwear) ?? base.headwear;
  if (overrides.skinIndex != null && overrides.skinColor == null) {
    const tone = CHARACTER_SKIN_TONES[overrides.skinIndex];
    if (tone) { next.skinColor = tone.color; next.skinGroup = tone.group; }
  }
  return { ...next, signature: characterWardrobeSignature(next) };
}

export function characterWardrobeSignature(wardrobe: Omit<ResolvedCharacterWardrobe, 'signature'>): string {
  const { body, heightScale, skinColor, outfit, face, hair, headwear } = wardrobe;
  return [body.id, heightScale, skinColor.toString(16), outfit.id, outfit.coatColor.toString(16),
    outfit.accentColor.toString(16), outfit.trousersColor.toString(16), face.id,
    hair.id, hair.color.toString(16), headwear.id, headwear.color.toString(16)].join(':');
}

/** Derived from saved identity: no extra per-person meshes or save fields. */
export function resolveCharacterWardrobe(person: WardrobePerson): ResolvedCharacterWardrobe {
  const sex: CharacterSex = person.female ? 'female' : 'male';
  const uniforms = CHARACTER_UNIFORMS.filter(row => row.roles?.includes(person.role) && (row.sex === sex || row.sex === 'any'));
  let candidates = CHARACTER_OUTFITS.filter(row => row.sex === sex);
  if (FORMAL_ROLES.has(person.role)) candidates = candidates.filter(row => row.formality === 'business' || row.formality === 'evening');
  // Reporting is an occupation, not a uniform. It chooses practical town wear.
  if (person.role === 'reporter') candidates = candidates.filter(row => row.formality === 'business' || row.formality === 'casual');
  const authored = choose(uniforms.length ? uniforms : candidates, person, 0x67e131);
  const colorIndex = uniforms.length ? 0 : roll(person, 0x12d877) % 6;
  const coatColor = colorIndex === 0 ? authored.coatColor : COAT_PALETTES[authored.silhouette][colorIndex];
  const outfit = colorIndex === 0 ? authored : { ...authored, coatColor };
  // The old sprite atlas omitted medium-tone constables. The 3D material can
  // represent every tone, so police keep their original identity family.
  const group = person.role === 'police' ? skinGroup(person) : personSkinGroup(person);
  const tone = choose(CHARACTER_SKIN_TONES.filter(row => row.group === group), person, 0x7ba32);
  const skinIndex = CHARACTER_SKIN_TONES.indexOf(tone);
  const requestedHat = CHARACTER_HEADWEAR.find(row => row.id === outfit.headwear)!;
  const compatibleHats = CHARACTER_HEADWEAR.filter(row => row.kind === requestedHat.kind &&
    (row.sex === sex || row.sex === 'any') && !['patrol-cap', 'chief-cap', 'federal-fedora', 'fire-helmet'].includes(row.id));
  const headwear = uniforms.length || compatibleHats.length === 0 ? requestedHat : choose(compatibleHats, person, 0x381bf);
  const wardrobe = {
    body: choose(CHARACTER_BODY_TYPES.filter(row => row.sex === sex), person, 0xa12d77),
    heightScale: choose(CHARACTER_HEIGHT_SCALES, person, 0xd7f226),
    skinColor: tone.color, skinIndex, skinGroup: group, outfit, colorIndex,
    face: choose(CHARACTER_FACE_PRESETS.filter(row => row.sex === sex), person, 0xe8c441),
    hair: choose(CHARACTER_HAIR_STYLES.filter(row => row.sex === sex), person, 0x95a05b),
    headwear,
  };
  return { ...wardrobe, signature: characterWardrobeSignature(wardrobe) };
}
