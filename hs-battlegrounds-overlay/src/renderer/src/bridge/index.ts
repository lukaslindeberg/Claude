import type { TavernLensBridge } from '@shared/ipc';

export type WindowKind = 'overlay' | 'settings';

export interface ResolvedBridge {
  bridge: TavernLensBridge;
  /** True when running outside Electron with the mock bridge (browser demo). */
  demo: boolean;
  windowKind: WindowKind;
}

/**
 * Returns the Electron preload bridge when present, otherwise lazily loads the
 * mock bridge (browser development / demo / screenshots). The mock lives in its
 * own chunk so it is never loaded inside Electron.
 */
export async function resolveBridge(defaultKind: WindowKind): Promise<ResolvedBridge> {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('window');
  if (typeof window !== 'undefined' && window.tavernLens) {
    return { bridge: window.tavernLens, demo: false, windowKind: window.tavernLens.windowKind ?? defaultKind };
  }
  const windowKind: WindowKind = requested === 'settings' || requested === 'overlay' ? requested : defaultKind;
  const { createMockBridge } = await import('./mock');
  const bridge = createMockBridge({
    windowKind,
    scene: params.get('scene') ?? 'recruit',
    speed: Number(params.get('speed')) || undefined,
  });
  return { bridge, demo: true, windowKind };
}
