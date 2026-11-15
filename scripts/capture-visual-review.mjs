/** Deterministic capture of the throwaway street-corner art review page.
 * Usage: node scripts/capture-visual-review.mjs [/tmp/street-corner.png] [game-minute] [--hybrid] [--close] [--texture=URL]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = resolve(process.argv[2] ?? '/tmp/rts-street-corner.png');
const minute = Number(process.argv[3] ?? 1.35);
const flags = process.argv.slice(4);
const params = new URLSearchParams();
if (flags.includes('--hybrid')) params.set('people', 'painted3d');
if (flags.includes('--wardrobe')) params.set('people', 'wardrobe3d');
if (flags.includes('--close')) params.set('close', '1');
const textureFlag = flags.find(flag => flag.startsWith('--texture='));
if (textureFlag) params.set('texture', textureFlag.slice('--texture='.length));
const corpseFlag = flags.find(flag => flag.startsWith('--corpse='));
if (corpseFlag) params.set('corpse', corpseFlag.slice('--corpse='.length));
if (!Number.isFinite(minute) || minute < 0 || minute > 4) throw Error('Frame must be between 0 and 4 game minutes.');
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5189, strictPort: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 5189;
  const executablePath = process.env.CHROME_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/visual-review.html?${params}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__visualReview?.ready === true, undefined, { timeout: 120000 });
  await page.evaluate(time => window.__visualReview.seek(time), minute);
  await page.screenshot({ path: output });
  const review = await page.evaluate(() => ({ building: window.__visualReview.building,
    cast: window.__visualReview.cast, stats: window.__visualReview.stats() }));
  if (errors.length) throw Error(`Review page errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ screenshot: output, minute, ...review }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
