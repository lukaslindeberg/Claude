/**
 * Regenerates the screenshots in docs/screenshots from the browser demo.
 *
 *   npx vite --config vite.demo.config.ts      # in another terminal (port 5199)
 *   node docs/screenshots/capture.mjs [baseUrl] [filter]
 *
 * Requires Playwright with a Chromium build (`npx playwright install chromium`).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.argv[2] ?? 'http://127.0.0.1:5199';
const filter = process.argv[3];
const outDir = dirname(fileURLToPath(import.meta.url));

const overlay = { width: 1920, height: 1080 };
const companion = { width: 1280, height: 800 };

/** name, url, viewport, optional page action, wait ms */
const shots = [
  ['overlay-hero-selection', '/overlay.html?scene=heroSelection', overlay],
  ['overlay-recruit', '/overlay.html?scene=recruit', overlay],
  ['overlay-leaderboard-hover', '/overlay.html?scene=recruit&hover=0', overlay],
  ['overlay-tier-list', '/overlay.html?scene=recruit&tierList=4', overlay],
  ['overlay-opponent-expanded', '/overlay.html?scene=recruit', overlay, async (p) => {
    await p.locator('.tl-opp__row').nth(2).click();
  }],
  ['overlay-combat-simulating', '/overlay.html?scene=combat&actual=0', overlay, null, 2500],
  ['overlay-combat-result', '/overlay.html?scene=combat&actualDelay=1500', overlay, null, 3500],
  ['overlay-game-over', '/overlay.html?scene=gameOver', overlay],
  ['overlay-calibration', '/overlay.html?scene=recruit&calibrate=1', overlay],
  ['overlay-recruit-1440p', '/overlay.html?scene=recruit&hover=2', { width: 2560, height: 1440 }],
  ['overlay-replay', '/overlay.html?scene=replay&speed=400&until=combat@6', overlay, null, 14000],
  ['companion-overview', '/settings.html?scene=recruit#overview', companion],
  ['companion-history', '/settings.html?scene=recruit#history', companion],
  ['companion-history-detail', '/settings.html?scene=recruit#history', companion, async (p) => {
    await p.locator('.tl-hist__row').first().click();
  }],
  ['companion-stats', '/settings.html?scene=recruit#stats', companion],
  ['companion-heroes', '/settings.html?scene=recruit#heroes', companion],
  ['companion-minions', '/settings.html?scene=recruit#minions', companion],
  ['companion-settings', '/settings.html?scene=recruit#settings', companion],
  ['companion-about', '/settings.html?scene=recruit#about', companion],
];

const browser = await chromium.launch();
let failures = 0;
for (const [name, path, viewport, action, wait] of shots) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/art\.hearthstonejson|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  if (action) {
    await action(page);
    await page.waitForTimeout(500);
  }
  if (wait) await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  if (errors.length) {
    failures++;
    console.log(`✗ ${name}\n  ${errors.join('\n  ')}`);
  } else console.log(`✓ ${name}`);
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
