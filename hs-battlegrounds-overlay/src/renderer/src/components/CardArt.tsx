import { useState } from 'react';
import clsx from 'clsx';
import { cardArt } from '@core/cards/cardDb';
import type { Tribe } from '@shared/types';
import { useApp } from '../store/appStore';
import { hash, initials } from '../lib/format';
import { primaryTribe, shade, tribeColor } from '../lib/tribes';

/** URLs that failed to load this session (avoid hammering a blocked host). */
const failed = new Set<string>();
let loadedCount = 0;
/** After several failures and no success at all, assume the art host is unreachable. */
const hostDown = () => loadedCount === 0 && failed.size >= 8;

export function useImagesEnabled(): boolean {
  return useApp((s) => s.settings.cardImages);
}

/** Background for the art fallback: tribe gradient with a per-card twist. */
export function fallbackBackground(seed: string, tribes: Tribe[] | undefined, hueOverride?: string): string {
  const h = hash(seed);
  const t1 = primaryTribe(tribes);
  const c1 = hueOverride ?? tribeColor(t1);
  const second = tribes && tribes.length > 1 ? tribeColor(tribes.find((t) => t !== t1 && t !== 'ALL') ?? 'ALL') : undefined;
  const light = shade(c1, 0.18 + ((h >> 3) % 10) / 100);
  const dark = shade(c1, -0.62 - ((h >> 7) % 8) / 100);
  const angle = 120 + (h % 90);
  const cx = 30 + ((h >> 11) % 40);
  const glow = `radial-gradient(circle at ${cx}% 28%, ${shade(light, 0.25)}cc 0%, transparent 46%)`;
  const rings = `repeating-radial-gradient(circle at ${cx}% 120%, rgba(255,255,255,0.05) 0 2px, transparent 2px 9px)`;
  const base = second
    ? `linear-gradient(${angle}deg, ${shade(c1, -0.15)} 0%, ${shade(c1, -0.45)} 48%, ${shade(second, -0.45)} 52%, ${shade(second, -0.2)} 100%)`
    : `linear-gradient(${angle}deg, ${light} 0%, ${c1} 32%, ${dark} 100%)`;
  return `${glow}, ${rings}, ${base}`;
}

export interface CardArtProps {
  cardId: string;
  /** Card id whose art is shown (e.g. the normal version of a golden card). */
  artId?: string;
  name: string;
  tribes?: Tribe[];
  className?: string;
  /** Font size of the fallback initials (px). */
  initialsSize?: number;
  hue?: string;
  showInitials?: boolean;
}

/** Art crop from HearthstoneJSON with a polished gradient/initials fallback. */
export function CardArt({ cardId, artId, name, tribes, className, initialsSize, hue, showInitials = true }: CardArtProps) {
  const images = useImagesEnabled();
  const url = cardArt.crop(artId ?? cardId);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(() => failed.has(url) || hostDown());
  const showImg = images && !error;
  return (
    <span className={clsx('tl-art', className)} style={{ background: fallbackBackground(cardId, tribes, hue) }}>
      {showInitials && !(showImg && loaded) ? (
        <span className="tl-art__initials" style={initialsSize ? { fontSize: initialsSize } : undefined}>
          {initials(name)}
        </span>
      ) : null}
      {showImg ? (
        <img
          className={clsx('tl-art__img', loaded && 'is-loaded')}
          src={url}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            loadedCount++;
            setLoaded(true);
          }}
          onError={() => {
            failed.add(url);
            setError(true);
          }}
        />
      ) : null}
    </span>
  );
}

/** Full card render image (tooltips) — null when images disabled or failed. */
export function CardRender({ cardId, className }: { cardId: string; className?: string }) {
  const images = useImagesEnabled();
  const url = cardArt.bgsRender(cardId);
  const [error, setError] = useState(() => failed.has(url) || hostDown());
  const [loaded, setLoaded] = useState(false);
  if (!images || error) return null;
  return (
    <img
      className={clsx('tl-card-render', loaded && 'is-loaded', className)}
      src={url}
      alt=""
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={() => {
        loadedCount++;
        setLoaded(true);
      }}
      onError={() => {
        failed.add(url);
        setError(true);
      }}
    />
  );
}
