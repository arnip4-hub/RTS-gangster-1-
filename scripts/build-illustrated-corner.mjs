/** Shared painterly materials for the illustrated street-corner review. */
import sharp from 'sharp';
import { existsSync } from 'fs';

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
  let img = sharp(path);
  // Clean bottom-right corner for new stems
  if (name.includes('-') && kind !== 'other') {
    const meta = await sharp(path).metadata();
    const cw = Math.floor(meta.width * 0.06), ch = Math.floor(meta.height * 0.08);
    const patch = await sharp(path).extract({ left: 0, top: meta.height - ch, width: cw, height: ch }).flop().toBuffer();
    img = sharp(path).composite([{ input: patch, left: meta.width - cw, top: meta.height - ch }]);
  }
  await img.resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(`${target}/${output}`);

  // Generate lit mask
  if (kind === 'facade' || kind === 'storefront') {
    const litW = kind === 'storefront' ? 1024 : 512;
    const litH = kind === 'storefront' ? 512 : 512;
    const litName = output.replace('.jpg', '-lit.png').replace('illustrated-facade-', 'facade-').replace('illustrated-storefront', 'storefront');
    // Simple deterministic window glow: sample the resized image, lighten bright-ish regions
    const { data, info } = await sharp(`${target}/${output}`).resize(litW, litH).raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < info.width * info.height; i++) {
      const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
      const lum = r * 0.3 + g * 0.5 + b * 0.2;
      // Window-like: mid-bright, not pure white masonry
      const isWindow = lum > 40 && lum < 180 && Math.abs(r - b) < 40;
      out[i * 4] = isWindow ? 0xff : 0;
      out[i * 4 + 1] = isWindow ? 0xd7 : 0;
      out[i * 4 + 2] = isWindow ? 0x96 : 0;
      out[i * 4 + 3] = isWindow ? 180 : 0;
    }
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png().toFile(`${target}/${litName}`);
  }
}
console.log(`Illustrated corner: ${jobs.length - missing.length} materials built`);
if (missing.length) console.log(`Skipped (absent): ${missing.join(', ')}`);
