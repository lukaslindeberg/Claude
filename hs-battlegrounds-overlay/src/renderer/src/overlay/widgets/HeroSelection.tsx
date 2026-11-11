import { useMemo } from 'react';
import clsx from 'clsx';
import { LOBBY_TRIBES, type HeroOption, type Tribe } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { HeroTierBadge, StatGem, TribeEmblem } from '../../components/Bits';
import { DeltaBadge, SynergyChip, TipNote } from '../../components/Synergy';
import { compact, num, pct } from '../../lib/format';
import { summarize, tierFromAvg } from '../../lib/stats';
import { tribeLabel } from '../../lib/tribes';
import { heroStatFor, heroSynergy, personalTribeRecord, tipFor, useLobbyTribes, type LobbyTribes } from '../../lib/synergy';
import { DragHandle, FloatingWidget } from '../Widget';
import { HERO_PICK_ART_TOP, PICK_CARD_WIDTH, bottomLeftMaxWidth, heroPickCenters } from '../layout';
import { useSessionDock } from './SessionWidget';
import { useLobbyDock } from './LobbyInfo';
import { PickRow } from './PickRow';

/** Stat cards above each offered hero, in the same left→right order as the game. */
export function HeroSelectionWidget() {
  const game = useApp((s) => s.game);
  const vp = useViewport();
  const lobby = useLobbyTribes();
  const options = game?.heroOptions ?? [];
  if (game?.phase !== 'heroSelection' || options.length === 0) return null;
  return (
    <>
      <PickRow
        centers={heroPickCenters(options.length, vp)}
        top={Math.round(vp.height * 0.035)}
        bottom={Math.round(vp.height * HERO_PICK_ART_TOP) - 6}
        cardWidth={PICK_CARD_WIDTH.hero}
        keys={options.map((o) => o.entityId || o.cardId)}
      >
        {(i) => <HeroStatCard option={options[i]} index={i} lobby={lobby} />}
      </PickRow>
      <LobbyTribePicker gameId={game.gameId} lobby={lobby} />
    </>
  );
}

