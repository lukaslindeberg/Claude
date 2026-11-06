/**
 * Electron main entry. Keeps a single instance, then hands over to TavernLensApp.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { TavernLensApp } from './app';
import { configureLogger, createLogger } from './logger';

const log = createLogger('main');

// Running as root in containers/CI needs this; never enabled by default.
if (process.env.TL_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');
// Transparent always-on-top windows behave better without occlusion-based throttling.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (process.platform === 'win32') app.setAppUserModelId('com.tavernlens.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const tavernLens = new TavernLensApp();

  app.on('second-instance', () => tavernLens.showSettings());
  // The app lives in the tray; never quit just because windows closed.
  app.on('window-all-closed', () => undefined);
  app.on('activate', () => tavernLens.showSettings());

  process.on('uncaughtException', (err) => log.error('uncaught exception', err));
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));

  void app.whenReady().then(async () => {
    configureLogger({
      file: join(app.getPath('userData'), 'logs', 'main.log'),
      debug: !app.isPackaged || !!process.env.TL_DEBUG,
    });
    const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;
    try {
      await tavernLens.init({ hidden });
    } catch (err) {
      log.error('startup failed', err);
    }
    const quitAfter = Number(process.env.TL_SMOKE_QUIT_MS);
    if (!app.isPackaged && quitAfter > 0) {
      setTimeout(() => {
        log.info(`TL_SMOKE_QUIT_MS reached (${quitAfter} ms); quitting`);
        app.quit();
      }, quitAfter);
    }
  });
}
