/** Shared painterly materials for the illustrated street-corner review. */
import sharp from 'sharp';

const source = 'art-source/illustrated/corner';
const target = 'public/art/city';
const jobs = [
  ['red-brick', 'illustrated-facade-red-brick.jpg', 512, 512],
  ['brown-brick', 'illustrated-facade-brown-brick.jpg', 512, 512],
  ['buff-brick', 'illustrated-facade-buff-brick.jpg', 512, 512],
  ['limestone', 'illustrated-facade-limestone.jpg', 512, 512],
  ['stucco', 'illustrated-facade-stucco.jpg', 512, 512],
  ['storefront', 'illustrated-storefront.jpg', 1024, 512],
  ['asphalt', 'illustrated-road-asphalt.jpg', 512, 512],
  ['pavement', 'illustrated-pavement.jpg', 512, 512],
];

for (const [name, output, width, height] of jobs) {
  await sharp(`${source}/${name}.webp`)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(`${target}/${output}`);
}
console.log(`Illustrated corner: ${jobs.length} shared city materials`);
