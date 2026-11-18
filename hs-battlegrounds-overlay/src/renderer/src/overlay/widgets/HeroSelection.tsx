import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { LOBBY_TRIBES, type HeroOption, type Tribe } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { HeroTierBadge, TribeEmblem } from '../../components/Bits';
import { DeltaBadge, SynergyChip, TipNote } from '../../components/Synergy';
import { RankMedal } from '../../components/GameCard';
import { Tooltip } from '../../components/Tooltip';
import { num, pct } from '../../lib/format';
import { summarize, tierFromAvg } from '../../lib/stats';
import { tribeLabel } from '../../lib/tribes';
import { heroStatFor, heroSynergy, personalTribeRecord, rankByPlacement, signedDelta, tipFor, useLobbyTribes, type HeroSynergy, type LobbyTribes } from '../../lib/synergy';
import { DragHandle, FloatingWidget } from '../Widget';
import { HERO_PICK_ART_TOP, PICK_CARD_WIDTH, bottomLeftMaxWidth, heroPickCenters } from '../layout';
import { useDock } from './Dock';
import { PickRow } from './PickRow';

interface HeroRow {
  option: HeroOption;
  baseId: string;
  found?: ReturnType<typeof heroStatFor>;
  syn?: HeroSynergy;
  /** Expected placement: the lobby estimate when tribes are known, else the overall average. */
  value?: number;
}

/**
 * Above each offered hero (same left→right order as the game): its rank among the offer
 * by expected placement in this lobby, how the tribes move it, and how to play it.
 */
export function HeroSelectionWidget() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  const bundles = useApp((s) => s.heroStats);
  const community = useApp((s) => s.settings.communityStats);
  const vp = useViewport();
  const lobby = useLobbyTribes();
  const options = game?.heroOptions ?? [];
  const mode = game?.mode ?? 'solo';
  const rows = useMemo<HeroRow[]>(
    () =>
      options.map((option) => {
        const baseId = option.baseCardId || db.baseHeroId(option.cardId);
        const found = heroStatFor(bundles, baseId, { mode, community });
        const syn = found ? heroSynergy(found.stat, found.bundle.source, lobby.tribes, mode) : undefined;
        return { option, baseId, found, syn, value: found ? (syn?.estimate?.avgPlacement ?? found.stat.avgPlacement) : undefined };
      }),
    [options, db, bundles, community, lobby.tribes, mode],
  );
  if (game?.phase !== 'heroSelection' || options.length === 0) return null;
  const ranks = rankByPlacement(rows.map((r) => r.value));
  return (
    <>
      <PickRow
        centers={heroPickCenters(options.length, vp)}
        top={Math.round(vp.height * 0.03)}
        bottom={Math.round(vp.height * HERO_PICK_ART_TOP) - 6}
        cardWidth={PICK_CARD_WIDTH.hero}
        keys={options.map((o) => o.entityId || o.cardId)}
      >
        {(i) => <HeroPickCard row={rows[i]} rank={ranks[i]} index={i} lobby={lobby} />}
      </PickRow>
      {lobby.source === 'game' ? null : <LobbyTribePicker gameId={game.gameId} lobby={lobby} />}
    </>
  );
}

