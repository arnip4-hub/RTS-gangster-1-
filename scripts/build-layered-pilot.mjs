/** Generate compact directional atlases from the editable SVG character parts.
 * No game state changes, graphics settings or browser canvas are required.
 * Source: art-source/illustrated/layered-pilot/{slot}/{direction}.svg
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'art-source/illustrated/layered-pilot';
const OUTPUT = 'public/art/city/layered-pilot';
const DIRECTIONS = ['front', 'back', 'left', 'right'];
const LAYERS = ['backHair', 'bodyLower', 'clothesLower', 'bodyUpper', 'clothesUpper', 'face', 'frontHair', 'headwear'];
const TILE = { width: 256, height: 384 }, FRAMES = 4, COLUMNS = FRAMES + 1;
// The painted poses remain editable SVG vector paths. A few hand-authored limbs
// are hinged about their actual hips/shoulders to produce a four-frame walk.
const motion = [
  { leftLeg: 14, rightLeg: -14, leftArm: -10, rightArm: 10, bounce: 0, liftL: 0, liftR: 5 },
  { leftLeg: 5, rightLeg: -5, leftArm: -4, rightArm: 4, bounce: -3, liftL: 0, liftR: 2 },
  { leftLeg: -14, rightLeg: 14, leftArm: 10, rightArm: -10, bounce: 0, liftL: 5, liftR: 0 },
  { leftLeg: -5, rightLeg: 5, leftArm: 4, rightArm: -4, bounce: -3, liftL: 2, liftR: 0 },
];

export function poseSvg(source, frame) {
  const m = motion[frame];
  if (!m) throw Error(`Missing walk pose ${frame}`);
  const hinge = {
    'left-leg': `rotate(${m.leftLeg} 117 250) translate(0 ${-m.liftL})`,
    'right-leg': `rotate(${m.rightLeg} 141 250) translate(0 ${-m.liftR})`,
    'left-arm': `rotate(${m.leftArm} 91 179)`,
    'right-arm': `rotate(${m.rightArm} 166 179)`,
  };
  let svg = source;
  for (const [id, transform] of Object.entries(hinge))
    svg = svg.replaceAll(`data-walk="${id}"`, `transform="${transform}"`);
  return svg.replace('id="painted-', `transform="translate(0 ${m.bounce})" id="painted-`);
}

export async function buildLayeredPilot() {
  await mkdir(OUTPUT, { recursive: true });
  for (const layer of LAYERS) {
    const pieces = [];
    for (const [row, direction] of DIRECTIONS.entries()) {
      const source = await readFile(join(SOURCE, layer, `${direction}.svg`), 'utf8');
      if (!source.includes('viewBox="0 0 256 384"')) throw Error(`Bad canvas: ${layer}/${direction}`);
      for (let column = 0; column < COLUMNS; column++) {
        const svg = column === 0 ? source : poseSvg(source, column - 1);
        const tile = await sharp(Buffer.from(svg)).png().toBuffer();
        pieces.push({ input: tile, left: column * TILE.width, top: row * TILE.height });
      }
    }
    const out = join(OUTPUT, `${layer}.png`);
    await sharp({ create: { width: TILE.width * COLUMNS, height: TILE.height * DIRECTIONS.length,
      channels: 4, background: '#00000000' } }).composite(pieces)
      .png({ compressionLevel: 9, palette: false }).toFile(out);
  }
  const manifest = {
    version: 1, pilot: '1930s-male-fedora-suit', cell: TILE,
    directions: DIRECTIONS, frames: FRAMES, layers: LAYERS,
    // Full matched frame per layer; selected figure is composited in the renderer.
    atlas: { columns: COLUMNS, rows: DIRECTIONS.length },
  };
  await writeFile(join(OUTPUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await buildLayeredPilot();
  console.log(`Layered 1930s pilot: ${m.layers.length} independently editable SVG parts × ${m.directions.length} directions × ${m.frames} gait frames`);
}
