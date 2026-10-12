import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, session } from 'electron';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '@shared/settings';
import { APP_HOST, APP_ORIGIN, APP_SCHEME, PRODUCT_NAME } from '@shared/constants';
import { CloseGuard } from './close-guard';
import { createHandlers } from './ipc/handlers';
import { registerIpc } from './ipc/router';
import { menuTemplate } from './menu';
import { serveAppRequest } from './security/app-protocol';
import { applyNavigationPolicy, applySessionPolicy, makeSenderCheck } from './security/policy';
import { secureWebPreferences } from './security/web-preferences';
import { writeAtomic } from './services/atomic-write';
import { CodecHost } from './services/codec-host';
import { FileRefRegistry } from './services/file-refs';
import { launchPaths } from './services/launch-args';
import { logger } from './services/logger';
import { RecentFiles } from './services/recent-files';
import { SettingsStore } from './services/settings-store';

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const isDev = !app.isPackaged && devServerUrl !== undefined;
const rendererRoot = join(import.meta.dirname, '../renderer');

// NFR-COMP-01: when the GPU is blocklisted or absent, fall back to software WebGL (SwiftShader) instead of
// failing. "Unsafe" refers to running untrusted web content on SwiftShader; this renderer only runs our
// own bundled code from app:// and never loads remote content (docs/06 §4).
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// Settings load before `ready`: "GPU off" must be applied now (FR-GEN-04). userData honours --user-data-dir.
const settings = new SettingsStore({
  path: join(app.getPath('userData'), 'settings.json'),
  writeAtomic,
  onWarning: (message, err) => logger.warn(message, err),
});
if (settings.get().performance.gpu === 'off') app.disableHardwareAcceleration();

/** Native theme (menus, dialogs, title bar) and the interface scale follow the settings (FR-GEN-02). */
function applyAppearance(s: Settings, windows = BrowserWindow.getAllWindows()): void {
  nativeTheme.themeSource = s.general.theme;
  for (const w of windows) w.webContents.setZoomFactor(s.general.interfaceScale);
}

// Must run before `ready`: app:// is a standard, secure origin (docs/02 §2).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let guard: CloseGuard | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: PRODUCT_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f3f3f4',
    show: false,
    webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => applyAppearance(settings.get(), [win]));
  guard = new CloseGuard(() => win.webContents.send('app.closeRequested'), {
    close: () => win.close(),
    quit: () => app.quit(),
  });
  const windowGuard = guard;
  win.on('close', (event) => windowGuard.onClose(event));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    if (guard === windowGuard) guard = null;
  });
  void win.loadURL(isDev ? devServerUrl! : `${APP_ORIGIN}/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  applyNavigationPolicy(app);
  app.on('before-quit', () => guard?.onBeforeQuit());

  // GPU/renderer crashes are rare but decisive when they happen; always log them (docs/09 §4 ops notes).
  app.on('child-process-gone', (_e, details) => logger.warn('Child process gone', details));
  app.on('render-process-gone', (_e, _wc, details) => logger.warn('Renderer process gone', details));

  void app.whenReady().then(() => {
    logger.info('GPU feature status', app.getGPUFeatureStatus());
    protocol.handle(APP_SCHEME, (request) =>
      new URL(request.url).host === APP_HOST
        ? serveAppRequest(request.url, rendererRoot)
        : new Response('Not found', { status: 404 }),
    );
    applySessionPolicy(session.defaultSession);

    const codec = new CodecHost(join(import.meta.dirname, 'codec-host.js'), (code) =>
      logger.error(`Codec host exited with code ${code}; it will restart on the next request`),
    );
    app.on('will-quit', () => codec.stop());

    const recent = new RecentFiles({
      dir: app.getPath('userData'),
      writeAtomic,
      onWarning: (message, err) => logger.warn(message, err),
    });
    const buildMenu = () =>
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          menuTemplate(process.platform, (id) => mainWindow?.webContents.send('menu.command', id), {
            items: recent.menuItems(),
            open: (id) => mainWindow?.webContents.send('menu.openRecent', id),
            clear: () => {
              app.clearRecentDocuments();
              void recent.clear();
            },
          }),
        ),
      );
    recent.onChange(() => {
      buildMenu();
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('recent.changed');
    });

    registerIpc(
      ipcMain,
      createHandlers({
        refs: new FileRefRegistry(),
        dialog,
        window: () => mainWindow,
        codec,
        writeAtomic,
        defaultDir: app.getPath('pictures'),
        setDocumentEdited: (edited) => {
          guard?.setEdited(edited);
          mainWindow?.setDocumentEdited(edited);
        },
        closeWindow: () => guard?.allowClose(),
        appInfo: {
          productName: PRODUCT_NAME,
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          totalMemoryBytes: totalmem(),
        },
        settings,
        recent,
        addOsRecent: (path) => app.addRecentDocument(path),
        launchPaths: launchPaths(process.argv, app.isPackaged),
      }),
      makeSenderCheck(() => (isDev ? devServerUrl! : APP_ORIGIN)),
      (channel, err) => logger.error(`IPC ${channel} failed`, err),
    );

    buildMenu();
    applyAppearance(settings.get(), []);
    settings.onChange((s) => {
      applyAppearance(s);
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings.changed', s);
    });
    mainWindow = createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
