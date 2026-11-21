import clsx from 'clsx';
import type { BattleSimResult, HeroStat, Tribe } from '@shared/types';
import { ordinal, placementColor, placementTone } from '../lib/format';
import { TIER_COLORS, type Outcome } from '../lib/stats';
import { TRIBE_SHORT, alpha, tribeColor, tribeLabel } from '../lib/tribes';
import { TRIBE_GLYPHS } from './Icons';

export type GemTone = 'win' | 'tie' | 'loss' | 'gold' | 'blue' | 'purple';

/** Round cabochon gem in a brass bezel (win / tie / loss and accents). */
export function Gem({ tone, size = 12, className, title }: { tone: GemTone; size?: number; className?: string; title?: string }) {
  return <span className={clsx('tl-gem', `is-${tone}`, className)} style={{ width: size, height: size }} title={title} aria-hidden={!title} />;
}

/**
 * A stat drawn the way the game draws it: attack in a gold disc, health in a red
 * blood drop, armor in a steel shield, with a white outlined number.
 */
export function StatGem({ kind, value, size = 22, tone, className, title }: { kind: 'atk' | 'hp' | 'armor'; value: number | string; size?: number; tone?: 'buffed' | 'damaged'; className?: string; title?: string }) {
  const len = String(value).length;
  return (
    <span
      className={clsx('tl-statgem', `is-${kind}`, tone && `is-${tone}`, className)}
      style={{ '--s': `${size}px`, width: size, height: size, fontSize: size * (len >= 3 ? 0.46 : len === 2 ? 0.56 : 0.64) } as React.CSSProperties}
      title={title}
    >
      {value}
    </span>
  );
}

/** Tavern tier: a banner shield with the tier number (gold for the highlighted tier). */
export function TierBadge({ tier, size = 20, className, title, gold }: { tier: number; size?: number; className?: string; title?: string; gold?: boolean }) {
  return (
    <span
      className={clsx('tl-tier', gold && 'is-gold', className)}
      style={{ width: size, height: Math.round(size * 1.16), fontSize: size * 0.6 }}
      title={title ?? `Tavern tier ${tier}`}
    >
      <span className="tl-tier__num">{tier}</span>
    </span>
  );
}

/** Triples as small golden pips (a count beyond five is written out). */
export function TriplesBadge({ count }: { count: number }) {
  const shown = Math.min(count, 5);
  return (
    <span className={clsx('tl-triples', count === 0 && 'is-zero')} title={`${count} triple${count === 1 ? '' : 's'}`}>
      {count === 0 ? <i className="is-empty" /> : Array.from({ length: shown }, (_, i) => <i key={i} />)}
      {count > 5 ? <span className="tl-triples__more">+{count - 5}</span> : null}
    </span>
  );
}

/** Hero health as a recessed groove with the health drop and armor shield. */
export function HealthBar({ health, maxHealth, armor, dead, compact }: { health: number; maxHealth: number; armor: number; dead?: boolean; compact?: boolean }) {
  const max = Math.max(maxHealth || 30, health, 1);
  const frac = Math.max(0, Math.min(1, health / max));
  const tone = frac > 0.6 ? 'is-high' : frac > 0.3 ? 'is-mid' : 'is-low';
  const gem = compact ? 18 : 22;
  return (
    <span className={clsx('tl-hpbar', compact && 'is-compact', dead && 'is-dead')}>
      <span className="tl-hpbar__track">
        <span className={clsx('tl-hpbar__fill', tone)} style={{ width: `${frac * 100}%` }} />
      </span>
      <StatGem kind="hp" value={dead ? 0 : health} size={gem} className="tl-hpbar__num" title={`${health} health`} />
      {armor > 0 && !dead ? <StatGem kind="armor" value={armor} size={gem - 2} className="tl-hpbar__armor" title={`${armor} armor`} /> : null}
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
  const gid = `tl-spark-${color.replace('#', '')}`;
  return (
    <svg className="tl-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${x(last.turn)},${height} L${x(points[0].turn)},${height} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.turn)} cy={y(last.value)} r="2.6" fill={color} stroke="#1a0e04" strokeWidth="1" />
    </svg>
  );
}

/** Small engraved medallion: tribe-coloured enamel, brass bezel and the tribe glyph. */
export function TribeEmblem({ tribe, size = 16, className, title }: { tribe: Tribe | 'NEUTRAL'; size?: number; className?: string; title?: string }) {
  return (
    <span className={clsx('tl-emblem', className)} style={{ '--c': tribeColor(tribe), width: size, height: size } as React.CSSProperties} title={title} aria-hidden={!title}>
      <svg viewBox="0 0 16 16" width={Math.round(size * 0.68)} height={Math.round(size * 0.68)}>
        <path d={TRIBE_GLYPHS[tribe] ?? TRIBE_GLYPHS.NEUTRAL} />
      </svg>
    </span>
  );
}

export function TribeChip({ tribe, compact, muted, onClick, active }: { tribe: Tribe | 'NEUTRAL'; compact?: boolean; muted?: boolean; onClick?: () => void; active?: boolean }) {
  const c = tribeColor(tribe);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={clsx('tl-tribe', compact && 'is-compact', muted && 'is-muted', onClick && 'is-button', active && 'is-active')}
      style={{ '--c': c, '--c-bg': alpha(c, 0.14), '--c-border': alpha(c, 0.45) } as React.CSSProperties}
      onClick={onClick}
      title={tribeLabel(tribe)}
      type={onClick ? 'button' : undefined}
    >
      <TribeEmblem tribe={tribe} size={compact ? 15 : 17} />
      <span className="tl-tribe__label">{compact ? TRIBE_SHORT[tribe] : tribeLabel(tribe)}</span>
    </Tag>
  );
}

