import { Component, useEffect, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { reportError } from '../diagnostics';

export interface ErrorBoundaryProps {
  /** Shown in the log (`widget:<name>`) and in the chip. */
  name: string;
  /** Human label for the chip / panel (default: name). */
  label?: string;
  /**
   * What replaces the crashed subtree:
   * - 'chip'  a small "… hit an error" note at the top edge of the overlay, shrinking to a dot
   *           after a while (overlay widgets);
   * - 'none'  nothing;
   * - 'panel' an inline box with a "Try again" button (companion window).
   */
  fallback?: 'chip' | 'none' | 'panel';
  /** When this changes (e.g. a new game), a crashed subtree gets another chance. */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/**
 * All chips share one fixed tray at the top edge (over the game's innkeeper, away from
 * the widgets) so several crashed widgets line up instead of overlapping.
 */
function chipTray(): HTMLElement {
  let el = document.getElementById('tl-error-tray');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tl-error-tray';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      top: '4px',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: '4px',
      zIndex: '2147483000',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  return el;
}

/** Shrinks to a dot after a while: the details are in the log, the game stays visible. */
const CHIP_FULL_MS = 20_000;

function ErrorChip({ label, error }: { label: string; error: Error }) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCompact(true), CHIP_FULL_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" style={compact ? dotStyle : chipStyle} title={`${label} hit an error. ${error.name}: ${error.message}`}>
      <span aria-hidden style={{ color: '#ff9a5a' }}>
        ⚠
      </span>
      {compact ? null : `${label} hit an error`}
    </div>
  );
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 9px',
  borderRadius: 10,
  font: '600 11px/1.3 var(--tl-font, system-ui, sans-serif)',
  color: '#ffe0b0',
  background: 'rgba(24, 14, 8, 0.86)',
  border: '1px solid rgba(220, 120, 60, 0.75)',
  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
  whiteSpace: 'nowrap',
};

const dotStyle: CSSProperties = { ...chipStyle, padding: '1px 5px', opacity: 0.75 };

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  alignItems: 'flex-start',
  margin: 16,
  padding: '14px 16px',
  borderRadius: 6,
  color: 'var(--tl-text-2, #e8dcc8)',
  background: 'rgba(60, 20, 12, 0.45)',
  border: '1px solid rgba(220, 120, 60, 0.6)',
};

/**
 * Catches render errors of its subtree, writes them (with the component stack) to the
 * diagnostics log and shows a small fallback, so one crashing widget never blanks the
 * whole overlay.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    return { resetKey: props.resetKey, error: null };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(`widget:${this.props.name}`, error, {
      widget: this.props.name,
      componentStack: info.componentStack?.trim().slice(0, 4000),
    });
  }

  private readonly retry = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const label = this.props.label ?? this.props.name;
    switch (this.props.fallback ?? 'chip') {
      case 'none':
        return null;
      case 'panel':
        return (
          <div role="alert" style={panelStyle}>
            <strong>{label} hit an error.</strong>
            <span className="tl-muted tl-small">
              The details were written to the diagnostics log ({error.name}: {error.message}).
            </span>
            <button className="tl-btn" onClick={this.retry}>
              Try again
            </button>
          </div>
        );
      default:
        return createPortal(<ErrorChip label={label} error={error} />, chipTray());
    }
  }
}
