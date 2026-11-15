/** Shared UV sheets for all painted vehicle instances. */
import sharp from 'sharp';

for (const kind of ['coupe', 'truck', 'speedster']) {
  await sharp(`art-source/illustrated/vehicles/${kind}-painted.webp`)
    .resize(1024, 1024, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(`public/art/city/illustrated-${kind}-albedo.jpg`);
}
console.log('Painted vehicles: three shared 1024 × 1024 albedos');
