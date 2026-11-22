/**
 * Derive native Windows installer branding from the project's existing city key art.
 * Builds .ico (including 16px to 256px PNG entries) and 24-bit BMP NSIS artwork.
 * Sharp is already a dev dependency. No binary assets are checked into Git.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public', 'art', 'brand', 'key-art-city.jpg');
const output = path.join(root, 'build', 'windows');

const svg = (width, height, contents) => Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
  '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
  contents + '</svg>',
);

async function artImage(width, height, artwork) {
  const background = await sharp(source)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .png().toBuffer();
  return sharp(background).composite([{ input: svg(width, height, artwork) }]).png().toBuffer();
}

// A single source of iconography for the executable, shortcuts and installers.
const iconArtwork = [
  '<defs><linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#10151d" stop-opacity=".48"/>',
  '<stop offset="1" stop-color="#10151d" stop-opacity=".91"/></linearGradient></defs>',
  '<rect width="256" height="256" fill="url(#veil)"/>',
  '<rect x="7" y="7" width="242" height="242" rx="17" fill="none" stroke="#c9a16b" stroke-width="6"/>',
  '<path d="M30 185 H226" stroke="#c9a16b" stroke-width="3"/>',
  '<text x="128" y="160" font-family="Arial, sans-serif" font-weight="900" font-size="100" ',
  'text-anchor="middle" fill="#f4ebd9" stroke="#21180f" stroke-width="4" paint-order="stroke">RTS</text>',
  '<text x="128" y="215" font-family="Arial, sans-serif" font-weight="bold" font-size="20" ',
  'letter-spacing="2" text-anchor="middle" fill="#f4ebd9">GANGSTER 1</text>',
].join('');

const sidebarArtwork = [
  '<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="#10151d" stop-opacity=".20"/>',
  '<stop offset=".46" stop-color="#10151d" stop-opacity=".38"/>',
  '<stop offset="1" stop-color="#10151d" stop-opacity=".96"/></linearGradient></defs>',
  '<rect width="164" height="314" fill="url(#shade)"/>',
  '<path d="M13 228 H151" stroke="#c9a16b" stroke-width="2"/>',
  '<text x="13" y="261" font-family="Arial, sans-serif" font-size="38" font-weight="900" ',
  'fill="#f4ebd9" stroke="#21180f" stroke-width="2" paint-order="stroke">RTS</text>',
  '<text x="13" y="282" font-family="Arial, sans-serif" font-size="16" font-weight="bold" ',
  'letter-spacing=".7" fill="#e8c999">GANGSTER 1</text>',
  '<text x="13" y="301" font-family="Arial, sans-serif" font-size="10" ',
  'letter-spacing="2" fill="#f4ebd9">THE CITY IS YOURS</text>',
].join('');

const headerArtwork = [
  '<rect width="150" height="57" fill="#111922" fill-opacity=".67"/>',
  '<path d="M7 8 V49" stroke="#c9a16b" stroke-width="3"/>',
  '<text x="17" y="32" font-family="Arial, sans-serif" font-size="25" font-weight="900" ',
  'fill="#f4ebd9" stroke="#21180f" stroke-width=".6" paint-order="stroke">RTS</text>',
  '<text x="18" y="47" font-family="Arial, sans-serif" font-size="10" font-weight="bold" ',
  'letter-spacing=".6" fill="#e8c999">GANGSTER 1</text>',
].join('');

function multiResolutionIco(pngImages) {
  const count = pngImages.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(count, 4);
  let dataOffset = header.length;
  for (let i = 0; i < count; i++) {
    const { size, bytes } = pngImages[i];
    const row = 6 + i * 16;
    header.writeUInt8(size === 256 ? 0 : size, row);
    header.writeUInt8(size === 256 ? 0 : size, row + 1);
    header.writeUInt8(0, row + 2); // palette
    header.writeUInt8(0, row + 3);
    header.writeUInt16LE(1, row + 4);
    header.writeUInt16LE(32, row + 6);
    header.writeUInt32LE(bytes.length, row + 8);
    header.writeUInt32LE(dataOffset, row + 12);
    dataOffset += bytes.length;
  }
  return Buffer.concat([header, ...pngImages.map(({ bytes }) => bytes)]);
}

async function rgbBitmap(pngImage, width, height) {
  const { data, info } = await sharp(pngImage).resize(width, height)
    .flatten({ background: '#111922' }).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('Expected RGB pixel data');
  const rowStride = (width * 3 + 3) & ~3;
  const pixelBytes = rowStride * height;
  const bmp = Buffer.alloc(54 + pixelBytes);
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22); // bottom-up
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(pixelBytes, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dst = 54 + (height - 1 - y) * rowStride + x * 3;
      bmp[dst] = data[src + 2];
      bmp[dst + 1] = data[src + 1];
      bmp[dst + 2] = data[src];
    }
  }
  return bmp;
}

await mkdir(output, { recursive: true });
const iconPng = await artImage(256, 256, iconArtwork);
const iconSizes = [16, 24, 32, 48, 64, 128, 256];
const iconImages = await Promise.all(iconSizes.map(async size => ({
  size,
  bytes: await sharp(iconPng).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer(),
})));
const ico = multiResolutionIco(iconImages);
const sidebarPng = await artImage(164, 314, sidebarArtwork);
const headerPng = await artImage(150, 57, headerArtwork);
const sidebar = await rgbBitmap(sidebarPng, 164, 314);
const header = await rgbBitmap(headerPng, 150, 57);

const files = [
  ['rts-gangster.ico', ico],
  ['installerSidebar.bmp', sidebar],
  ['uninstallerSidebar.bmp', sidebar],
  ['installerHeader.bmp', header],
];
for (const [filename, data] of files) await writeFile(path.join(output, filename), data);
const check = await readFile(path.join(output, 'rts-gangster.ico'));
if (check.readUInt16LE(2) !== 1 || check.readUInt16LE(4) !== iconSizes.length)
  throw new Error('Malformed Windows icon');
if (sidebar.readUInt16LE(28) !== 24 || header.readUInt16LE(28) !== 24)
  throw new Error('NSIS BMP artwork must be 24-bit');
console.log('RTS Gangster 1 Windows branding generated from public/art/brand/key-art-city.jpg');
console.log('Icon resolutions: ' + iconSizes.join(', ') + ' px; NSIS sidebar 164x314; header 150x57');
