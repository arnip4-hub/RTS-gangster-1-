/** Shared painterly materials for the illustrated street-corner review. */
import sharp from 'sharp';
import { existsSync, copyFileSync } from 'node:fs';
import { buildLightMask } from './city-light-mask.mjs';

const source = 'art-source/illustrated/corner';
const target = 'public/art/city';
const exts = ['.webp', '.jpg', '.jpeg', '.png'];

function findStem(name) {
  for (const ext of exts) {
    const path = `${source}/${name}${ext}`;
    if (existsSync(path)) return path;
  }
  return null;
}

const jobs = [
  ['red-brick', 'illustrated-facade-red-brick.jpg', 512, 512, 'facade'],
  ['brown-brick', 'illustrated-facade-brown-brick.jpg', 512, 512, 'facade'],
  ['buff-brick', 'illustrated-facade-buff-brick.jpg', 512, 512, 'facade'],
  ['limestone', 'illustrated-facade-limestone.jpg', 512, 512, 'facade'],
  ['stucco', 'illustrated-facade-stucco.jpg', 512, 512, 'facade'],
  ['dark-granite', 'illustrated-facade-dark-granite.jpg', 512, 512, 'facade'],
  ['terracotta-deco', 'illustrated-facade-terracotta-deco.jpg', 512, 512, 'facade'],
  ['sooted-brick', 'illustrated-facade-sooted-brick.jpg', 512, 512, 'facade'],
  ['painted-clapboard', 'illustrated-facade-painted-clapboard.jpg', 512, 512, 'facade'],
  ['glazed-brick', 'illustrated-facade-glazed-brick.jpg', 512, 512, 'facade'],
  ['cast-iron', 'illustrated-facade-cast-iron.jpg', 512, 512, 'facade'],
  ['storefront', 'illustrated-storefront.jpg', 1024, 512, 'storefront'],
  ['storefront-market', 'illustrated-storefront-market.jpg', 1024, 512, 'storefront'],
  ['storefront-deco', 'illustrated-storefront-deco.jpg', 1024, 512, 'storefront'],
  ['storefront-cafe', 'illustrated-storefront-cafe.jpg', 1024, 512, 'storefront'],
  ['storefront-nightlife', 'illustrated-storefront-nightlife.jpg', 1024, 512, 'storefront'],
  ['storefront-financial', 'illustrated-storefront-financial.jpg', 1024, 512, 'storefront'],
  ['storefront-service', 'illustrated-storefront-service.jpg', 1024, 512, 'storefront'],
  ['storefront-pawnshop', 'illustrated-storefront-pawnshop.jpg', 1024, 512, 'storefront'],
  ['storefront-apothecary', 'illustrated-storefront-apothecary.jpg', 1024, 512, 'storefront'],
  ['storefront-boutique', 'illustrated-storefront-boutique.jpg', 1024, 512, 'storefront'],
  ['storefront-poolhall', 'illustrated-storefront-poolhall.jpg', 1024, 512, 'storefront'],
  ['storefront-firehouse', 'illustrated-storefront-firehouse.jpg', 1024, 512, 'storefront'],
  ['storefront-hotel', 'illustrated-storefront-hotel.jpg', 1024, 512, 'storefront'],
  ['asphalt', 'illustrated-road-asphalt.jpg', 512, 512, 'other'],
  ['pavement', 'illustrated-pavement.jpg', 512, 512, 'other'],
];

const missing = [];
for (const [name, output, width, height, kind] of jobs) {
  const path = findStem(name);
  if (!path) { missing.push(name); continue; }
  // Resize first: sharp composites after resize, so source-resolution
  // offsets would otherwise fall outside the delivered texture.
  const litName = output.replace('.jpg', '-lit.png').replace('illustrated-facade-', 'facade-').replace('illustrated-storefront', 'storefront');
  const authored = `${source}/authored-lights/${litName}`;
  // Preserve the exact delivered albedo paired with an authored mask.
  if (!existsSync(authored) || !existsSync(`${target}/${output}`)) {
    const resized = await sharp(path).resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toBuffer();
    let img = sharp(resized);
    if (name.includes('-') && kind !== 'other' && !existsSync(authored)) {
      const cw = Math.floor(width * 0.06), ch = Math.floor(height * 0.08);
      const patch = await sharp(resized).extract({ left: 0, top: height - ch, width: cw, height: ch }).flop().toBuffer();
      img = sharp(resized).composite([{ input: patch, left: width - cw, top: height - ch }]);
    }
    await img.jpeg({ quality: 88, mozjpeg: true }).toFile(`${target}/${output}`);
  }

  // Generate lit mask
  if (kind === 'facade' || kind === 'storefront') {
    const litW = kind === 'storefront' ? 1024 : 512;
    const litH = kind === 'storefront' ? 512 : 512;
    if (existsSync(authored)) {
      // These masks were painted against the original artwork. Keep their
      // exact bytes and resolution rather than replacing them with a heuristic.
      copyFileSync(authored, `${target}/${litName}`);
      continue;
    }
    const { data } = await sharp(`${target}/${output}`).resize(litW, litH)
      .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = buildLightMask(data, litW, litH, kind, name);
    await sharp(out, { raw: { width: litW, height: litH, channels: 3 } })
      .png().toFile(`${target}/${litName}`);
  }
}
console.log(`Illustrated corner: ${jobs.length - missing.length} materials built`);
if (missing.length) console.log(`Skipped (absent): ${missing.join(', ')}`);
