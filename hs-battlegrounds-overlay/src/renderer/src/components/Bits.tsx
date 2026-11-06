import clsx from 'clsx';
import type { BattleSimResult, HeroStat, Tribe } from '@shared/types';
import { ordinal, placementColor, placementTone } from '../lib/format';
import { TIER_COLORS, type Outcome } from '../lib/stats';
import { TRIBE_SHORT, alpha, tribeColor, tribeLabel } from '../lib/tribes';
import { ShieldIcon, TripleIcon } from './Icons';

/** Tavern tier badge (hexagon). */
export function TierBadge({ tier, size = 20, className, title }: { tier: number; size?: number; className?: string; title?: string }) {
  return (
    <span className={clsx('tl-tier', className)} style={{ width: size, height: size, fontSize: size * 0.56 }} title={title ?? `Tavern tier ${tier}`}>
      <svg viewBox="0 0 20 22" width={size} height={size * 1.1} className="tl-tier__bg" aria-hidden>
        <path d="M10 1 19 6v10l-9 5-9-5V6l9-5Z" />
      </svg>
      <span className="tl-tier__num">{tier}</span>
    </span>
  );
}

export function TriplesBadge({ count }: { count: number }) {
  return (
    <span className={clsx('tl-triples', count === 0 && 'is-zero')} title={`${count} triple${count === 1 ? '' : 's'}`}>
      <TripleIcon size={11} />
      {count}
    </span>
  );
}

/** Hero health bar with armor shown as a shield chip. */
export function HealthBar({ health, maxHealth, armor, dead, compact }: { health: number; maxHealth: number; armor: number; dead?: boolean; compact?: boolean }) {
  const max = Math.max(maxHealth || 30, health, 1);
  const frac = Math.max(0, Math.min(1, health / max));
  const color = frac > 0.6 ? '#5cc47a' : frac > 0.3 ? '#e2b33c' : '#e0564f';
  return (
    <span className={clsx('tl-hpbar', compact && 'is-compact', dead && 'is-dead')}>
      <span className="tl-hpbar__track">
        <span className="tl-hpbar__fill" style={{ width: `${frac * 100}%`, background: `linear-gradient(90deg, ${color}, ${alpha(color, 0.75)})` }} />
      </span>
      <span className="tl-hpbar__num">{dead ? 0 : health}</span>
      {armor > 0 && !dead ? (
        <span className="tl-hpbar__armor" title={`${armor} armor`}>
          <ShieldIcon size={9} />
          {armor}
        </span>
      ) : null}
    </span>
  );
}

