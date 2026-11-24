/**
 * The bundled comp list (tiers, minions, objective and tips) and matching of community comp
 * stats onto it. No Node or Electron imports (also used by the browser demo).
 */
import type { CompGuide, CompGuidesBundle, Tribe } from '@shared/types';
import bundledComps from '../cards/data/comps.json';

interface BundledComp {
  id: string;
  name: string;
  tribe?: string;
  tier?: string;
  difficulty?: string;
  objective?: string;
  core: string[];
  addon?: string[];
  tip?: string;
  whenToCommit?: string;
  enabler?: string[];
}

/** The bundled comp list (tiers, minions and tips we maintain). */
export function bundledCompGuides(): CompGuidesBundle {
  const b = bundledComps as { source: string; updatedAt: string; comps: BundledComp[] };
  const comps = b.comps.map((c): CompGuide => {
    const g: CompGuide = {
      id: c.id,
      name: c.name,
      cards: [...c.core.map((cardId) => ({ cardId, role: 'core' as const })), ...(c.addon ?? []).map((cardId) => ({ cardId, role: 'addon' as const }))],
    };
    if (c.tribe) g.tribe = c.tribe as Tribe;
    if (c.tier) g.tier = c.tier;
    if (c.difficulty) g.difficulty = c.difficulty;
    if (c.objective) g.objective = c.objective;
    if (c.tip) g.tip = c.tip;
    if (c.whenToCommit) g.whenToCommit = c.whenToCommit;
    if (c.enabler?.length) g.enablers = c.enabler;
    return g;
  });
  return { source: b.source, updatedAt: b.updatedAt, comps };
}

/**
 * Copies community stats onto our comps. A Firestone comp matches one of ours when it has the
 * same tribe and contains at least half of our core minions (2 or more, one of them specific
 * to the comp rather than a shared support card); each Firestone comp
 * goes to at most one of ours, best overlap first. Unmatched comps show no placement rather
 * than a misleading one.
 */
/** Economy / support cards many comps share (Brann, Rogers, Privateer, Balinda, Kelp Keeper, Escapee): not evidence of a match. */
const SHARED_SUPPORT = new Set(["BG_LOE_077", "BG33_823", "BG33_825", "BG35_883", "BG36_701", "BG36_523"]);

export function attachMatchedStats(comps: CompGuide[], community: CompGuide[]): void {
  const pairs: { c: CompGuide; f: CompGuide; specific: number; shared: number; all: number }[] = [];
  for (const c of comps) {
    const core = c.cards.filter((x) => x.role === 'core').map((x) => x.cardId);
    const mine = new Set(c.cards.map((x) => x.cardId));
    for (const f of community) {
      if (f.games === undefined || (f.tribe ?? '') !== (c.tribe ?? '')) continue;
      const theirs = new Set(f.cards.map((x) => x.cardId));
      const shared = core.filter((id) => theirs.has(id)).length;
      const specific = core.filter((id) => theirs.has(id) && !SHARED_SUPPORT.has(id)).length;
      if (shared < 2 || shared * 2 < core.length || specific < 1) continue;
      pairs.push({ c, f, specific, shared, all: f.cards.filter((x) => mine.has(x.cardId)).length });
    }
  }
  pairs.sort((x, y) => y.specific - x.specific || y.shared - x.shared || y.all - x.all);
  const usedC = new Set<CompGuide>();
  const usedF = new Set<CompGuide>();
  for (const { c, f } of pairs) {
    if (usedC.has(c) || usedF.has(f)) continue;
    usedC.add(c);
    usedF.add(f);
    c.avgPlacement = f.avgPlacement;
    c.games = f.games;
    c.firstRate = f.firstRate;
    c.top4Rate = f.top4Rate;
  }
}

