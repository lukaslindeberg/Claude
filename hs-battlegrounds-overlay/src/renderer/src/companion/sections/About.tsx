import { useApp } from '../../store/appStore';
import { Card } from '../ui';
import { DiagnosticsCard } from './Diagnostics';

const LINKS: [string, string][] = [
  ['HearthSim hsdata', 'https://github.com/HearthSim/hsdata'],
  ['HearthstoneJSON', 'https://hearthstonejson.com'],
];

export function About() {
  const status = useApp((s) => s.status);
  const db = useApp((s) => s.cardDb);
  const bridge = useApp((s) => s.bridge);
  return (
    <div className="tl-section tl-section--sub">
      <h2 className="tl-subhead">About &amp; diagnostics</h2>
      <div className="tl-about">
        <Card className="tl-about__hero">
          <div className="tl-about__brand">
            <span className="tl-about__name">Tavern Lens</span>
            <span className="tl-muted">Version {status?.version ?? '1.0.0'} · {status?.platform ?? 'unknown platform'}</span>
          </div>
          <p>
            A Hearthstone Battlegrounds companion: opponent boards, combat odds, hero and trinket rankings
            and session tracking. It reads the game's own log file and never touches the game's memory or network traffic.
          </p>
          <dl className="tl-about__facts">
            <dt>Card data</dt>
            <dd>
              Patch {db.patch ?? '?'} · build {db.build} · {db.size.toLocaleString()} cards ({db.data.source})
            </dd>
            <dt>Logs</dt>
            <dd>{status?.logsPath ?? 'Not found yet'}</dd>
          </dl>
        </Card>
        <DiagnosticsCard className="tl-about__diag" />
        <Card title="Credits">
          <ul className="tl-about__list">
            <li>Card definitions from HearthSim's hsdata; card art from HearthstoneJSON.</li>
            <li>Display typeface Fraunces and UI typeface Archivo (SIL Open Font License). Frames, gems and icons are original artwork.</li>
            <li>Replay fixtures from HSReplay test data (see the license in the repository).</li>
          </ul>
          <div className="tl-about__links">
            {LINKS.map(([label, url]) => (
              <button key={url} className="tl-btn" onClick={() => bridge?.openExternal(url)}>
                {label}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Disclaimer">
          <p className="tl-muted">
            Tavern Lens is a fan-made tool and is not affiliated with or endorsed by Blizzard Entertainment. Hearthstone and
            Battlegrounds are trademarks of Blizzard Entertainment, Inc. Simulation results are estimates.
          </p>
          <button className="tl-btn tl-btn--danger" onClick={() => bridge?.quit()}>
            Quit Tavern Lens
          </button>
        </Card>
      </div>
    </div>
  );
}
