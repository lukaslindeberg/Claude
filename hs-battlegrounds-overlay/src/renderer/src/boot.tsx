import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
// Fraunces (OFL): flared display serif for titles, big numbers and outlined stats.
// Archivo (OFL): Franklin-style grotesque with a width axis for UI text. Bundled locally.
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/archivo/wdth.css';
import './styles/base.css';
import { resolveBridge, type WindowKind } from './bridge';
import { ErrorBoundary } from './components/ErrorBoundary';
import { attachDiagnosticsBridge, installRendererDiagnostics, reportError, rendererLog, watchSimRuns } from './diagnostics';
import { connectStore } from './store/appStore';

type AppLoader = () => Promise<{ default: ComponentType }>;

/**
 * Shared entry: resolves the bridge (Electron preload or browser mock), wires
 * the store and renders the app for this window kind.
 */
export async function boot(defaultKind: WindowKind, loaders: Record<WindowKind, AppLoader>) {
  const el = document.getElementById('root')!;
  // Errors from here on reach the main-process diagnostics log.
  installRendererDiagnostics();
  try {
    const { bridge, demo, windowKind } = await resolveBridge(defaultKind);
    attachDiagnosticsBridge(bridge, windowKind === 'overlay' ? 'overlay' : 'companion');
    document.body.classList.toggle('tl-body--demo', demo);
    document.body.classList.toggle('tl-body--overlay', windowKind === 'overlay');
    document.body.classList.toggle('tl-body--companion', windowKind === 'settings');
    await connectStore(bridge, demo);
    if (windowKind === 'overlay') watchSimRuns();
    const { default: App } = await loaders[windowKind]();
    createRoot(el, {
      // Errors caught by an ErrorBoundary are reported by the boundary itself.
      onCaughtError: (error) => console.warn('[tavern-lens] a component crashed (caught by an error boundary)', error),
      onUncaughtError: (error, info) => reportError('react', error, { componentStack: info.componentStack?.trim().slice(0, 4000), uncaught: true }),
      onRecoverableError: (error) => rendererLog('warn', 'react', `recoverable error: ${error instanceof Error ? error.message : String(error)}`),
    }).render(
      <StrictMode>
        <ErrorBoundary
          name={windowKind === 'overlay' ? 'overlay' : 'companion'}
          label={windowKind === 'overlay' ? 'Tavern Lens overlay' : 'Tavern Lens'}
          fallback={windowKind === 'overlay' ? 'chip' : 'panel'}
        >
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (err) {
    console.error('[tavern-lens] failed to start renderer', err);
    el.innerHTML = `<pre style="color:#f88;padding:16px;font:12px monospace">Tavern Lens failed to start:\n${String(err)}</pre>`;
  }
}
