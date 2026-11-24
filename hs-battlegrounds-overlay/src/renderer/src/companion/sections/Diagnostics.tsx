import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { DiagnosticsExportResult } from '@shared/types';
import { useApp } from '../../store/appStore';
import { Toggle } from '../../components/Bits';
import { WarningIcon } from '../../components/Icons';
import { Card } from '../ui';

type ExportState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: DiagnosticsExportResult }
  | { phase: 'error'; error: string };

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function size(bytes: number | undefined): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Diagnostics: where the log lives, "Export diagnostics" (one zip to attach in a chat
 * with the developer), verbose logging, and the errors logged this session.
 */
export function DiagnosticsCard({ className }: { className?: string }) {
  const diag = useApp((s) => s.status?.diagnostics);
  const verbose = useApp((s) => !!s.settings.verboseLogging);
  const includeSetting = useApp((s) => s.settings.exportIncludeGameLogs !== false);
  const update = useApp((s) => s.updateSettings);
  const bridge = useApp((s) => s.bridge);
  const [include, setInclude] = useState(includeSetting);
  const [state, setState] = useState<ExportState>({ phase: 'idle' });
  useEffect(() => setInclude(includeSetting), [includeSetting]);

  const runExport = async () => {
    if (!bridge || state.phase === 'running') return;
    setState({ phase: 'running' });
    try {
      const result = await bridge.exportDiagnostics({ includeGameLogs: include });
      setState(result.ok ? { phase: 'done', result } : { phase: 'error', error: result.error ?? 'The export failed.' });
    } catch (err) {
      setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const errors = diag?.errorCount ?? 0;
  const warnings = diag?.warnCount ?? 0;
  const recent = [...(diag?.recentErrors ?? [])].reverse();
  return (
    <Card
      title="Diagnostics"
      className={clsx('tl-diag', className)}
      extra={
        <span className={clsx('tl-diag__count', errors ? 'is-bad' : 'is-ok')}>
          {errors ? `${errors} error${errors > 1 ? 's' : ''} this session` : 'No errors this session'}
        </span>
      }
    >
      <p className="tl-diag__intro">
        Tavern Lens keeps a detailed log while you play. If something looked wrong (a wrong board, odd simulator odds, the
        overlay in the wrong place), export the diagnostics afterwards and attach the zip in your chat with the developer.
      </p>

      <div className="tl-diag__grid">
        <section className="tl-diag__block">
          <h3 className="tl-diag__label">Export</h3>
          <label className="tl-diag__check">
            <input type="checkbox" checked={include} disabled={state.phase === 'running'} onChange={(e) => setInclude(e.target.checked)} />
            <span>
              Include Hearthstone game logs
              <span className="tl-diag__hint">Power.log of your latest session, so your games can be replayed exactly.</span>
            </span>
          </label>
          <div className="tl-diag__actions">
            <button className="tl-btn tl-btn--gold" onClick={() => void runExport()} disabled={!bridge || state.phase === 'running'}>
              {state.phase === 'running' ? (
                <>
                  <span className="tl-diag__spinner" aria-hidden /> Packing…
                </>
              ) : (
                'Export diagnostics'
              )}
            </button>
            {state.phase === 'running' ? <span className="tl-muted tl-small">Collecting logs, this can take a few seconds.</span> : null}
          </div>
          {state.phase === 'done' && state.result.path ? (
            <div className="tl-diag__result" role="status">
              <span className="tl-diag__ok">Saved {size(state.result.bytes)}</span>
              <code className="tl-diag__path" title={state.result.path}>
                {state.result.path}
              </code>
              <button className="tl-btn" onClick={() => bridge?.showItemInFolder(state.result.path!)}>
                Show in folder
              </button>
              {state.result.notes?.length ? (
                <ul className="tl-diag__notes">
                  {state.result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {state.phase === 'error' ? (
            <div className="tl-diag__result is-error" role="alert">
              Export failed: {state.error}
            </div>
          ) : null}
          <p className="tl-diag__privacy">
            <WarningIcon size={13} />
            <span>
              The export contains your BattleTag and the names of opponents you played against (they are in the game logs and
              your match history). Nothing is uploaded: you decide who gets the file.
            </span>
          </p>
        </section>

        <section className="tl-diag__block">
          <h3 className="tl-diag__label">Log files</h3>
          <div className="tl-settings__path">
            <input className="tl-input" readOnly value={diag?.logsDir ?? ''} placeholder="Unknown" title={diag?.logsDir} />
            <button className="tl-btn" onClick={() => void bridge?.openLogsFolder()} disabled={!bridge}>
              Open logs folder
            </button>
          </div>
          <Toggle
            checked={verbose}
            onChange={(v) => void update({ verboseLogging: v })}
            label="Verbose logging"
            hint="Records extra detail (mouse capture changes, every state change). Turn it on while reproducing a problem; the log stays under 25 MB."
          />
          <div className="tl-diag__errors">
            <span className="tl-diag__label">
              Logged this session: {errors} error{errors === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}
            </span>
            {recent.length ? (
              <ul className="tl-diag__errlist">
                {recent.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="tl-diag__err">
                    <span className="tl-diag__errtime">{time(e.at)}</span>
                    <span className="tl-diag__errscope">{e.scope}</span>
                    <span className="tl-diag__errmsg" title={e.message}>
                      {e.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="tl-muted tl-small">Nothing has gone wrong so far.</span>
            )}
          </div>
        </section>
      </div>
    </Card>
  );
}
