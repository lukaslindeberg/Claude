import clsx from 'clsx';
import { useApp } from '../store/appStore';
import { hash } from '../lib/format';
import { CardArt } from './CardArt';
import { StatGem, TierBadge } from './Bits';

const HERO_HUES = ['#c2563f', '#b8843a', '#6f8f3e', '#3f8f86', '#3f6a9f', '#6b4fa3', '#9a3f7d', '#a35a3a', '#4d7f5a', '#7a6a45'];

export interface HeroPortraitProps {
  cardId: string;
  name?: string;
  size?: number;
  shape?: 'circle' | 'rounded';
  dead?: boolean;
  className?: string;
  /** Custom frame glow colour. */
  ring?: string;
  /** Leaderboard-style highlight: next opponent (gold), current fight (red), you (green). */
  glow?: 'next' | 'fighting' | 'local';
  /** Health in a red drop at the bottom (and armor in a steel shield beside it). */
  health?: number;
  armor?: number;
  /** Tavern tier shield in the top-left corner. */
  tier?: number;
  /** Triples as golden pips along the top. */
  triples?: number;
  children?: React.ReactNode;
}

/** Hero portrait in an ornate gold frame; art crop or a warm gradient + initials fallback. */
export function HeroPortrait({ cardId, name, size = 40, shape = 'circle', dead, className, ring, glow, health, armor, tier, triples, children }: HeroPortraitProps) {
  const db = useApp((s) => s.cardDb);
  const displayName = name ?? db.name(cardId);
  const hue = HERO_HUES[hash(db.baseHeroId(cardId)) % HERO_HUES.length];
  const frame = size >= 70 ? 4 : size >= 46 ? 3 : size >= 28 ? 2 : 1.5;
  const gem = Math.max(15, Math.round(size * 0.36));
  return (
    <span
      className={clsx('tl-hero', `tl-hero--${shape}`, dead && 'is-dead', glow && `is-${glow}`, ring && 'has-ring', size < 28 && 'is-tiny', className)}
      style={{ width: size, height: size, '--ring': ring, '--fw': `${frame}px` } as React.CSSProperties}
    >
      <CardArt cardId={cardId} name={displayName} hue={hue} className="tl-hero__art" initialsSize={Math.max(10, Math.round(size * 0.36))} />
      {dead ? <span className="tl-hero__crack" /> : null}
      {tier && !dead ? <TierBadge tier={tier} size={Math.max(13, Math.round(size * 0.3))} className="tl-hero__tier" /> : null}
      {triples ? (
        <span className="tl-hero__triples" title={`${triples} triple${triples === 1 ? '' : 's'}`}>
          {Array.from({ length: Math.min(triples, 5) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      ) : null}
      {health !== undefined && !dead ? (
        <span className="tl-hero__stats">
          <StatGem kind="hp" value={health} size={gem} />
          {armor ? <StatGem kind="armor" value={armor} size={gem - 2} /> : null}
        </span>
      ) : null}
      {children}
    </span>
  );
}