export function PlacementBadge({ place, size = 'md', duos }: { place?: number; size?: 'sm' | 'md' | 'lg' | 'xl'; duos?: boolean }) {
  const c = placementColor(place, duos);
  return (
    <span className={clsx('tl-place', `tl-place--${size}`, `is-${placementTone(place, duos)}`)} style={{ '--c': c } as React.CSSProperties}>
      {place ? (
        size === 'xl' ? (
          <>
            <span className="tl-place__n">{place}</span>
            <span className="tl-place__suffix">{ordinal(place).slice(String(place).length)}</span>
          </>
        ) : (
          ordinal(place)
        )
      ) : (
        '—'
      )}
    </span>
  );
}

export function PlacementPips({ placements, size = 14 }: { placements: number[]; size?: number }) {
  return (
    <span className="tl-pips">
      {placements.map((p, i) => (
        <span key={i} className="tl-pip" style={{ width: size, height: size, fontSize: size * 0.64, '--c': placementColor(p) } as React.CSSProperties} title={ordinal(p)}>
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
      <Gem tone={result === 'won' ? 'win' : result === 'lost' ? 'loss' : 'tie'} size={size === 'sm' ? 8 : 9} />
      {letter}
      {damage ? <span className="tl-result__dmg">{result === 'lost' ? '−' : '+'}{damage}</span> : null}
    </span>
  );
}

/** Community hero tier (S..D) as an enamelled crest. */
export function HeroTierBadge({ tier, size = 'md' }: { tier?: HeroStat['tier']; size?: 'sm' | 'md' | 'lg' }) {
  const c = tier ? TIER_COLORS[tier] : '#7d7466';
  return (
    <span className={clsx('tl-herotier', `tl-herotier--${size}`, !tier && 'is-none')} style={{ '--c': c } as React.CSSProperties} title={tier ? `Tier ${tier}` : 'No tier'}>
      <span>{tier ?? '?'}</span>
    </span>
  );
}

/** Win / tie / loss as a tug-of-war: green pulls from the left, red from the right. */
export function OddsBar({ result, height = 22, labels = true }: { result: Pick<BattleSimResult, 'win' | 'tie' | 'loss'>; height?: number; labels?: boolean }) {
  const total = Math.max(0.0001, result.win + result.tie + result.loss);
  const knot = ((result.win + result.tie / 2) / total) * 100;
  const seg = (v: number, cls: string, label: string) =>
    v > 0 ? (
      <span className={clsx('tl-odds__seg', cls)} style={{ flexGrow: v }} title={`${label} ${v.toFixed(1)}%`}>
        {labels && v >= 9 ? `${v.toFixed(v >= 99.95 || v < 10 ? 0 : 1)}%` : ''}
      </span>
    ) : null;
  return (
    <span className={clsx('tl-odds', height < 10 && 'is-slim')} style={{ height }}>
      <span className="tl-odds__track">
        {seg(result.win, 'is-win', 'Win')}
        {seg(result.tie, 'is-tie', 'Tie')}
        {seg(result.loss, 'is-loss', 'Loss')}
      </span>
      <span className="tl-odds__knot" style={{ left: `${Math.max(2, Math.min(98, knot))}%` }} />
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
