import { useState } from 'react';
import clsx from 'clsx';
import type { AppStatus } from '@shared/types';
import { useApp } from '../../store/appStore';
import { CheckIcon, WarningIcon, CrossIcon } from '../../components/Icons';
import { Card } from '../ui';

type Level = 'ok' | 'warn' | 'bad' | 'idle';

function Check({ level, title, detail, action }: { level: Level; title: string; detail: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={clsx('tl-check', `is-${level}`)}>
      <span className="tl-check__icon">
        {level === 'ok' ? <CheckIcon size={13} /> : level === 'bad' ? <CrossIcon size={12} /> : level === 'warn' ? <WarningIcon size={13} /> : <span className="tl-check__dash" />}
      </span>
      <div className="tl-check__text">
        <span className="tl-check__title">{title}</span>
        <span className="tl-check__detail">{detail}</span>
      </div>
      {action ? <div className="tl-check__action">{action}</div> : null}
    </div>
  );
}

const LOG_CONFIG: Record<AppStatus['logConfig'], [Level, string]> = {
  ok: ['ok', 'Power logging is enabled.'],
  updated: ['warn', 'log.config was updated — restart Hearthstone to apply.'],
  'missing-restart-required': ['bad', 'Power logging is not enabled yet.'],
  error: ['bad', 'Could not read or write log.config.'],
  unknown: ['idle', 'Not checked yet.'],
};

function shortPath(p?: string): string | undefined {
  if (!p) return p;
  const parts = p.split(/[\\/]/);
  return parts.length > 4 ? `…${p.includes('\\') ? '\\' : '/'}${parts.slice(-3).join(p.includes('\\') ? '\\' : '/')}` : p;
}

/** Hearthstone install, log.config, Power.log, game window and card data, with fixes. */
export function SetupChecks({ className }: { className?: string }) {
  const status = useApp((s) => s.status);
  const bridge = useApp((s) => s.bridge);
  const [fixing, setFixing] = useState(false);
  const fix = async () => {
    if (!bridge) return;
    setFixing(true);
    try {
      await bridge.fixLogConfig();
    } finally {
      setFixing(false);
    }
  };
  const [lcLevel, lcText] = LOG_CONFIG[status?.logConfig ?? 'unknown'];
  const gw = status?.gameWindow;
  return (
    <Card title="Setup checks" className={className}>
          <div className="tl-checks">
            <Check
              level={status?.hearthstoneRunning ? 'ok' : status?.hearthstoneInstallPath ? 'idle' : 'bad'}
              title="Hearthstone"
              detail={
                status?.hearthstoneRunning
                  ? `Running · ${shortPath(status.hearthstoneInstallPath) ?? 'install found'}`
                  : status?.hearthstoneInstallPath
                    ? `Installed at ${shortPath(status.hearthstoneInstallPath)} · not running`
                    : 'Install not found — set the path in Settings.'
              }
            />
            <Check
              level={lcLevel}
              title="log.config"
              detail={lcText}
              action={
                status && status.logConfig !== 'ok' && status.logConfig !== 'updated' ? (
                  <button className="tl-btn tl-btn--gold" onClick={fix} disabled={fixing}>
                    {fixing ? 'Fixing…' : 'Fix'}
                  </button>
                ) : null
              }
            />
            <Check
              level={status?.powerLogPath ? 'ok' : status?.watching ? 'warn' : 'idle'}
              title="Power.log"
              detail={status?.powerLogPath ? <span title={status.powerLogPath}>Tailing {shortPath(status.powerLogPath)}</span> : 'Waiting for Hearthstone to write a log.'}
            />
            <Check
              level={gw?.found ? (gw.minimized ? 'warn' : 'ok') : 'idle'}
              title="Game window"
              detail={
                gw?.found
                  ? `${gw.focused ? 'Focused' : gw.minimized ? 'Minimized' : 'In background'}${gw.bounds ? ` · ${gw.bounds.width}×${gw.bounds.height}` : ''}`
                  : 'Not detected — the overlay appears when it is.'
              }
            />
            <Check
              level={status?.cardData.cards ? 'ok' : 'warn'}
              title="Card data"
              detail={status ? `Patch ${status.cardData.patch ?? '?'} · build ${status.cardData.build} · ${status.cardData.cards.toLocaleString()} cards (${status.cardData.source})` : '—'}
            />
          </div>
          {status?.errors.length ? (
            <div className="tl-errors">
              {status.errors.map((e, i) => (
                <div key={i} className="tl-errors__item">
                  <WarningIcon size={12} /> {e}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
  );
}

/** Problems that stop Tavern Lens from following games (empty when all is well). */
export function setupProblems(status: AppStatus | undefined): string[] {
  if (!status) return [];
  const out: string[] = [];
  if (!status.hearthstoneInstallPath) out.push('Hearthstone install not found');
  if (status.logConfig === 'missing-restart-required' || status.logConfig === 'error') out.push('Power logging is not enabled');
  if (status.logConfig === 'updated') out.push('Restart Hearthstone once to start logging');
  if (status.errors.length) out.push(status.errors[status.errors.length - 1]);
  return out;
}

/** One-line warning on the Overview page when setup needs attention. */
export function SetupNotice() {
  const status = useApp((s) => s.status);
  const problems = setupProblems(status ?? undefined);
  if (!problems.length) return null;
  return (
    <div className="tl-setup-notice">
      <WarningIcon size={14} />
      <span>{problems.join(' · ')}</span>
      <button className="tl-btn tl-btn--gold" onClick={() => (window.location.hash = 'settings')}>
        Open setup checks
      </button>
    </div>
  );
}
