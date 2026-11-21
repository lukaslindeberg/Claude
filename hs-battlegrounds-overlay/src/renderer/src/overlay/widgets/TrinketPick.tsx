import clsx from 'clsx';
import type { TrinketOption } from '@shared/types';
import { lobbyEstimate } from '@core/stats/lobby';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { GameCard, RankMedal } from '../../components/GameCard';
import { RelevanceLine, TipNote } from '../../components/Synergy';
import { Tooltip } from '../../components/Tooltip';
import { num } from '../../lib/format';
import { rankByPlacement, tipFor, trinketKind, trinketStatFor, tribeRelevance, useLobbyTribes, useTrinketBundles, wantedTribes, type TribeRelevance } from '../../lib/synergy';
import { PICK_CARD_WIDTH, effectiveScale, trinketPickLayout } from '../layout';
import { PickRow } from './PickRow';

/**
 * Above the trinket offer (lesser / greater trinket picks): each option as the game's own
 * card with its rank among the offer by average placement, pick rate, whether the tribes
 * it wants are in this lobby, and how to play it. Trinkets whose tribe is missing from the
 * lobby rank last.
 */
export function TrinketPickWidget() {
  const options = useApp((s) => s.game?.trinketOptions);
  const phase = useApp((s) => s.game?.phase);
  const db = useApp((s) => s.cardDb);
  const vp = useViewport();
  const scale = useApp((s) => effectiveScale(s.settings.scale, vp));
  const bundles = useTrinketBundles();
  const lobby = useLobbyTribes();
  if (!options?.length || phase === 'heroSelection' || phase === 'gameOver') return null;
  const layout = trinketPickLayout(options.length, vp, scale);
  const rels = options.map((o) => tribeRelevance(wantedTribes(db.get(o.cardId), tipFor(db, o.cardId)), lobby.tribes));
  const values = options.map((o) => {
    const s = trinketStatFor(bundles, o.cardId, 'community') ?? trinketStatFor(bundles, o.cardId, 'personal');
    return s ? (lobbyEstimate(s, lobby.tribes, { minGames: 3 })?.avgPlacement ?? s.avgPlacement) : undefined;
  });
  const ranks = rankByPlacement(values, rels.map((r) => r.status === 'missing'));
  return (
    <PickRow className="tl-trinketpick" centers={layout.centers} top={layout.top} bottom={layout.bottom} cardWidth={PICK_CARD_WIDTH.trinket} keys={options.map((o) => o.entityId || o.cardId)}>
      {(i) => <TrinketPickCard option={options[i]} index={i} rank={ranks[i]} value={values[i]} rel={rels[i]} />}
    </PickRow>
  );
}

function TrinketPickCard({ option, index, rank, value, rel }: { option: TrinketOption; index: number; rank?: number; value?: number; rel: TribeRelevance }) {
  const db = useApp((s) => s.cardDb);
  const bundles = useTrinketBundles();
  const card = db.get(option.cardId);
  const name = option.name || card?.name || option.cardId;
  const kind = trinketKind(card);
  const community = trinketStatFor(bundles, option.cardId, 'community');
  const mine = trinketStatFor(bundles, option.cardId, 'personal');
  const tip = tipFor(db, option.cardId);
  return (
    <div className={clsx('tl-panel tl-pick tl-pick--trinket', rank === 1 && 'is-best', rel.status === 'missing' && 'is-warn')} style={{ animationDelay: `${index * 60}ms` }}>
      <RankMedal rank={rank} className="tl-pick__medal" />
      {rank === 1 ? <span className="tl-pick__ribbon">Best pick</span> : null}
      <div className="tl-pick__main">
        <GameCard cardId={option.cardId} width={116} className="tl-pick__card" />
        <div className="tl-pick__info">
          <div className="tl-pick__titlerow">
            <span className={clsx('tl-pick__name', name.length > 15 && 'is-long')}>{name}</span>
          </div>
          {value !== undefined ? (
            <Tooltip
              as="div"
              placement="bottom"
              content={
                <div className="tl-picktip">
                  <div className="tl-cardtip__name">{name}</div>
                  {kind ? (
                    <div className="tl-picktip__row">
                      <span>Type</span>
                      <b>{kind === 'lesser' ? 'Lesser trinket' : 'Greater trinket'}</b>
                    </div>
                  ) : null}
                  {community ? (
                    <>
                      <div className="tl-picktip__row">
                        <span>Average placement</span>
                        <b>{num(community.avgPlacement, 2)}</b>
                      </div>
                      <div className="tl-picktip__row">
                        <span>Community games</span>
                        <b>{community.games.toLocaleString()}</b>
                      </div>
                    </>
                  ) : null}
                  <div className="tl-picktip__row is-total">
                    <span>You</span>
                    <b>{mine ? `${num(mine.avgPlacement, 1)} avg · ${mine.games} game${mine.games === 1 ? '' : 's'}` : 'not picked yet'}</b>
                  </div>
                </div>
              }
            >
              <div className="tl-pick__place">
                <span className="tl-pick__value">{num(value, 2)}</span>
                <span className="tl-pick__placemeta">
                  <span className="tl-pick__placelabel">avg placement</span>
                  {community?.pickRate !== undefined ? <span className="tl-pick__placelabel">picked {Math.round(community.pickRate * 100)}%</span> : null}
                </span>
              </div>
            </Tooltip>
          ) : (
            <div className="tl-pick__nostat">No stats for this trinket</div>
          )}
          {rel.status !== 'none' ? <RelevanceLine rel={rel} className="tl-pick__rel" /> : null}
          {mine ? (
            <span className="tl-pick__mine">
              You <b>{num(mine.avgPlacement, 1)}</b> ×{mine.games}
            </span>
          ) : null}
        </div>
      </div>
      {tip ? <TipNote tip={tip} compact lines={5} label="How to play" /> : null}
    </div>
  );
}
