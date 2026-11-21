/**
 * Builds src/core/cards/data/bg-cards.json from HearthSim hsdata.
 *
 *   npm run cards                       # download latest CardDefs.Bacon.xml + RaceTagMap.xml
 *   npm run cards -- --src ./hsdata     # use local copies
 *   npm run cards -- --patch 37.0.2     # record the patch label
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertHsData, HSDATA_BACON_URL, HSDATA_RACETAGMAP_URL } from '../src/core/cards/hsdataConverter.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function load(file: string, url: string): Promise<string> {
  const src = arg('src');
  if (src) {
    const p = join(src, file);
    if (!existsSync(p)) throw new Error(`missing ${p}`);
    return readFileSync(p, 'utf8');
  }
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const bacon = await load('CardDefs.Bacon.xml', HSDATA_BACON_URL);
const raceMap = await load('RaceTagMap.xml', HSDATA_RACETAGMAP_URL);
const data = convertHsData(bacon, raceMap, { patch: arg('patch') });
const out = join(root, 'src/core/cards/data/bg-cards.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data));
const pool = data.cards.filter((c) => c.pool && c.type === 'MINION' && !c.golden).length;
const heroes = data.cards.filter((c) => c.type === 'HERO' && c.mechanics.includes('BACON_HERO_CAN_BE_DRAFTED')).length;
console.log(`build ${data.build}: ${data.cards.length} cards, ${pool} pool minions, ${heroes} draftable heroes -> ${out}`);
