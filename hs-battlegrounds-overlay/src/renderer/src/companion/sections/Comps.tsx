import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { CompGuide, CompGuidesBundle, Tribe } from '@shared/types';
import { useApp } from '../../store/appStore';
import { HeroTierBadge, TribeEmblem } from '../../components/Bits';
import { MinionToken } from '../../components/MinionToken';
import { num, pct } from '../../lib/format';
import { tribeLabel } from '../../lib/tribes';
import { useLobbyTribes } from '../../lib/synergy';
import { Card, Empty, SectionHeader, Segmented } from '../ui';
import { TribeFilter } from '../TribeFilter';

type SortKey = 'tier' | 'avg';

/**
 * Comp guides: the strong boards this patch with their key minions, a short tip and when
 * to commit (Firestone community guides), ranked by power level or by average placement.
 */
export function Comps() {
  const bridge = useApp((s) => s.bridge);
  const communityOn = useApp((s) => s.settings.communityStats);
  const live = useLobbyTribes();
  const [bundle, setBundle] = useState<CompGuidesBundle | undefined | null>(null);
  const [tribes, setTribes] = useState<Tribe[]>(() => live.tribes);
  const [sort, setSort] = useState<SortKey>('tier');

  useEffect(() => {
    let alive = true;
    setBundle(null);
    void bridge
      ?.getCompGuides?.()
      .then((b) => alive && setBundle(b))
      .catch(() => alive && setBundle(undefined));
    return () => {
      alive = false;
    };
  }, [bridge, communityOn]);

  const comps = useMemo(() => {
    const all = bundle?.comps ?? [];
    const shown = tribes.length ? all.filter((c) => !c.tribe || tribes.includes(c.tribe)) : all;
    if (sort === 'avg') return [...shown].sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
    return shown;
  }, [bundle, tribes, sort]);

  return (
    <div className="tl-section">
      <SectionHeader
        title="Comps"
        subtitle="The strong boards this patch: key minions, how to play them and when to commit."
        actions={
          <Segmented<SortKey>
            value={sort}
            onChange={setSort}
            options={[
              { value: 'tier', label: 'By tier' },
              { value: 'avg', label: 'By placement' },
            ]}
          />
        }
      />
      <TribeFilter value={tribes} onChange={setTribes} />
      {bundle === null ? (
        <Empty title="Loading comps…" />
      ) : !communityOn ? (
        <Empty title="Comp guides need community stats">Turn on Settings → Behaviour → Community hero stats.</Empty>
      ) : !bundle?.comps.length ? (
        <Empty title="No comp guides available">They are downloaded from Firestone's public data; check your connection.</Empty>
      ) : !comps.length ? (
        <Empty title="No comps for these tribes" />
      ) : (
        <div className="tl-comps">
          {comps.map((c) => (
            <CompCard key={c.id} comp={c} />
          ))}
        </div>
      )}
      {bundle?.comps.length ? (
        <p className="tl-muted tl-small tl-comps__credit">
          Guides and tiers: Firestone community (authors named on each tip). Placement: Firestone comp statistics, last patch, all ranks.
        </p>
      ) : null}
    </div>
  );
}

function CompCard({ comp }: { comp: CompGuide }) {
  const db = useApp((s) => s.cardDb);
  const token = (cardId: string) => {
    const card = db.get(cardId);
    return { cardId, name: card?.name ?? cardId, attack: card?.attack ?? 0, health: card?.health ?? 0, tier: card?.tier, tribes: card?.tribes };
  };
  const core = comp.cards.filter((c) => c.role === 'core');
  const addons = comp.cards.filter((c) => c.role !== 'core');
  return (
    <Card className="tl-comp">
      <div className="tl-comp__head">
        <HeroTierBadge tier={comp.tier as 'S' | 'A' | 'B' | 'C' | 'D' | undefined} />
        <div className="tl-comp__title">
          <span className="tl-comp__name">
            {comp.tribe ? <TribeEmblem tribe={comp.tribe} size={18} title={tribeLabel(comp.tribe)} /> : null}
            {comp.name}
          </span>
          <span className="tl-muted tl-small">
            {comp.difficulty ? `${comp.difficulty} to play` : null}
            {comp.games ? ` · ${comp.games.toLocaleString()} games` : null}
          </span>
        </div>
        {comp.avgPlacement ? (
          <div className="tl-comp__stats">
            <b className={clsx('tl-comp__avg', comp.avgPlacement <= 3.5 ? 'is-good' : comp.avgPlacement >= 4.2 ? 'is-bad' : '')}>{num(comp.avgPlacement, 2)}</b>
            <span className="tl-muted tl-small">avg place{comp.top4Rate !== undefined ? ` · top 4 ${pct(comp.top4Rate * 100, 0)}` : ''}</span>
          </div>
        ) : null}
      </div>
      <div className="tl-comp__cards">
        {core.map((c) => (
          <MinionToken key={c.cardId} minion={token(c.cardId)} size="sm" showName />
        ))}
        {addons.length ? <span className="tl-comp__sep" aria-hidden /> : null}
        {addons.map((c) => (
          <MinionToken key={c.cardId} minion={token(c.cardId)} size="xs" className="is-addon" />
        ))}
      </div>
      {comp.tip ? <p className="tl-comp__tip">{comp.tip}</p> : null}
      {comp.whenToCommit || comp.author ? (
        <div className="tl-comp__foot">
          {comp.whenToCommit ? (
            <span>
              <b>Commit when:</b> {comp.whenToCommit}
            </span>
          ) : (
            <span />
          )}
          {comp.author ? <span className="tl-muted tl-small">Tip by {comp.author}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}
