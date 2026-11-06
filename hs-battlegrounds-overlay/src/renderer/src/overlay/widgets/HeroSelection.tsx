import { useMemo } from 'react';
import clsx from 'clsx';
import type { HeroOption } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { HeroTierBadge } from '../../components/Bits';
import { ShieldIcon } from '../../components/Icons';
import { compact, num, pct } from '../../lib/format';
import { findHeroStat, summarize, tierFromAvg } from '../../lib/stats';
import { heroPickCenters } from '../layout';

/** Stat cards above each offered hero, in the same left→right order as the game. */
export function HeroSelectionWidget() {
  const game = useApp((s) => s.game);
  const vp = useViewport();
  const options = game?.heroOptions ?? [];
  if (game?.phase !== 'heroSelection' || options.length === 0) return null;
  const centers = heroPickCenters(options.length, vp);
  return (
    <div className="tl-heropick" style={{ top: Math.round(vp.height * 0.035) }}>
      {options.map((opt, i) => (
        <div key={opt.entityId || opt.cardId} className="tl-heropick__slot" style={{ left: centers[i] }}>
          <div className="tl-widget__scale">
            <HeroStatCard option={opt} index={i} />
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroStatCard({ option, index }: { option: HeroOption; index: number }) {
  const db = useApp((s) => s.cardDb);
  const bundles = useApp((s) => s.heroStats);
  const history = useApp((s) => s.history);
  const communityEnabled = useApp((s) => s.settings.communityStats);
  const baseId = option.baseCardId || db.baseHeroId(option.cardId);
  const name = option.name || db.name(baseId);
  const found = findHeroStat(
    communityEnabled ? bundles : bundles.filter((b) => b.source === 'personal'),
    baseId,
  );
  const mine = useMemo(() => summarize(history.filter((m) => (m.baseHeroCardId || m.heroCardId) === baseId)), [history, baseId]);
  const stat = found?.stat;
  const tier = stat ? (stat.tier ?? (stat.games >= 3 ? tierFromAvg(stat.avgPlacement) : undefined)) : undefined;
  const armor = option.armor ?? db.get(baseId)?.armor;

  return (
    <div className="tl-panel tl-herocard" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="tl-herocard__top">
        <HeroPortrait cardId={option.cardId} name={name} size={50} />
        <div className="tl-herocard__title">
          <span className={clsx('tl-herocard__name', (name.length > 16 || name.split(/\s+/).some((w) => w.length > 9)) && 'is-long')}>{name}</span>
          {armor ? (
            <span className="tl-herocard__sub">
              <ShieldIcon size={10} /> {armor} armor
            </span>
          ) : null}
        </div>
        <HeroTierBadge tier={tier} size="lg" />
      </div>
      {stat ? (
        <div className="tl-herocard__stats">
          <div className="tl-stat">
            <span className="tl-stat__value">{num(stat.avgPlacement, 2)}</span>
            <span className="tl-stat__label">Avg place</span>
          </div>
          <div className="tl-stat">
            <span className="tl-stat__value">{pct(stat.top4Rate, 0)}</span>
            <span className="tl-stat__label">Top 4</span>
          </div>
          <div className="tl-stat">
            <span className="tl-stat__value">{compact(stat.games)}</span>
            <span className="tl-stat__label">Games</span>
          </div>
        </div>
      ) : (
        <div className="tl-herocard__empty">
          <span>No stats yet</span>
          <span className="tl-muted tl-small">{communityEnabled ? 'Not in the community data' : 'Community stats are off'}</span>
        </div>
      )}
      <div className="tl-herocard__mine">
        <span className="tl-herocard__mine-label">You</span>
        {mine.games > 0 ? (
          <span>
            <b>{mine.games}</b> game{mine.games === 1 ? '' : 's'} · avg <b>{num(mine.avgPlacement, 1)}</b> · top 4 <b>{pct(mine.top4Rate, 0)}</b>
          </span>
        ) : (
          <span className="tl-muted">No games with this hero yet</span>
        )}
      </div>
      {found ? (
        <div className="tl-herocard__source">
          <span className={`tl-source is-${found.bundle.source}`}>{found.bundle.source === 'community' ? 'Community' : 'Personal'}</span>
          <span>{found.bundle.label.replace(/^Community\s*·\s*/, '')}</span>
        </div>
      ) : null}
    </div>
  );
}