function HeroStatCard({ option, index, lobby }: { option: HeroOption; index: number; lobby: LobbyTribes }) {
  const db = useApp((s) => s.cardDb);
  const bundles = useApp((s) => s.heroStats);
  const history = useApp((s) => s.history);
  const mode = useApp((s) => s.game?.mode ?? 'solo');
  const communityEnabled = useApp((s) => s.settings.communityStats);
  const baseId = option.baseCardId || db.baseHeroId(option.cardId);
  const name = option.name || db.name(baseId);
  const found = heroStatFor(bundles, baseId, { mode, community: communityEnabled });
  const mineGames = useMemo(() => history.filter((m) => (m.baseHeroCardId || m.heroCardId) === baseId && (m.mode ?? 'solo') === mode), [history, baseId, mode]);
  const mine = useMemo(() => summarize(mineGames), [mineGames]);
  const mineByTribe = useMemo(() => (lobby.tribes.length ? personalTribeRecord(mineGames, baseId, lobby.tribes).slice(0, 3) : []), [mineGames, baseId, lobby.tribes]);
  const stat = found?.stat;
  const syn = stat && found ? heroSynergy(stat, found.bundle.source, lobby.tribes, mode) : undefined;
  const tier = stat ? (stat.tier ?? (stat.games >= 3 ? tierFromAvg(stat.avgPlacement) : undefined)) : undefined;
  const armor = option.armor ?? db.get(baseId)?.armor;
  const tip = tipFor(db, baseId);
  const hasSyn = !!syn && (syn.best.length > 0 || syn.worst.length > 0);

  return (
    <div className="tl-panel tl-herocard" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="tl-herocard__top">
        <HeroPortrait cardId={option.cardId} name={name} size={50} shape="rounded" />
        <div className="tl-herocard__title">
          <span className={clsx('tl-herocard__name', (name.length > 16 || name.split(/\s+/).some((w) => w.length > 9)) && 'is-long')}>{name}</span>
          <span className="tl-herocard__sub">
            {armor ? (
              <>
                <StatGem kind="armor" value={armor} size={17} /> armor
              </>
            ) : null}
          </span>
        </div>
        <HeroTierBadge tier={tier} size="lg" />
      </div>
      {stat ? (
        <div className="tl-herocard__stats" title={found?.bundle.label}>
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
      {syn?.estimate && syn.delta !== undefined ? (
        <div className="tl-herocard__lobby">
          <span className="tl-herocard__lobby-label">In this lobby</span>
          <span className="tl-herocard__lobby-value">≈ {num(syn.estimate.avgPlacement, 2)}</span>
          <DeltaBadge delta={syn.delta} />
        </div>
      ) : stat && lobby.tribes.length ? (
        <div className="tl-herocard__lobby is-none">No tribe data for this lobby</div>
      ) : null}
      {hasSyn ? (
        <div className="tl-herocard__syn">
          <div className="tl-herocard__syncol">
            <span className="tl-herocard__synlabel">Best with</span>
            <span className="tl-herocard__chips">
              {syn!.best.length ? syn!.best.map((t) => <SynergyChip key={t.tribe} syn={t} lobby={lobby.tribes} />) : <span className="tl-muted">—</span>}
            </span>
          </div>
          <div className="tl-herocard__syncol">
            <span className="tl-herocard__synlabel">Worst with</span>
            <span className="tl-herocard__chips">
              {syn!.worst.length ? syn!.worst.map((t) => <SynergyChip key={t.tribe} syn={t} lobby={lobby.tribes} />) : <span className="tl-muted">—</span>}
            </span>
          </div>
        </div>
      ) : null}
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
      {mineByTribe.length ? (
        <div className="tl-herocard__minetribes" title="Your average placement with this hero in lobbies that had each tribe">
          <span className="tl-herocard__synlabel">Your lobbies with</span>
          {mineByTribe.map((r) => (
            <span key={r.tribe} className="tl-herocard__minetribe">
              <TribeEmblem tribe={r.tribe} size={14} />
              <b>{num(r.avg, 1)}</b>
              <span className="tl-muted">×{r.games}</span>
            </span>
          ))}
        </div>
      ) : null}
      {tip ? <TipNote tip={tip} /> : null}
    </div>
  );
}

/**
 * "Tribes in this lobby?": Hearthstone shows the lobby's tribes on the hero-select screen
 * but does not write them to the log until shop offers reveal them, so the user can tick
 * them here for lobby-adjusted estimates right away. Once the tracker knows the tribes,
 * the row shows those, read-only.
 */
function LobbyTribePicker({ gameId, lobby }: { gameId: string; lobby: LobbyTribes }) {
  const setPicks = useApp((s) => s.setLobbyPicks);
  const picks = useApp((s) => s.lobbyPicks[gameId]);
  const sessionHeight = useSessionDock((s) => s.height);
  const lobbyHeight = useLobbyDock((s) => s.height);
  const vp = useViewport();
  const locked = lobby.source === 'game';
  const chosen = new Set<Tribe>(locked ? lobby.tribes : (picks ?? []));
  const toggle = (t: Tribe) => {
    if (locked) return;
    const next = chosen.has(t) ? [...chosen].filter((x) => x !== t) : [...chosen, t];
    setPicks(gameId, LOBBY_TRIBES.filter((x) => next.includes(x)));
  };
  const below = (sessionHeight ? sessionHeight + 6 : 0) + (lobbyHeight ? lobbyHeight + 6 : 0);
  return (
    <FloatingWidget
      id="heroSelection"
      defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 - below })}
      zIndex={22}
      maxWidth={bottomLeftMaxWidth(vp)}
    >
      {(handle) => (
        <div className={clsx('tl-plaque tl-tpick', locked && 'is-locked')}>
          <div className="tl-tpick__head">
            <DragHandle handle={handle} />
            <span className="tl-tpick__title">{locked ? 'Tribes in this lobby' : 'Tribes in this lobby?'}</span>
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
