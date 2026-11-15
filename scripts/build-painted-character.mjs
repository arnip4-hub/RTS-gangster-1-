/** Shared painted albedos: no extra texture is needed per civilian identity. */
import sharp from 'sharp';

for (const style of ['fedora', 'woman', 'worker', 'police', 'fbi']) {
  await sharp(`art-source/illustrated/characters/${style}-painted.webp`)
    .resize(1024, 1024, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(`public/art/city/illustrated-${style}-albedo.jpg`);
}

console.log('Painted characters: five shared 1024 × 1024 albedos');
