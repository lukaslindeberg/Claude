import type { MinionKeywords, Tribe } from '@shared/types';

type P = { size?: number; className?: string; title?: string };

const svg = (size: number | undefined, className: string | undefined, children: React.ReactNode, viewBox = '0 0 16 16', title?: string) => (
  <svg width={size ?? 12} height={size ?? 12} viewBox={viewBox} className={className} aria-hidden={!title} role={title ? 'img' : undefined}>
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

export const TauntIcon = ({ size, className, title }: P) =>
  svg(size, className, <path d="M8 1.2 13.6 3v4.3c0 3.6-2.4 6.3-5.6 7.5C4.8 13.6 2.4 10.9 2.4 7.3V3L8 1.2Z" fill="currentColor" />, undefined, title);

export const DivineShieldIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="3.2" fill="currentColor" opacity=".55" />
    </>,
    undefined,
    title,
  );

export const VenomIcon = ({ size, className, title }: P) =>
  svg(size, className, <path d="M8 1.5c2.6 3.5 4.4 6 4.4 8.3A4.4 4.4 0 0 1 8 14.2a4.4 4.4 0 0 1-4.4-4.4C3.6 7.5 5.4 5 8 1.5Z" fill="currentColor" />, undefined, title);

export const RebornIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <path
      d="M8 1.8a5 5 0 0 1 5 5v6.6l-1.7-1.2-1.6 1.2L8 12.2l-1.7 1.2-1.6-1.2L3 13.4V6.8a5 5 0 0 1 5-5Zm-1.9 4.4a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm3.8 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z"
      fill="currentColor"
    />,
    undefined,
    title,
  );

export const WindfuryIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <path
      d="M2 5.5h7.2a2 2 0 1 0-2-2M2 8.5h10.4a2.1 2.1 0 1 1-2.1 2.1M2 11.5h5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />,
    undefined,
    title,
  );

export const DeathrattleIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <path
      d="M8 1.6c3.3 0 5.6 2.3 5.6 5.3 0 1.8-.9 3-2 3.7v2.2c0 .6-.5 1.1-1.1 1.1H5.5c-.6 0-1.1-.5-1.1-1.1v-2.2c-1.1-.7-2-1.9-2-3.7 0-3 2.3-5.3 5.6-5.3Zm-2.4 4.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm4.8 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM8 9.6l-.8 1.4h1.6L8 9.6Z"
      fill="currentColor"
    />,
    undefined,
    title,
  );

export const StartOfCombatIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <path d="m2.5 2.5 6 6M13.5 2.5l-6 6M4 12l-1.5 1.5M12 12l1.5 1.5M5.4 10.6 3.6 12.4M10.6 10.6l1.8 1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
    undefined,
    title,
  );

export const AvengeIcon = ({ size, className, title }: P) =>
  svg(size, className, <path d="M8.6 1.4c.4 2.3 3.9 3.8 3.9 7.4A4.5 4.5 0 0 1 8 13.4a4.5 4.5 0 0 1-4.5-4.6c0-1.9 1-3.1 2-3.9.1 1.3.7 2.2 1.6 2.4-.4-2.4.4-4.4 1.5-5.9Z" fill="currentColor" />, undefined, title);

export const MagneticIcon = ({ size, className, title }: P) =>
  svg(size, className, <path d="M3 2.5h3v5a2 2 0 0 0 4 0v-5h3v5a5 5 0 0 1-10 0v-5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />, undefined, title);

export const StealthIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Zm1 5.5 11-11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
    undefined,
    title,
  );

