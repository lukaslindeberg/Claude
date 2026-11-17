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
  // The lobby's tribes ticked on the picker: heroes re-ranked for this lobby.
  ['overlay-hero-selection-lobby', '/overlay.html?scene=heroSelection', overlay, async (p) => {
    for (const i of [0, 1, 5, 7, 10]) await p.locator('.tl-tpick__btn').nth(i).click();
  }],
  ['overlay-trinket-pick', '/overlay.html?scene=trinketPick', overlay],
  ['overlay-recruit', '/overlay.html?scene=recruit', overlay],
  // Counter chips on the lobby plaque (Blood Gems, Beetles, overdrawn gold, free refreshes).
  ['overlay-counters', '/overlay.html?scene=recruit&counters=all', overlay, async (p) => {
    await p.hover('.tl-counter.is-gem');
  }, 600],
  ['overlay-recruit-1440p', '/overlay.html?scene=recruit', { width: 2560, height: 1440 }],
  ['overlay-opponent-hover', '/overlay.html?scene=recruit', overlay, async (p) => {
    await p.hover('.tl-opp__row:nth-child(3) .tl-opp__board');
  }, 1500],
  ['overlay-opponent-expanded', '/overlay.html?scene=recruit', overlay, async (p) => {
    await p.locator('.tl-opp__row').nth(2).click();
    await p.mouse.move(900, 500);
  }],
  ['overlay-images-off', '/overlay.html?scene=recruit&images=0', overlay, async (p) => {
    await p.hover('.tl-opp__row:nth-child(3) .tl-opp__board');
  }, 1200],
  ['overlay-combat', '/overlay.html?scene=combat&sim=ok&actualDelay=1500', overlay, null, 2500],
  ['overlay-combat-unreliable', '/overlay.html?scene=combat&sim=unreliable&actual=0', overlay, async (p) => {
    await p.hover('.tl-sim__warn');
  }, 800],
  ['overlay-game-over', '/overlay.html?scene=gameOver', overlay],
  // Duos: the leaderboard grouped by team (shared health, team place, both boards); the
  // panel starts collapsed in Duos, so expand it and hover the next opposing team.
  ['overlay-duos', '/overlay.html?scene=recruit&mode=duos', overlay, async (p) => {
    if (await p.locator('.tl-opp.is-collapsed').count()) await p.click('.tl-opp__toggle');
    await p.hover('.tl-opp__team.is-next .tl-opp__main');
  }, 1500],
  ['overlay-duos-combat', '/overlay.html?scene=combat&mode=duos&sim=ok&actualDelay=1500', overlay, null, 2500],
  ['overlay-replay', '/overlay.html?scene=replay&speed=400&until=combat@6', overlay, null, 14000],
  ['companion-overview', '/settings.html?scene=recruit#overview', companion],
  ['companion-matches', '/settings.html?scene=recruit#matches', companion],
  ['companion-match-detail', '/settings.html?scene=recruit#matches', companion, async (p) => {
    await p.locator('.tl-hist__row').first().click();
  }],
  ['companion-stats', '/settings.html?scene=recruit#stats', companion],
  ['companion-heroes', '/settings.html?scene=recruit#heroes', companion],
  ['companion-trinkets', '/settings.html?scene=recruit#trinkets', companion],
  ['companion-settings', '/settings.html?scene=recruit#settings', companion],
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
  await page.waitForSelector('.tl-overlay-root, .tl-app');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  if (action) {
    await action(page);
    await page.waitForTimeout(500);
  }
  if (wait) await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${name}.jpg`), type: "jpeg", quality: 82 });
  if (errors.length) {
    failures++;
    console.log(`✗ ${name}\n  ${errors.join('\n  ')}`);
  } else console.log(`✓ ${name}`);
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
