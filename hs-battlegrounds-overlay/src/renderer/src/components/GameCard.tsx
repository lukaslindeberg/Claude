import { useMemo } from 'react';
import clsx from 'clsx';
import type { MinionSnapshot } from '@shared/types';
import { useApp } from '../store/appStore';
import { CardRender, useImagesEnabled, wantLargeRender } from './CardArt';
import { ParchmentCard, baseStats, type TooltipMinion } from './CardTooltip';
import { StatGem } from './Bits';
import { CrownIcon } from './Icons';

/** Natural width (CSS px) the card render and its parchment fallback are drawn at. */
const NATURAL = 186;

/**
 * The game's own Battlegrounds card (minion, trinket, hero power) as a free-standing
 * render: a transparent PNG, so no box around it. With images off or missing it is a
 * parchment card drawn from the card data. For a minion on a board, its current attack
 * and health are drawn over the printed ones when they differ.
 */
export function GameCard({ cardId, width = 150, minion, className }: { cardId: string; width?: number; minion?: TooltipMinion; className?: string }) {
  const db = useApp((s) => s.cardDb);
  const card = db.get(cardId);
  const golden = minion?.golden ?? !!card?.golden;
  const renderId = card?.normalId && golden ? card.normalId : cardId;
  const large = useMemo(() => width > 190 || wantLargeRender(), [width]);
  const base = minion ? baseStats(card, golden) : undefined;
  // The parchment fallback (images off) already draws the current stats.
  const images = useImagesEnabled();
  const changed = images && !!minion && (!base || base.attack !== minion.attack || base.health !== minion.health);
  const damaged = !!minion && minion.maxHealth !== undefined && minion.health < minion.maxHealth;
  return (
    <span className={clsx('tl-gamecard', golden && 'is-golden', className)} style={{ width, height: Math.round((width * 776) / 512) }}>
      <span className="tl-gamecard__scale" style={{ zoom: width / NATURAL }}>
        <CardRender cardId={renderId} large={large} fallback={<ParchmentCard cardId={cardId} minion={minion} />} />
        {changed && minion ? (
          <>
            <StatGem kind="atk" value={minion.attack} size={44} tone={base && minion.attack > base.attack ? 'buffed' : undefined} className="tl-gamecard__atk" />
            <StatGem
              kind="hp"
              value={minion.health}
              size={44}
              tone={damaged ? 'damaged' : base && minion.health > base.health ? 'buffed' : undefined}
              className="tl-gamecard__hp"
            />
          </>
        ) : null}
      </span>
    </span>
  );
}

/** A board as a row of the game's cards (opponent hover, post-match). */
export function BoardCards({ minions, width = 132, className }: { minions: MinionSnapshot[]; width?: number; className?: string }) {
  return (
    <div className={clsx('tl-boardcards', className)}>
      {minions.map((m) => (
        <GameCard key={m.entityId} cardId={m.cardId} minion={m} width={width} />
      ))}
    </div>
  );
}

/** Rank medal for pick options: #1 is gold with a crown, the rest darker bronze. */
export function RankMedal({ rank, size = 30, className }: { rank?: number; size?: number; className?: string }) {
  return (
    <span className={clsx('tl-medal', rank === 1 && 'is-best', !rank && 'is-none', className)} style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {rank === 1 ? <CrownIcon size={Math.round(size * 0.52)} className="tl-medal__crown" /> : null}
      <span>{rank ?? '?'}</span>
    </span>
  );
}