export function Sparkline({ points, width = 120, height = 28, max, color = '#f2c14e' }: { points: { turn: number; value: number }[]; width?: number; height?: number; max?: number; color?: string }) {
  if (points.length < 2) return <span className="tl-muted tl-small">Not enough data</span>;
  const top = max ?? Math.max(...points.map((p) => p.value), 1);
  const minT = points[0].turn;
  const maxT = points[points.length - 1].turn;
  const x = (t: number) => ((t - minT) / Math.max(1, maxT - minT)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - (Math.max(0, v) / top) * (height - 6);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.turn).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg className="tl-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="tl-spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${x(last.turn)},${height} L${x(points[0].turn)},${height} Z`} fill="url(#tl-spark-fill)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.turn)} cy={y(last.value)} r="2.4" fill={color} />
    </svg>
  );
}

export function TribeChip({ tribe, compact, muted, onClick, active }: { tribe: Tribe | 'NEUTRAL'; compact?: boolean; muted?: boolean; onClick?: () => void; active?: boolean }) {
  const c = tribeColor(tribe);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={clsx('tl-tribe', compact && 'is-compact', muted && 'is-muted', onClick && 'is-button', active && 'is-active')}
      style={{ '--c': c, '--c-bg': alpha(c, 0.16), '--c-border': alpha(c, 0.45) } as React.CSSProperties}
      onClick={onClick}
      title={tribeLabel(tribe)}
      type={onClick ? 'button' : undefined}
    >
      <i className="tl-tribe__dot" />
      {compact ? TRIBE_SHORT[tribe] : tribeLabel(tribe)}
    </Tag>
  );
}

export function PlacementBadge({ place, size = 'md', duos }: { place?: number; size?: 'sm' | 'md' | 'lg' | 'xl'; duos?: boolean }) {
  const c = placementColor(place, duos);
  return (
    <span className={clsx('tl-place', `tl-place--${size}`, `is-${placementTone(place, duos)}`)} style={{ '--c': c } as React.CSSProperties}>
      {place ? ordinal(place) : '—'}
    </span>
  );
}

export function PlacementPips({ placements, size = 14 }: { placements: number[]; size?: number }) {
  return (
    <span className="tl-pips">
      {placements.map((p, i) => (
        <span key={i} className="tl-pip" style={{ width: size, height: size, fontSize: size * 0.62, background: placementColor(p) }} title={ordinal(p)}>
          {p}
        </span>
      ))}
    </span>
  );
}

export function ResultChip({ result, damage, size = 'md' }: { result: Outcome; damage?: number; size?: 'sm' | 'md' }) {
  const letter = result === 'won' ? 'W' : result === 'lost' ? 'L' : 'T';
  return (
    <span className={clsx('tl-result', `is-${result}`, `tl-result--${size}`)} title={`${result}${damage ? ` · ${damage} damage` : ''}`}>
      {letter}
      {damage ? <span className="tl-result__dmg">{result === 'lost' ? '−' : '+'}{damage}</span> : null}
    </span>
  );
}

export function HeroTierBadge({ tier, size = 'md' }: { tier?: HeroStat['tier']; size?: 'sm' | 'md' | 'lg' }) {
  const c = tier ? TIER_COLORS[tier] : '#6b7080';
  return (
    <span className={clsx('tl-herotier', `tl-herotier--${size}`)} style={{ '--c': c, '--c-bg': alpha(c, 0.16) } as React.CSSProperties} title={tier ? `Tier ${tier}` : 'No tier'}>
      {tier ?? '?'}
    </span>
  );
}

/** Win / tie / loss distribution bar. */
export function OddsBar({ result, height = 22, labels = true }: { result: Pick<BattleSimResult, 'win' | 'tie' | 'loss'>; height?: number; labels?: boolean }) {
  const seg = (v: number, cls: string, label: string) =>
    v > 0 ? (
      <span className={clsx('tl-odds__seg', cls)} style={{ flexGrow: v }} title={`${label} ${v.toFixed(1)}%`}>
        {labels && v >= 9 ? `${v.toFixed(v >= 99.95 || v < 10 ? 0 : 1)}%` : ''}
      </span>
    ) : null;
  return (
    <span className="tl-odds" style={{ height }}>
      {seg(result.win, 'is-win', 'Win')}
      {seg(result.tie, 'is-tie', 'Tie')}
      {seg(result.loss, 'is-loss', 'Loss')}
    </span>
  );
}

export function TierTimeline({ history, compact }: { history: { tier: number; turn: number }[]; compact?: boolean }) {
  if (!history.length) return <span className="tl-muted tl-small">—</span>;
  return (
    <span className={clsx('tl-tiertl', compact && 'is-compact')}>
      {history.map((h) => (
        <span key={h.tier} className="tl-tiertl__step" title={`Tier ${h.tier} on turn ${h.turn}`}>
          <TierBadge tier={h.tier} size={compact ? 14 : 18} />
          <span className="tl-tiertl__turn">T{h.turn}</span>
        </span>
      ))}
    </span>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('tl-toggle', disabled && 'is-disabled')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="tl-toggle__track">
        <span className="tl-toggle__thumb" />
      </span>
      {label ? (
        <span className="tl-toggle__text">
          <span className="tl-toggle__label">{label}</span>
          {hint ? <span className="tl-toggle__hint">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
