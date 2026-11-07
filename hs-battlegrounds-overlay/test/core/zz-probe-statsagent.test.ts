import { it } from 'vitest';
import { BgTracker } from '../../src/core/bg';
import { fixtureLines } from './helpers';

for (const f of ['bg_duos_trinkets_206605.power.log.gz', 'bg_duos_aberrations_deity_2026.power.log.gz', 'bg_quests_150659.power.log.gz', 'bg_139963_perfect_game.power.log.gz']) {
  it(f, () => {
    const t = new BgTracker({ now: () => 1 });
    let last = '';
    const out: string[] = [];
    let rec: unknown;
    for (const line of fixtureLines(f)) {
      for (const e of t.feedLine(line)) if (e.type === 'gameEnd') rec = e.record;
      const st = t.getState();
      const key = JSON.stringify(st.trinketOptions ?? null);
      if (key !== last) {
        out.push(`turn=${st.turn} phase=${st.phase} opts=${key}`);
        last = key;
      }
    }
    for (const e of t.flush()) if (e.type === 'gameEnd') rec = e.record;
    const r = (rec ?? t.getMatchRecord()) as { trinkets?: string[]; questRewards?: string[]; placement: number; availableTribes: string[] };
    const loc = t.getState().players.find((p) => p.isLocal);
    console.log(f, '\n' + out.join('\n'), '\nrecord', JSON.stringify({ trinkets: r?.trinkets, questRewards: r?.questRewards, placement: r?.placement, tribes: r?.availableTribes }), 'localState', loc?.trinkets, loc?.questRewards);
  });
}
