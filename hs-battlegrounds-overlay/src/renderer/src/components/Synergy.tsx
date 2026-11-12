import clsx from 'clsx';
import type { PlayTip, Tribe, TribeSynergy } from '@shared/types';
import { tribeLabel } from '../lib/tribes';
import { joinTribes, signedDelta, signedImpact, type TribeRelevance } from '../lib/synergy';
import { TribeEmblem } from './Bits';
import { CheckIcon, WarningIcon } from './Icons';

/**
 * A tribe emblem with its placement impact: green when the tribe helps (negative),
 * red when it hurts. Lobby tribes get a gold ring; once the lobby is known, tribes
 * that are not in it are dimmed.
 */
export function SynergyChip({ syn, lobby, size = 16 }: { syn: Pick<TribeSynergy, 'tribe' | 'impact' | 'games'>; lobby?: Tribe[]; size?: number }) {
  const known = !!lobby?.length;
  const inLobby = known && lobby!.includes(syn.tribe);
  return (
    <span
      className={clsx('tl-syn', syn.impact < 0 ? 'is-good' : 'is-bad', inLobby && 'is-lobby', known && !inLobby && 'is-out')}
      title={`${tribeLabel(syn.tribe)} in the lobby: ${signedDelta(syn.impact)} placement · ${syn.games.toLocaleString()} games${known ? (inLobby ? ' · in this lobby' : ' · not in this lobby') : ''}`}
    >
      <TribeEmblem tribe={syn.tribe} size={size} />
      <span className="tl-syn__v">{signedImpact(syn.impact)}</span>
    </span>
  );
}

/** Placement delta (lower placement is better: negative = green). */
export function DeltaBadge({ delta, digits = 2 }: { delta: number; digits?: number }) {
  const tone = Math.abs(delta) < 0.005 ? 'is-flat' : delta < 0 ? 'is-good' : 'is-bad';
  return <span className={clsx('tl-delta', tone)}>{signedDelta(delta, digits)}</span>;
}

/**
 * Play tip as a small parchment note. Long tips are clamped to `lines` lines and
 * unfold over the content below on hover (works in the click-through overlay: the
 * game forwards mouse moves).
 */
export function TipNote({ tip, lines = 2, className, compact, label }: { tip: PlayTip; lines?: number; className?: string; compact?: boolean; label?: string }) {
  const long = tip.tip.length > (compact ? 70 : 95);
  return (
    <div className={clsx('tl-tipnote', long && 'is-long', compact && 'is-compact', className)} style={{ '--lines': lines } as React.CSSProperties}>
      <span className="tl-tipnote__text">
        {label ? <b className="tl-tipnote__label">{label}</b> : null}
        {tip.tip}
      </span>
      {long ? (
        <span className="tl-tipnote__full" aria-hidden>
          {label ? <b className="tl-tipnote__label">{label}</b> : null}
          {tip.tip}
        </span>
      ) : null}
    </div>
  );
}

/** "✓ Beasts in lobby" / "No Beasts in this lobby" / "Wants Beasts". */
export function RelevanceLine({ rel, className }: { rel: TribeRelevance; className?: string }) {
  if (rel.status === 'none') return null;
  if (rel.status === 'unknown')
    return (
      <span className={clsx('tl-rel is-unknown', className)}>
        <span className="tl-rel__emblems">
          {rel.wanted.map((t) => (
            <TribeEmblem key={t} tribe={t} size={15} />
          ))}
        </span>
        Wants {joinTribes(rel.wanted)}
      </span>
    );
  if (rel.status === 'missing')
    return (
      <span className={clsx('tl-rel is-missing', className)}>
        <WarningIcon size={12} />
        No {joinTribes(rel.wanted)} in this lobby
      </span>
    );
  return (
    <span className={clsx('tl-rel is-ok', className)}>
      <CheckIcon size={11} />
      <span className="tl-rel__emblems">
        {rel.present.map((t) => (
          <TribeEmblem key={t} tribe={t} size={15} />
        ))}
      </span>
      {joinTribes(rel.present).replace(/ or /, ' and ')} in lobby
    </span>
  );
}

/** Tooltip body for a hero or trinket with a play tip. */
export function TipTooltip({ name, tip, rel }: { name: string; tip: PlayTip; rel?: TribeRelevance }) {
  return (
    <div className="tl-tiptip">
      <div className="tl-cardtip__name">{name}</div>
      <p className="tl-tiptip__body">{tip.tip}</p>
      {rel && rel.status !== 'none' ? <RelevanceLine rel={rel} /> : null}
    </div>
  );
}
