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
// 32 rows at 128px fit the 4096px texture limit on older GPUs.
const CELL = 128, SHEETS = 8, atlasCells = [];
for (let sheetIndex = 0; sheetIndex < SHEETS; sheetIndex++) {
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
    const sprite = await tile.resize(CELL - 16, CELL - 8, { fit: 'contain', background: '#00000000' })
      .png().toBuffer();
    atlasCells.push({ input: sprite, left: column * CELL + 8,
      top: (sheetIndex * 4 + row) * CELL + 8 });
  }
}
await sharp({ create: { width: 4 * CELL, height: SHEETS * 4 * CELL, channels: 4, background: '#00000000' } })
  .composite(atlasCells).png({ compressionLevel: 9 })
  .toFile('public/art/city/illustrated-people-atlas.png');

// Three cycles are individually painted. For the remaining silhouettes,
// separate the lower body into counter-moving halves and shift the coat/hem
// with the stride. This produces four distinct 2D frames per direction while
// preserving the exact costume, skin and face from the standing art. The
// generated cycles are a baseline for later hand-painted animation passes.
const WALK_CELL = 80, WALK_PER_PAGE = 11;
const handDrawn = new Map([[0, 'man'], [1, 'woman'], [2, 'police']]);
async function paintedWalkCell(kind, direction, frame) {
  const file = join(source, `walk-${kind}-01.png`);
  const { width, height } = await sharp(file).metadata();
  if (!width || !height) throw Error(`Missing ${file}`);
  const sourceRow = direction === 3 ? 2 : direction;
  const left = Math.round(frame * width / 4) + 3;
  const top = Math.round(sourceRow * height / 4) + 3;
  const right = Math.round((frame + 1) * width / 4) - 3;
  const bottom = Math.round((sourceRow + 1) * height / 4) - 3;
  let tile = sharp(file).extract({ left, top, width: right - left, height: bottom - top });
  if (direction === 3) tile = tile.flop();
  return tile.resize(WALK_CELL - 4, WALK_CELL - 4, { fit: 'contain', background: '#00000000' }).png().toBuffer();
}

function walkWarp(data, width, height, direction, frame) {
  const output = Buffer.alloc(data.length);
  const step = [1, .22, -1, -.22][frame];
  const bounce = frame % 2 ? -1.2 : .6;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const down = Math.max(0, (y / height - .43) / .57);
    const split = Math.tanh((x - width * .5) / 8);
    const coat = Math.sin(Math.PI * Math.min(1, down)) * step * 1.3;
    const legs = down * down * step * split * (direction < 2 ? 5.2 : 7.2);
    const sx = Math.max(0, Math.min(width - 1, Math.round(x - coat - legs)));
    const sy = Math.max(0, Math.min(height - 1, Math.round(y - bounce * down)));
    const from = (sy * width + sx) * 4, to = (y * width + x) * 4;
    output[to] = data[from]; output[to + 1] = data[from + 1];
    output[to + 2] = data[from + 2]; output[to + 3] = data[from + 3];
  }
  return output;
}

const staticAtlas = 'public/art/city/illustrated-people-atlas.png';
for (let page = 0; page < Math.ceil(SHEETS * 4 / WALK_PER_PAGE); page++) {
  const start = page * WALK_PER_PAGE;
  const count = Math.min(WALK_PER_PAGE, SHEETS * 4 - start);
  const cells = [];
  for (let local = 0; local < count; local++) {
    const kind = start + local;
    for (let direction = 0; direction < 4; direction++) {
      let standing;
      if (!handDrawn.has(kind)) {
        const result = await sharp(staticAtlas).extract({ left: direction * CELL, top: kind * CELL,
          width: CELL, height: CELL }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        standing = result.data;
      }
      for (let frame = 0; frame < 4; frame++) {
        const tile = handDrawn.has(kind)
          ? await paintedWalkCell(handDrawn.get(kind), direction, frame)
          : await sharp(walkWarp(standing, CELL, CELL, direction, frame), {
            raw: { width: CELL, height: CELL, channels: 4 },
          }).resize(WALK_CELL - 4, WALK_CELL - 4).png().toBuffer();
        cells.push({ input: tile, left: frame * WALK_CELL + 2,
          top: (local * 4 + direction) * WALK_CELL + 2 });
      }
    }
  }
  await sharp({ create: { width: 4 * WALK_CELL, height: count * 4 * WALK_CELL,
    channels: 4, background: '#00000000' } }).composite(cells).png({ compressionLevel: 9 })
    .toFile(`public/art/city/illustrated-people-walk-${page + 1}.png`);
}
await sharp(join(source, 'action-effects.svg')).png({ compressionLevel: 9 })
  .toFile('public/art/city/illustrated-action-effects.png');
console.log(`Illustrated people: ${[...counts.values()].reduce((a, b) => a + b, 0)} painted portraits, ${SHEETS * 4} directional sprite rows, ${SHEETS * 4} walk cycles (3 hand-painted)`);
