import clsx from 'clsx';
import type { TrinketOption } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { CardArt } from '../../components/CardArt';
import { CrownIcon } from '../../components/Icons';
import { RelevanceLine, TipNote } from '../../components/Synergy';
import { compact, num } from '../../lib/format';
import { tipFor, trinketKind, trinketStatFor, tribeRelevance, useLobbyTribes, useTrinketBundles, wantedTribes } from '../../lib/synergy';
import { PICK_CARD_WIDTH, effectiveScale, trinketPickLayout } from '../layout';
import { PickRow } from './PickRow';

/**
 * Stat cards above the trinket offer (lesser / greater trinket picks): community average
 * placement and pick rate, your own record, whether the tribes the trinket wants are in
 * this lobby, and its play tip. The best option by average placement gets a crown.
 */
export function TrinketPickWidget() {
  const options = useApp((s) => s.game?.trinketOptions);
  const phase = useApp((s) => s.game?.phase);
  const vp = useViewport();
  const scale = useApp((s) => effectiveScale(s.settings.scale, vp));
  const bundles = useTrinketBundles();
  if (!options?.length || phase === 'heroSelection' || phase === 'gameOver') return null;
  const layout = trinketPickLayout(options.length, vp, scale);
  const avgs = options.map((o) => trinketStatFor(bundles, o.cardId, 'community')?.avgPlacement);
  const known = avgs.filter((a): a is number => a !== undefined);
  const best = known.length >= 2 ? avgs.indexOf(Math.min(...known)) : -1;
  return (
    <PickRow
      className="tl-trinketpick"
      centers={layout.centers}
      top={layout.top}
      bottom={layout.bottom}
      cardWidth={PICK_CARD_WIDTH.trinket}
      keys={options.map((o) => o.entityId || o.cardId)}
    >
      {(i) => <TrinketCard option={options[i]} index={i} best={i === best} />}
    </PickRow>
  );
}

function TrinketCard({ option, index, best }: { option: TrinketOption; index: number; best: boolean }) {
  const db = useApp((s) => s.cardDb);
  const bundles = useTrinketBundles();
  const lobby = useLobbyTribes();
  const card = db.get(option.cardId);
  const name = option.name || card?.name || option.cardId;
  const kind = trinketKind(card);
  const community = trinketStatFor(bundles, option.cardId, 'community');
  const mine = trinketStatFor(bundles, option.cardId, 'personal');
  const tip = tipFor(db, option.cardId);
  const rel = tribeRelevance(wantedTribes(card, tip), lobby.tribes);
  const cost = option.cost ?? card?.cost;
  return (
    <div className={clsx('tl-panel tl-trinketcard', best && 'is-best', rel.status === 'missing' && 'is-warn')} style={{ animationDelay: `${index * 60}ms` }}>
      {best ? (
        <span className="tl-trinketcard__crown" title="Best average placement of these options">
          <CrownIcon size={14} />
        </span>
      ) : null}
      <div className="tl-trinketcard__top">
        <span className="tl-trinketcard__art">
          <CardArt cardId={option.cardId} name={name} initialsSize={15} />
        </span>
        <div className="tl-trinketcard__title">
          <span className={clsx('tl-trinketcard__name', name.length > 18 && 'is-long')}>{name}</span>
          <span className="tl-trinketcard__sub">
            {kind ? <span className={`tl-trinketkind is-${kind}`}>{kind}</span> : null}
            {cost ? <span className="tl-trinketcard__cost">{cost} gold</span> : null}
          </span>
        </div>
      </div>
      {community ? (
        <div className="tl-herocard__stats">
          <div className={clsx('tl-stat', best && 'is-best')}>
            <span className="tl-stat__value">{num(community.avgPlacement, 2)}</span>
            <span className="tl-stat__label">Avg place</span>
          </div>
          <div className="tl-stat">
            <span className="tl-stat__value">{community.pickRate !== undefined ? `${Math.round(community.pickRate * 100)}%` : '—'}</span>
            <span className="tl-stat__label">Picked</span>
          </div>
          <div className="tl-stat">
            <span className="tl-stat__value">{compact(community.games)}</span>
            <span className="tl-stat__label">Games</span>
          </div>
        </div>
      ) : (
        <div className="tl-herocard__empty is-slim">
          <span>No community stats</span>
        </div>
      )}
      {mine ? (
        <div className="tl-herocard__mine">
          <span className="tl-herocard__mine-label">You</span>
          <span>
            <b>{mine.games}</b> game{mine.games === 1 ? '' : 's'} · avg <b>{num(mine.avgPlacement, 1)}</b>
          </span>
        </div>
      ) : null}
      {rel.status !== 'none' ? <RelevanceLine rel={rel} /> : null}
      {tip ? <TipNote tip={tip} compact /> : null}
    </div>
  );
}
