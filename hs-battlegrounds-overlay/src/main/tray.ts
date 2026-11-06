/**
 * System tray icon + menu.
 */
import { Menu, Tray, nativeImage } from 'electron';
import { iconPath } from './env';
import { createLogger } from './logger';

const log = createLogger('tray');

export interface TrayState {
  overlayEnabled: boolean;
  demoRunning: boolean;
  statusLine?: string;
}

export interface TrayHandlers {
  toggleOverlay(): void;
  openApp(): void;
  toggleDemo(): void;
  quit(): void;
}

export class AppTray {
  private tray: Tray | undefined;
  private lastKey = '';

  constructor(private readonly handlers: TrayHandlers) {}

  create(state: TrayState): void {
    try {
      const image = nativeImage.createFromPath(iconPath('tray.png'));
      this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
      this.tray.setToolTip('Tavern Lens');
      this.tray.on('click', () => {
        if (process.platform !== 'darwin') this.handlers.openApp();
      });
      this.update(state);
    } catch (err) {
      log.error('could not create tray icon', err);
    }
  }

  update(state: TrayState): void {
    if (!this.tray) return;
    const key = JSON.stringify(state);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const menu = Menu.buildFromTemplate([
      ...(state.statusLine ? [{ label: state.statusLine, enabled: false }, { type: 'separator' as const }] : []),
      { label: state.overlayEnabled ? 'Hide overlay' : 'Show overlay', click: () => this.handlers.toggleOverlay() },
      { label: 'Open Tavern Lens', click: () => this.handlers.openApp() },
      { label: state.demoRunning ? 'Stop demo' : 'Start demo', click: () => this.handlers.toggleDemo() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.handlers.quit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}
