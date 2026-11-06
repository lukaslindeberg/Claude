import clsx from 'clsx';
import { useApp } from '../store/appStore';
import { hash } from '../lib/format';
import { CardArt } from './CardArt';

const HERO_HUES = ['#c2563f', '#b8843a', '#6f8f3e', '#3f8f86', '#3f6a9f', '#6b4fa3', '#9a3f7d', '#a35a3a', '#4d7f5a', '#7a6a45'];

export interface HeroPortraitProps {
  cardId: string;
  name?: string;
  size?: number;
  shape?: 'circle' | 'rounded';
  dead?: boolean;
  className?: string;
  ring?: string;
  children?: React.ReactNode;
}

/** Hero portrait with art crop or a warm gradient + initials fallback. */
export function HeroPortrait({ cardId, name, size = 40, shape = 'circle', dead, className, ring, children }: HeroPortraitProps) {
  const db = useApp((s) => s.cardDb);
  const displayName = name ?? db.name(cardId);
  const hue = HERO_HUES[hash(db.baseHeroId(cardId)) % HERO_HUES.length];
  return (
    <span
      className={clsx('tl-hero', `tl-hero--${shape}`, dead && 'is-dead', className)}
      style={{ width: size, height: size, '--ring': ring } as React.CSSProperties}
    >
      <CardArt cardId={cardId} name={displayName} hue={hue} className="tl-hero__art" initialsSize={Math.max(10, Math.round(size * 0.36))} />
      {children}
    </span>
  );
}