export const CleaveIcon = ({ size, className, title }: P) =>
  svg(size, className, <path d="M3 13 10 6M8.5 2.5c2.8 0 5 2.2 5 5-1.6-.4-3-1.2-4-2.2s-1-1.7-1-2.8Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />, undefined, title);

export const StarIcon = ({ size, className, title }: P) =>
  svg(size, className, <path d="m8 1.3 1.9 4.2 4.6.5-3.4 3.1 1 4.5L8 11.3l-4.1 2.3 1-4.5L1.5 6l4.6-.5L8 1.3Z" fill="currentColor" />, undefined, title);

export const ShieldIcon = TauntIcon;

export const ChevronIcon = ({ size, className, dir = 'down' }: P & { dir?: 'down' | 'up' | 'left' | 'right' }) => {
  const rot = { down: 0, up: 180, left: 90, right: -90 }[dir];
  return svg(size, className, <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${rot} 8 8)`} />);
};

export const CloseIcon = ({ size, className }: P) =>
  svg(size, className, <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />);

export const SearchIcon = ({ size, className }: P) =>
  svg(size, className, <path d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm3.3 7.8 3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />);

export const GripIcon = ({ size, className }: P) =>
  svg(
    size,
    className,
    <g fill="currentColor">
      {[4, 8, 12].map((y) => (
        <g key={y}>
          <circle cx="6" cy={y} r="1.1" />
          <circle cx="10" cy={y} r="1.1" />
        </g>
      ))}
    </g>,
  );

export const WarningIcon = ({ size, className }: P) =>
  svg(size, className, <path d="M8 1.8 15 14H1L8 1.8Zm0 4.2v4m0 1.6v.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />);

export const CheckIcon = ({ size, className }: P) =>
  svg(size, className, <path d="m3 8.5 3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />);

export const CrossIcon = CloseIcon;

export const SwordIcon = ({ size, className }: P) =>
  svg(size, className, <path d="M13.5 2.5 6 10l-1-1-1.5 1.5 1 1L3 13l1 1 1.5-1.5 1 1L8 12l-1-1 7.5-7.5v-1h-1Z" fill="currentColor" />);

/** Crossed swords (battle). */
export const SwordsIcon = ({ size, className }: P) =>
  svg(
    size,
    className,
    <g fill="currentColor">
      <path d="M2.2 1.6 9.6 9l-1 1L1.6 2.6l.1-1Z" />
      <path d="M13.8 1.6 6.4 9l1 1 7-7.4-.1-1Z" />
      <path d="M3.4 9.9 6.1 12.6l-.9.9-.7-.4-1.6 1.6-1-1 1.6-1.6-.4-.7.9-.9Zm9.2 0-2.7 2.7.9.9.7-.4 1.6 1.6 1-1-1.6-1.6.4-.7-.9-.9Z" />
    </g>,
  );

export const CrownIcon = ({ size, className }: P) =>
  svg(size, className, <path d="M2 5.5 5 8l3-5 3 5 3-2.5-1.3 7H3.3L2 5.5Z" fill="currentColor" />);

export const TripleIcon = ({ size, className, title }: P) =>
  svg(
    size,
    className,
    <g fill="currentColor">
      <path d="M8 1.5 9.3 4.3l3 .3-2.2 2 .6 3L8 8.1 5.3 9.6l.6-3-2.2-2 3-.3L8 1.5Z" />
      <circle cx="4" cy="13" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
      <circle cx="12" cy="13" r="1.4" />
    </g>,
    undefined,
    title,
  );

export const ClockIcon = ({ size, className }: P) =>
  svg(size, className, <path d="M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2Zm0 2.8V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />);

export const PlayIcon = ({ size, className }: P) => svg(size, className, <path d="M4.5 2.8v10.4L13 8 4.5 2.8Z" fill="currentColor" />);
export const StopIcon = ({ size, className }: P) => svg(size, className, <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />);

export const NAV_ICONS = {
  overview: (p: P) =>
    svg(p.size, p.className, <path d="M2 2h5v6H2zM9 2h5v3H9zM9 7h5v7H9zM2 10h5v4H2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />),
  history: (p: P) =>
    svg(p.size, p.className, <path d="M2.6 8A5.4 5.4 0 1 0 4.2 4.2M2.5 2v2.6h2.6M8 5v3l2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />),
  stats: (p: P) => svg(p.size, p.className, <path d="M2.5 13.5h11M4 11V8M7 11V4.5M10 11V6.5M13 11V3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />),
  heroes: (p: P) => svg(p.size, p.className, <path d="M8 2.2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM2.8 14c.5-2.8 2.6-4.3 5.2-4.3s4.7 1.5 5.2 4.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />),
  minions: (p: P) => svg(p.size, p.className, <ellipse cx="8" cy="8" rx="4.6" ry="6" fill="none" stroke="currentColor" strokeWidth="1.4" />),
  trinkets: (p: P) =>
    svg(p.size, p.className, <path d="M8 1.8 13.4 6 8 14.2 2.6 6 8 1.8ZM2.6 6h10.8M5.6 6 8 14.2 10.4 6M5.6 6 8 1.8 10.4 6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />),
  settings: (p: P) =>
    svg(
      p.size,
      p.className,
      <path
        d="M8 5.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8ZM8 1.5l1.2 1.6 2-.4.4 2 1.6 1.2-.9 1.9.9 1.9-1.6 1.2-.4 2-2-.4L8 14.5l-1.2-1.6-2 .4-.4-2-1.6-1.2.9-1.9-.9-1.9 1.6-1.2.4-2 2 .4L8 1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />,
    ),
  about: (p: P) => svg(p.size, p.className, <path d="M8 1.8a6.2 6.2 0 1 1 0 12.4A6.2 6.2 0 0 1 8 1.8ZM8 7v4.2M8 4.6v.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />),
};

export interface KeywordInfo {
  key: keyof MinionKeywords;
  label: string;
  color: string;
  Icon: (p: P) => React.ReactElement;
}

export const KEYWORDS: KeywordInfo[] = [
  { key: 'taunt', label: 'Taunt', color: '#b9c2cf', Icon: TauntIcon },
  { key: 'divineShield', label: 'Divine Shield', color: '#ffd76a', Icon: DivineShieldIcon },
  { key: 'venomous', label: 'Venomous', color: '#7be07b', Icon: VenomIcon },
  { key: 'poisonous', label: 'Poisonous', color: '#5fd35f', Icon: VenomIcon },
  { key: 'reborn', label: 'Reborn', color: '#7fe6e0', Icon: RebornIcon },
  { key: 'windfury', label: 'Windfury', color: '#9fd4ff', Icon: WindfuryIcon },
  { key: 'megaWindfury', label: 'Mega-Windfury', color: '#c4a8ff', Icon: WindfuryIcon },
  { key: 'deathrattle', label: 'Deathrattle', color: '#c7b8ff', Icon: DeathrattleIcon },
  { key: 'startOfCombat', label: 'Start of Combat', color: '#ff9f6b', Icon: StartOfCombatIcon },
  { key: 'avenge', label: 'Avenge', color: '#ff7a7a', Icon: AvengeIcon },
  { key: 'cleave', label: 'Cleave', color: '#ffb36b', Icon: CleaveIcon },
  { key: 'magnetic', label: 'Magnetic', color: '#8fb2ff', Icon: MagneticIcon },
  { key: 'stealth', label: 'Stealth', color: '#a6a6c8', Icon: StealthIcon },
];

export const KEYWORD_BY_KEY = Object.fromEntries(KEYWORDS.map((k) => [k.key, k])) as Record<keyof MinionKeywords, KeywordInfo>;

/** Card mechanics (GameTag names) -> keyword keys. */
export const MECHANIC_KEYWORD: Record<string, keyof MinionKeywords> = {
  TAUNT: 'taunt',
  DIVINE_SHIELD: 'divineShield',
  POISONOUS: 'poisonous',
  VENOMOUS: 'venomous',
  WINDFURY: 'windfury',
  MEGA_WINDFURY: 'megaWindfury',
  REBORN: 'reborn',
  STEALTH: 'stealth',
  CLEAVE: 'cleave',
  DEATHRATTLE: 'deathrattle',
  START_OF_COMBAT: 'startOfCombat',
  AVENGE: 'avenge',
  MAGNETIC: 'magnetic',
};

export function keywordsFromMechanics(mechanics: string[]): MinionKeywords {
  const kw: MinionKeywords = {};
  for (const m of mechanics) {
    const k = MECHANIC_KEYWORD[m];
    if (k) kw[k] = true;
  }
  return kw;
}

export function KeywordIcons({ keywords, size = 12, max, exclude }: { keywords: MinionKeywords; size?: number; max?: number; exclude?: (keyof MinionKeywords)[] }) {
  const list = KEYWORDS.filter((k) => keywords[k.key] && !exclude?.includes(k.key)).slice(0, max);
  if (!list.length) return null;
  return (
    <span className="tl-kw-icons">
      {list.map(({ key, label, color, Icon }) => (
        <span key={key} className="tl-kw-icon" style={{ color }} title={label}>
          <Icon size={size} />
        </span>
      ))}
    </span>
  );
}

/**
 * Tribe glyphs (16x16, filled) engraved on the tribe emblems. Original drawings:
 * a wing, a flame, a paw, tusks, a fin, a trident, an anchor, an eye, horns, a gear,
 * a skull, a star and a plain stone for neutral.
 */
export const TRIBE_GLYPHS: Record<Tribe | 'NEUTRAL', string> = {
  DRAGON:
    'M1.6 12.8C2.4 7.6 5.2 3.6 9.8 2.2c-.9 1.1-1.3 2.2-1.3 3.4 1.3-1.2 3.1-1.8 5.4-1.8-1.1.9-1.8 2-2 3.3 1.1-.4 2.2-.4 3.1 0-1.6.6-2.8 1.7-3.4 3.2-1.7-.4-3.4-.2-5 .6-1.6.7-3.2 1.4-5 1.9Z',
  ELEMENTAL:
    'M8.6 1.2c.6 2.6 4.4 4.2 4.4 8.2A5 5 0 0 1 8 14.6 5 5 0 0 1 3 9.5c0-2 1.1-3.4 2.2-4.3.1 1.5.8 2.5 1.8 2.7-.4-2.6.4-4.9 1.6-6.7Zm-.4 7.4c-.9 1-1.6 1.9-1.6 3.1a1.5 1.5 0 0 0 3 .1c0-1.2-.6-2-1.4-3.2Z',
  BEAST:
    'M8 8.2c2.4 0 4.4 2.1 4.4 4 0 1.3-1 1.9-2.1 1.9-.9 0-1.5-.5-2.3-.5s-1.4.5-2.3.5c-1.1 0-2.1-.6-2.1-1.9 0-1.9 2-4 4.4-4ZM3.1 4.6c.9-.2 1.9.7 2.1 2s-.3 2.4-1.2 2.6-1.9-.7-2.1-2 .3-2.4 1.2-2.6Zm9.8 0c.9.2 1.4 1.3 1.2 2.6s-1.2 2.2-2.1 2-1.4-1.3-1.2-2.6 1.2-2.2 2.1-2ZM6.2 1.6c1 0 1.7 1.1 1.7 2.4S7.2 6.4 6.2 6.4 4.5 5.3 4.5 4s.7-2.4 1.7-2.4Zm3.6 0c1 0 1.7 1.1 1.7 2.4s-.7 2.4-1.7 2.4S8.1 5.3 8.1 4s.7-2.4 1.7-2.4Z',
  QUILBOAR:
    'M2.4 2.2c1.2 2.4 2.6 3.6 4.3 3.9h2.6c1.7-.3 3.1-1.5 4.3-3.9.6 3.3-.3 6-2.3 7.4l-.2 2.6c-.1 1.4-1.5 2.4-3.1 2.4S5 13.6 4.9 12.2l-.2-2.6C2.7 8.2 1.8 5.5 2.4 2.2Zm4 8.6a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm3.2 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z',
  MURLOC:
    'M1.4 8.6C2.6 5.2 5.4 3.4 8.8 3.4l1.6-2 .4 2.5c1.7.6 2.9 1.9 3.6 3.5l1-.3-.6 1.7.6 1.7-1-.3c-1 2.2-3.3 3.7-6.2 3.7-3.2 0-5.6-1.6-6.8-4.9Zm9.4-2.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  NAGA:
    'M7.2 15V7.4C5 7.1 3.4 5.6 3.2 3.2V1.4l1.4 1.3v1.1c.1 1.2.9 2.1 1.9 2.4V1.4L8 .6l1.5.8v4.8c1-.3 1.8-1.2 1.9-2.4V2.7l1.4-1.3v1.8c-.2 2.4-1.8 3.9-4 4.2V15Z',
  PIRATE:
    'M8 1.2a1.9 1.9 0 0 1 .9 3.6v1.6h2.4v1.4H8.9v5.3c1.8-.3 3.2-1.4 3.8-3l-1.2-.4 2.6-1.8.6 3.2-1-.5C12.8 13 10.6 14.8 8 14.8S3.2 13 2.3 10.6l-1 .5.6-3.2 2.6 1.8-1.2.4c.6 1.6 2 2.7 3.8 3V7.8H4.7V6.4h2.4V4.8A1.9 1.9 0 0 1 8 1.2Z',
  ABERRATION:
    'M8 3.6c3.6 0 6.2 2.6 7 4.4-.8 1.8-3.4 4.4-7 4.4S1.8 9.8 1 8c.8-1.8 3.4-4.4 7-4.4Zm0 1.6a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0 1.5a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z',
  DEMON:
    'M1.6 1.4c.3 2.6 1.4 4.3 3.1 5.1A4.4 4.4 0 0 0 3.6 9.4C3.6 12.4 5.6 14.8 8 14.8s4.4-2.4 4.4-5.4c0-1.1-.4-2.1-1.1-2.9 1.7-.8 2.8-2.5 3.1-5.1-1.3 1.6-3 2.4-5.1 2.6H6.7C4.6 3.8 2.9 3 1.6 1.4ZM6 8.6l1.3 1.1L6 10.4Zm4 0v1.8l-1.3-.7Z',
  MECHANICAL:
    'M7 .9h2l.4 1.9 1.3.5 1.6-1.1 1.4 1.4-1.1 1.6.5 1.3 1.9.4v2l-1.9.4-.5 1.3 1.1 1.6-1.4 1.4-1.6-1.1-1.3.5L9 15.1H7l-.4-1.9-1.3-.5-1.6 1.1-1.4-1.4 1.1-1.6-.5-1.3L.9 9V7l1.9-.4.5-1.3-1.1-1.6 1.4-1.4 1.6 1.1 1.3-.5Zm1 4.6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  UNDEAD:
    'M8 1.4c3.4 0 5.8 2.4 5.8 5.4 0 1.8-.9 3.1-2 3.9v2.4c0 .7-.5 1.2-1.2 1.2H5.4c-.7 0-1.2-.5-1.2-1.2v-2.4c-1.1-.8-2-2.1-2-3.9 0-3 2.4-5.4 5.8-5.4ZM5.6 6.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm4.8 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8ZM8 9.6l-.9 1.6h1.8Z',
  ALL: 'm8 1 2.1 4.5 4.9.6-3.6 3.4 1 4.9L8 11.9l-4.4 2.5 1-4.9L1 6.1l4.9-.6Z',
  NEUTRAL: 'M8 2.2 13.4 8 8 13.8 2.6 8Z',
};
