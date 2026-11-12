import { useEffect, useState, type ComponentType } from 'react';
import clsx from 'clsx';
import { useApp } from '../store/appStore';
import { NAV_ICONS } from '../components/Icons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Overview } from './sections/Overview';
import { Matches } from './sections/Matches';
import { Heroes } from './sections/Heroes';
import { Trinkets } from './sections/Trinkets';
import { SettingsSection } from './sections/SettingsSection';
import { About } from './sections/About';
import '../styles/companion.css';

export type SectionId = 'overview' | 'matches' | 'heroes' | 'trinkets' | 'settings';

function SettingsPage() {
  return (
    <>
      <SettingsSection />
      <About />
    </>
  );
}

const SECTIONS: { id: SectionId; label: string; Component: ComponentType }[] = [
  { id: 'overview', label: 'Overview', Component: Overview },
  { id: 'matches', label: 'Matches', Component: Matches },
  { id: 'heroes', label: 'Heroes', Component: Heroes },
  { id: 'trinkets', label: 'Trinkets', Component: Trinkets },
  { id: 'settings', label: 'Settings', Component: SettingsPage },
];

/** Links from older versions (and the tray menu) still land on the merged pages. */
const ALIASES: Record<string, SectionId> = { history: 'matches', stats: 'matches', about: 'settings', diagnostics: 'settings', minions: 'overview' };

function fromHash(): SectionId {
  const h = window.location.hash.replace('#', '');
  return SECTIONS.find((s) => s.id === h)?.id ?? ALIASES[h] ?? 'overview';
}

export function navigate(id: SectionId) {
  window.location.hash = id;
}

export default function CompanionApp() {
  const [section, setSection] = useState<SectionId>(fromHash);
  const status = useApp((s) => s.status);
  const game = useApp((s) => s.game);
  const historyCount = useApp((s) => s.history.length);
  const demo = useApp((s) => s.demo);

  useEffect(() => {
    const on = () => setSection(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--tl-scale', '1');
    document.documentElement.style.setProperty('--tl-alpha', '1');
  }, []);

  const current = SECTIONS.find((s) => s.id === section)!;
  const live = !!game?.active && game.phase !== 'gameOver';
  const watching = status?.watching;
  return (
    <div className="tl-app">
      <aside className="tl-nav">
        <div className="tl-brand">
          <span className="tl-brand__mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="30" height="30">
              <defs>
                <linearGradient id="tl-brand-g" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#ffe08a" />
                  <stop offset="1" stopColor="#c8922f" />
                </linearGradient>
              </defs>
              <path d="M16 2 28 9v14l-12 7L4 23V9l12-7Z" fill="#2a1a0e" stroke="url(#tl-brand-g)" strokeWidth="2" />
              <circle cx="16" cy="16" r="6.2" fill="none" stroke="url(#tl-brand-g)" strokeWidth="2" />
              <circle cx="16" cy="16" r="2.2" fill="#ffe08a" />
            </svg>
          </span>
          <span className="tl-brand__text">
            <span className="tl-brand__name">Tavern Lens</span>
            <span className="tl-brand__sub">Battlegrounds companion</span>
          </span>
        </div>
        <nav className="tl-nav__list">
          {SECTIONS.map(({ id, label }) => {
            const Icon = NAV_ICONS[id];
            return (
              <button key={id} className={clsx('tl-nav__item', id === section && 'is-active')} onClick={() => navigate(id)}>
                <Icon size={16} />
                <span>{label}</span>
                {id === 'matches' && historyCount ? <span className="tl-nav__count">{historyCount}</span> : null}
                {id === 'overview' && live ? <span className="tl-nav__live">Live</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="tl-nav__foot">
          <span className={clsx('tl-dot', watching ? 'is-ok' : 'is-off')} />
          <span className="tl-nav__status">
            {status?.demo.running ? 'Demo replay running' : watching ? (live ? 'Tracking a game' : 'Watching Power.log') : 'Not watching'}
          </span>
          {demo ? <span className="tl-nav__demo">Browser demo</span> : null}
        </div>
      </aside>
      <main className="tl-main tl-scroll" key={section}>
        <ErrorBoundary name={`companion:${section}`} label={`The ${current.label} page`} fallback="panel">
          <current.Component />
        </ErrorBoundary>
      </main>
    </div>
  );
}
