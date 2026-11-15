/** Capture the actual shared 3D wardrobe layer, with coverage diagnostics.
 * Usage: node scripts/capture-wardrobe-review.mjs [/tmp/wardrobe.png] [--page=men|women|uniforms|all|bodies|skins] [--phase=.25]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const flags = process.argv.slice(3);
const output = resolve(process.argv[2] ?? '/tmp/wardrobe.png');
const argument = (key, fallback) => flags.find(flag => flag.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const pageName = argument('page', 'men');
const phase = Number(argument('phase', '.25'));
if (!['men', 'women', 'uniforms', 'all', 'bodies', 'skins'].includes(pageName)) throw Error('Invalid wardrobe gallery page.');
if (!Number.isFinite(phase) || phase < 0 || phase > 1) throw Error('Walk phase must be between 0 and 1.');
const viewport = pageName === 'all' ? { width: 2400, height: 1600 }
  : ['uniforms', 'bodies'].includes(pageName) ? { width: 1600, height: 1050 }
  : pageName === 'skins' ? { width: 1700, height: 1050 } : { width: 1600, height: 1700 };
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5191, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 5191;
  const executablePath = process.env.CHROME_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('requestfailed', request => process.stderr.write(`Request failed: ${request.url()} ${request.failure()?.errorText}\n`));
  page.on('response', response => { if (response.status() >= 400) process.stderr.write(`HTTP ${response.status()}: ${response.url()}\n`); });
  page.on('pageerror', error => { errors.push(String(error)); process.stderr.write(`Page error: ${error}\n`); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); process.stderr.write(`${message.text()}\n`); } });
  await page.goto(`http://127.0.0.1:${port}/wardrobe-review.html?page=${pageName}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wardrobeReview?.ready === true, undefined, { timeout: 180000 });
  await page.evaluate(value => window.__wardrobeReview.seek(value), phase);
  await page.screenshot({ path: output });
  const stats = await page.evaluate(() => window.__wardrobeReview.stats());
  if (errors.length) throw Error(`Wardrobe review errors:\n${errors.join('\n')}`);
  if (stats.characters !== stats.activeRigs || stats.skinnedMeshes < stats.characters)
    throw Error('Wardrobe review did not render every entry as an animated skinned model.');
  const expected = { men: 25, women: 25, uniforms: 8, all: 58, bodies: 8, skins: 10 }[pageName];
  if (stats.characters !== expected) throw Error(`Expected ${expected} gallery entries, received ${stats.characters}.`);
  if (['men', 'women', 'uniforms', 'all'].includes(pageName) && new Set(stats.outfitIds).size !== expected)
    throw Error('Wardrobe review repeated an outfit instead of covering the requested catalog.');
  if (pageName === 'bodies' && stats.bodyIds.length !== 8) throw Error('Body gallery did not cover all eight builds.');
  if (pageName === 'skins' && stats.skinIndices.length !== 10) throw Error('Skin gallery did not cover all ten shades.');
  console.log(JSON.stringify({ screenshot: output, ...stats }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
