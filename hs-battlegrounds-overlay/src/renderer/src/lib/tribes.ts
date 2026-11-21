import { LOBBY_TRIBES, TRIBE_LABELS, type Tribe } from '@shared/types';

/** Tribe colour palette (distinct hues around the wheel, tuned for dark panels). */
export const TRIBE_COLORS: Record<Tribe | 'NEUTRAL', string> = {
  DRAGON: '#e5534b',
  ELEMENTAL: '#f0883e',
  BEAST: '#c4934a',
  QUILBOAR: '#e66fa9',
  MURLOC: '#4cc76f',
  NAGA: '#2fb8bd',
  PIRATE: '#4a86e8',
  ABERRATION: '#8466f0',
  DEMON: '#b84fd8',
  MECHANICAL: '#8fa1b8',
  UNDEAD: '#c9cfdd',
  ALL: '#f2c14e',
  NEUTRAL: '#8f8778',
};

export const TRIBE_SHORT: Record<Tribe | 'NEUTRAL', string> = {
  DRAGON: 'DRG',
  ELEMENTAL: 'ELE',
  BEAST: 'BST',
  QUILBOAR: 'QUI',
  MURLOC: 'MUR',
  NAGA: 'NAG',
  PIRATE: 'PIR',
  ABERRATION: 'ABR',
  DEMON: 'DEM',
  MECHANICAL: 'MEC',
  UNDEAD: 'UND',
  ALL: 'ALL',
  NEUTRAL: 'NEU',
};

export function tribeLabel(t: Tribe | 'NEUTRAL'): string {
  return t === 'NEUTRAL' ? 'Neutral' : TRIBE_LABELS[t];
}

export function tribeColor(t: Tribe | 'NEUTRAL' | undefined): string {
  return TRIBE_COLORS[t ?? 'NEUTRAL'] ?? TRIBE_COLORS.NEUTRAL;
}

/** Primary tribe used for colouring (first non-ALL tribe, else ALL, else neutral). */
export function primaryTribe(tribes: Tribe[] | undefined): Tribe | 'NEUTRAL' {
  if (!tribes || tribes.length === 0) return 'NEUTRAL';
  return tribes.find((t) => t !== 'ALL') ?? 'ALL';
}

export { LOBBY_TRIBES };

/** Hex colour -> rgba() with alpha. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Darken/lighten a hex colour by mixing with black/white (amount -1..1). */
export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const mix = (c: number) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}