function HeroPickCard({ row, rank, index, lobby }: { row: HeroRow; rank?: number; index: number; lobby: LobbyTribes }) {
  const db = useApp((s) => s.cardDb);
  const history = useApp((s) => s.history);
  const mode = useApp((s) => s.game?.mode ?? 'solo');
  const { option, baseId, found, syn } = row;
  const name = option.name || db.name(baseId);
  const stat = found?.stat;
  const mineGames = useMemo(() => history.filter((m) => (m.baseHeroCardId || m.heroCardId) === baseId && (m.mode ?? 'solo') === mode), [history, baseId, mode]);
  const mine = useMemo(() => summarize(mineGames), [mineGames]);
  const mineByTribe = useMemo(() => (lobby.tribes.length ? personalTribeRecord(mineGames, baseId, lobby.tribes).slice(0, 4) : []), [mineGames, baseId, lobby.tribes]);
  const tier = stat ? (stat.tier ?? (stat.games >= 3 ? tierFromAvg(stat.avgPlacement) : undefined)) : undefined;
  const tip = tipFor(db, baseId);
  const adjusted = !!syn?.estimate && syn.delta !== undefined;

  return (
    <div className={clsx('tl-panel tl-pick', rank === 1 && 'is-best')} style={{ animationDelay: `${index * 60}ms` }}>
      <RankMedal rank={rank} className="tl-pick__medal" />
      {rank === 1 ? <span className="tl-pick__ribbon">Best pick</span> : null}
      <div className="tl-pick__main">
        <HeroPortrait cardId={option.cardId} name={name} size={74} shape="rounded" className="tl-pick__hero" />
        <div className="tl-pick__info">
          <div className="tl-pick__titlerow">
            <span className={clsx('tl-pick__name', name.length > 15 && 'is-long')}>{name}</span>
            <HeroTierBadge tier={tier} size="sm" />
          </div>
          {stat ? (
            <Tooltip
              as="div"
              placement="bottom"
              content={
                <div className="tl-picktip">
                  <div className="tl-cardtip__name">{name}</div>
                  <div className="tl-picktip__row">
                    <span>Overall average</span>
                    <b>{num(stat.avgPlacement, 2)}</b>
                  </div>
                  <div className="tl-picktip__row">
                    <span>Top 4</span>
                    <b>{pct(stat.top4Rate, 0)}</b>
                  </div>
                  <div className="tl-picktip__row">
                    <span>{found?.bundle.source === 'community' ? 'Community games' : 'Your games'}</span>
                    <b>{stat.games.toLocaleString()}</b>
                  </div>
                  {syn?.estimate?.contributions.map((c) => (
                    <div key={c.tribe} className="tl-picktip__row">
                      <span>
                        <TribeEmblem tribe={c.tribe} size={14} /> {tribeLabel(c.tribe)}
                      </span>
                      <b className={c.impact < 0 ? 'is-good' : 'is-bad'}>{signedDelta(c.impact)}</b>
                    </div>
                  ))}
                  <div className="tl-picktip__row is-total">
                    <span>You</span>
                    <b>{mine.games ? `${num(mine.avgPlacement, 1)} avg · ${mine.games} game${mine.games === 1 ? '' : 's'}` : 'no games yet'}</b>
                  </div>
                  {mineByTribe.length ? (
                    <div className="tl-picktip__row">
                      <span>Your lobbies with</span>
                      <span className="tl-picktip__mine">
                        {mineByTribe.map((r) => (
                          <span key={r.tribe}>
                            <TribeEmblem tribe={r.tribe} size={13} /> {num(r.avg, 1)}
                          </span>
                        ))}
                      </span>
                    </div>
                  ) : null}
                </div>
              }
            >
              <div className="tl-pick__place">
                <span className="tl-pick__value">{num(row.value, 2)}</span>
                <span className="tl-pick__placemeta">
                  {adjusted ? (
                    <span className="tl-pick__placeline">
                      <DeltaBadge delta={syn!.delta!} />
                      <span className="tl-pick__placelabel">in this lobby</span>
                    </span>
                  ) : null}
                  <span className="tl-pick__placelabel">{adjusted ? `${num(stat.avgPlacement, 2)} overall` : 'avg placement'}</span>
                </span>
              </div>
            </Tooltip>
          ) : (
            <div className="tl-pick__nostat">No stats for this hero</div>
          )}
        </div>
      </div>
      {syn && (syn.best.length || syn.worst.length) ? (
        <div className="tl-pick__chips">
          <span className="tl-pick__chiplabel">Best</span>
          {syn.best.map((t) => (
            <SynergyChip key={t.tribe} syn={t} lobby={lobby.tribes} />
          ))}
          <span className="tl-pick__chiplabel is-worst">Worst</span>
          {syn.worst.map((t) => (
            <SynergyChip key={t.tribe} syn={t} lobby={lobby.tribes} />
          ))}
        </div>
      ) : null}
      {tip ? <TipNote tip={tip} lines={4} label="How to play" /> : null}
    </div>
  );
}

