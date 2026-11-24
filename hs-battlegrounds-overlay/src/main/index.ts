/**
 * Electron main entry. Keeps a single instance, then hands over to TavernLensApp.
 */
import { join } from 'node:path';
import { app } from 'electron';
import { TavernLensApp } from './app';
import { LOG_FILE_NAME, configureLogger, createLogger } from './logger';

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

  // Registering these also keeps Electron from showing its own crash dialog.
  process.on('uncaughtException', (err, origin) => log.error(`uncaught exception (${origin})`, err));
  process.on('unhandledRejection', (reason) =>
    log.error('unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason))),
  );
  app.on('child-process-gone', (_e, d) => {
    const line = `${d.type} process gone: ${d.reason} (exit code ${d.exitCode}${d.name ? `, ${d.name}` : ''})`;
    if (d.reason === 'clean-exit') log.info(line);
    else log.error(line);
  });

  void app.whenReady().then(async () => {
    // Debug detail follows the "Verbose logging" setting (applied by the app) or TL_DEBUG.
    configureLogger({
      file: join(app.getPath('userData'), 'logs', LOG_FILE_NAME),
      debug: !!process.env.TL_DEBUG,
      // A packaged GUI app has no console to echo to.
      console: !app.isPackaged || !!process.env.TL_DEBUG,
    });
    log.info(`Tavern Lens ${app.getVersion()} starting (pid ${process.pid}, ${app.isPackaged ? 'packaged' : 'dev'})`);
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
