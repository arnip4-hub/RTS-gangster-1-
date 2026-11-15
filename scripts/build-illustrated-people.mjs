/** Cut the original commissioned illustration sheets into game atlases. */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const source = 'art-source/illustrated';
const portraits = 'public/art/portraits/illustrated';
const portraitKinds = [
  ['m','m','m','m', 'f','f','f','f', 'police-m','police-m','fbi-m','fbi-f'],
  ['m','m','m','m', 'f','f','f','f', 'police-m','police-f','fbi-m','fbi-m'],
  ['m','f','m','f', 'f','m','f','m', 'm','f','f','m'],
  ['gang-m','gang-m','gang-m','gang-m', 'gang-m','gang-m','gang-f','gang-f', 'gang-f','gang-f','gang-f','gang-f'],
];
const counts = new Map();
await mkdir(portraits, { recursive: true });
for (let sheetIndex = 0; sheetIndex < portraitKinds.length; sheetIndex++) {
  const file = join(source, `portraits-0${sheetIndex + 1}.png`);
  const { width, height } = await sharp(file).metadata();
  if (!width || !height || width % 4 || height % 3 || width / 4 !== height / 3)
    throw Error(`${file}: expected twelve square cells`);
  const cell = width / 4;
  for (let index = 0; index < 12; index++) {
    const kind = portraitKinds[sheetIndex][index];
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    const out = join(portraits, `${kind}-${String(n).padStart(2, '0')}.png`);
    await sharp(file).extract({ left: index % 4 * cell + 3, top: Math.floor(index / 4) * cell + 3,
      width: cell - 6, height: cell - 6 }).resize(256, 256).png({ compressionLevel: 9 }).toFile(out);
  }
}
const expected = { m: 14, f: 14, 'gang-m': 6, 'gang-f': 6,
  'police-m': 3, 'police-f': 1, 'fbi-m': 3, 'fbi-f': 1 };
for (const [kind, n] of Object.entries(expected)) if (counts.get(kind) !== n)
  throw Error(`Portrait count for ${kind}: ${counts.get(kind)} (expected ${n})`);

// The generator cut the far-right figure at the sheet edge. Mirror the
// complete left-facing profile instead; direction cells are front/back/left/right.
const CELL = 256, atlasCells = [];
for (let sheetIndex = 0; sheetIndex < 3; sheetIndex++) {
  const file = join(source, `people-0${sheetIndex + 1}.png`);
  const { width, height } = await sharp(file).metadata();
  if (!width || !height) throw Error(`Missing ${file}`);
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const sourceColumn = column === 3 ? 2 : column;
    const left = Math.round(sourceColumn * width / 4) + 3;
    const top = Math.round(row * height / 4) + 3;
    const right = Math.round((sourceColumn + 1) * width / 4) - 3;
    const bottom = Math.round((row + 1) * height / 4) - 3;
    let tile = sharp(file).extract({ left, top, width: right - left, height: bottom - top });
    if (column === 3) tile = tile.flop();
    // Keep uniform cell size and foot level; the transparent source may have
    // small fringe pixels, but no old-game asset is present in these sheets.
    const sprite = await tile.resize(CELL - 24, CELL - 12, { fit: 'contain', background: '#00000000' })
      .png().toBuffer();
    atlasCells.push({ input: sprite, left: column * CELL + 12,
      top: (sheetIndex * 4 + row) * CELL + 12 });
  }
}
await sharp({ create: { width: 4 * CELL, height: 12 * CELL, channels: 4, background: '#00000000' } })
  .composite(atlasCells).png({ compressionLevel: 9 })
  .toFile('public/art/city/illustrated-people-atlas.png');
console.log(`Illustrated people: ${[...counts.values()].reduce((a, b) => a + b, 0)} portraits, 12 directional sprite rows`);