/** Top edge (window px) of the lobby plaque, re-read while it changes size. */
function useDockTop(dockHeight: number): number | undefined {
  const [top, setTop] = useState<number | undefined>();
  useEffect(() => {
    const read = () => {
      const el = document.querySelector('[data-widget="lobbyInfo"]');
      const t = el ? Math.round(el.getBoundingClientRect().top) : undefined;
      setTop((cur) => (cur === t ? cur : t));
    };
    read();
    const id = window.setInterval(read, 400);
    return () => window.clearInterval(id);
  }, [dockHeight]);
  return top;
}

/**
 * "Tribes in this lobby?": Hearthstone shows the lobby's tribes on the hero-select screen
 * but does not write them to the log until shop offers reveal them, so the user can tick
 * them here for lobby-adjusted estimates right away. Hidden once the tribes are known (read
 * from the hero-pick screen on Windows, or from the shop); the lobby plaque shows them then.
 */
function LobbyTribePicker({ gameId, lobby }: { gameId: string; lobby: LobbyTribes }) {
  const setPicks = useApp((s) => s.setLobbyPicks);
  const picks = useApp((s) => s.lobbyPicks[gameId]);
  const dockHeight = useDock((s) => s.height);
  const vp = useViewport();
  const dockTop = useDockTop(dockHeight);
  const locked = lobby.source === 'game';
  const chosen = new Set<Tribe>(locked ? lobby.tribes : (picks ?? []));
  const toggle = (t: Tribe) => {
    if (locked) return;
    const next = chosen.has(t) ? [...chosen].filter((x) => x !== t) : [...chosen, t];
    setPicks(gameId, LOBBY_TRIBES.filter((x) => next.includes(x)));
  };
  return (
    <FloatingWidget
      id="heroSelection"
      defaultPosition={(vp, size) => {
        // Sit just above the lobby plaque where it really is (it can grow, or be dragged).
        const bottom = dockTop !== undefined && dockTop > vp.height / 2 ? dockTop - 6 : vp.height - 10;
        return { left: 10, top: bottom - size.height };
      }}
      zIndex={22}
      maxWidth={bottomLeftMaxWidth(vp)}
    >
      {(handle) => (
        <div className={clsx('tl-panel tl-tpick', locked && 'is-locked')}>
          <div className="tl-tpick__head">
            <DragHandle handle={handle} />
            <span className="tl-plate">{locked ? 'Tribes in this lobby' : 'Tribes in this lobby?'}</span>
            {locked ? (
              <span className="tl-tpick__tag">{lobby.inferred ? 'inferred' : 'from game'}</span>
            ) : (
              <span className="tl-tpick__count">{chosen.size ? `${chosen.size} picked` : 'click the 5 shown in game'}</span>
            )}
            {!locked && chosen.size ? (
              <button type="button" className="tl-tpick__clear" onClick={() => setPicks(gameId, [])}>
                Clear
              </button>
            ) : null}
          </div>
          <div className="tl-tpick__row">
            {LOBBY_TRIBES.map((t) => (
              <button
                key={t}
                type="button"
                tabIndex={-1}
                className={clsx('tl-tpick__btn', chosen.has(t) && 'is-on', chosen.size > 0 && !chosen.has(t) && 'is-off')}
                onClick={locked ? undefined : () => toggle(t)}
                disabled={locked}
                title={tribeLabel(t)}
              >
                <TribeEmblem tribe={t} size={24} />
              </button>
            ))}
          </div>
        </div>
      )}
    </FloatingWidget>
  );
}
