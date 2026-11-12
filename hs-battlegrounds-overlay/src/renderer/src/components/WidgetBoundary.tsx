import type { ReactNode } from 'react';
import type { WidgetId } from '@shared/types';
import { useApp } from '../store/appStore';
import { ErrorBoundary } from './ErrorBoundary';

const LABELS: Record<WidgetId, string> = {
  heroSelection: 'Hero selection',
  opponentsPanel: 'Opponents panel',
  battleSim: 'Battle simulation',
  sessionStats: 'Session tracker',
  lobbyInfo: 'Lobby info',
  postMatch: 'Post-match summary',
  trinketPick: 'Trinket pick',
};

/**
 * Error boundary for one overlay widget: a crash is logged (with the component stack)
 * and replaced by a small chip; the widget gets another chance when a new game starts.
 */
export function WidgetBoundary({ id, children }: { id: WidgetId; children: ReactNode }) {
  const gameId = useApp((s) => s.game?.gameId ?? '');
  return (
    <ErrorBoundary name={id} label={LABELS[id] ?? id} fallback="chip" resetKey={gameId}>
      {children}
    </ErrorBoundary>
  );
}
