/** Capture the game's real 3D vehicle paint materials.
 * Usage: node scripts/capture-vehicle-review.mjs [/tmp/vehicles.png] [--page=all|coupe|truck|speedster] [--source]
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = resolve(process.argv[2] ?? '/tmp/vehicles.png');
const flags = process.argv.slice(3);
const pageName = flags.find(flag => flag.startsWith('--page='))?.slice('--page='.length) ?? 'all';
if (!['all', 'coupe', 'truck', 'speedster'].includes(pageName)) throw Error('Invalid vehicle gallery page.');
const params = new URLSearchParams({ page: pageName });
if (flags.includes('--source')) params.set('painted', '0');
const viewport = pageName === 'all' ? { width: 2400, height: 1600 } : { width: 1800, height: 1200 };
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5193, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 5193;
  const executablePath = process.env.CHROME_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => { errors.push(String(error)); process.stderr.write(`Page error: ${error}\n`); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); process.stderr.write(`${message.text()}\n`); } });
  await page.goto(`http://127.0.0.1:${port}/vehicle-review.html?${params}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__vehicleReview?.ready === true, undefined, { timeout: 180000 });
  await page.evaluate(() => window.__vehicleReview.render());
  await page.screenshot({ path: output });
  const stats = await page.evaluate(() => window.__vehicleReview.stats());
  const pickPoints = flags.filter(flag => flag.startsWith('--pick='))
    .map(flag => flag.slice('--pick='.length).split(',').map(Number));
  const picks = await page.evaluate(points => points.map(([x, y]) => ({ x, y, hits: window.__vehicleReview.pick(x, y) })), pickPoints);
  if (errors.length) throw Error(`Vehicle review errors:\n${errors.join('\n')}`);
  const expected = pageName === 'all' ? 36 : 12;
  if (stats.entries !== expected || stats.paints !== 12) throw Error('Vehicle paint gallery did not cover every livery.');
  for (const part of stats.parts) if (part.instanceCounts.some(count => count !== 12)) throw Error(`Missing instances for ${part.kind}.`);
  for (const part of stats.parts) if (part.paintedVertices.reduce((a, b) => a + b, 0) === 0 ||
    part.protectedVertices.reduce((a, b) => a + b, 0) === 0)
    throw Error(`Vehicle ${part.kind} lacks separate coachwork and protected detail vertices.`);
  console.log(JSON.stringify({ screenshot: output, ...stats, ...(picks.length ? { picks } : {}) }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
