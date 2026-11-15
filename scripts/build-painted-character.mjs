/** Rebuild the small albedo used by the illustrated 3D character proof.
 * Geometry, UVs, bones and motion remain in the existing fedora GLB. */
import sharp from 'sharp';

await sharp('art-source/illustrated/characters/fedora-painted.webp')
  .resize(1024, 1024, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .jpeg({ quality: 90, mozjpeg: true })
  .toFile('public/art/city/illustrated-fedora-albedo.jpg');

console.log('Painted character proof: 1024 × 1024 fedora albedo');
