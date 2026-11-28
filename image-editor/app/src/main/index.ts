import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, session } from 'electron';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import type { MovedDocument } from '@shared/ipc-contract';
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
import { RecoveryStore } from './services/recovery';
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

/** Open windows and their unsaved-changes guards (several windows: FR-DOC-03 "drag a tab out"). */
const guards = new Map<BrowserWindow, CloseGuard>();
/** Documents waiting for the window that will show them (by webContents id). */
const handovers = new Map<number, { project: Uint8Array; document: MovedDocument }>();

/** The window menu commands go to: the focused one, else the most recently created. */
function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? [...guards.keys()].at(-1) ?? null;
}

function createWindow(
  handover?: { project: Uint8Array; document: MovedDocument },
  at?: { x: number; y: number } | null,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // A window for a dragged-out tab opens where the tab was dropped.
    ...(at ? { x: Math.round(at.x - 200), y: Math.round(at.y - 40) } : {}),
    minWidth: 800,
    minHeight: 560,
    title: PRODUCT_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f3f3f4',
    show: false,
    webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
  });
  if (handover) handovers.set(win.webContents.id, handover);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => applyAppearance(settings.get(), [win]));
  const guard = new CloseGuard(() => win.webContents.send('app.closeRequested'), {
    close: () => win.close(),
    quit: () => app.quit(),
  });
  guards.set(win, guard);
  win.on('close', (event) => guard.onClose(event));
  const id = win.webContents.id;
  win.on('closed', () => {
    guards.delete(win);
    handovers.delete(id);
  });
  void win.loadURL(isDev ? devServerUrl! : `${APP_ORIGIN}/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = activeWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  applyNavigationPolicy(app);
  app.on('before-quit', () => guards.forEach((g) => g.onBeforeQuit()));

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
          menuTemplate(process.platform, (id) => activeWindow()?.webContents.send('menu.command', id), {
            items: recent.menuItems(),
            open: (id) => activeWindow()?.webContents.send('menu.openRecent', id),
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
        window: (sender) => BrowserWindow.fromWebContents(sender),
        codec,
        writeAtomic,
        defaultDir: app.getPath('pictures'),
        setDocumentEdited: (edited, sender) => {
          const win = BrowserWindow.fromWebContents(sender);
          if (!win) return;
          guards.get(win)?.setEdited(edited);
          win.setDocumentEdited(edited);
        },
        closeWindow: (sender) => {
          const win = BrowserWindow.fromWebContents(sender);
          if (win) guards.get(win)?.allowClose();
        },
        openDocumentWindow: (handover, at) => void createWindow(handover, at),
        takeHandover: (sender) => {
          const h = handovers.get(sender.id) ?? null;
          handovers.delete(sender.id);
          return h;
        },
        appInfo: {
          productName: PRODUCT_NAME,
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          totalMemoryBytes: totalmem(),
          // E2E only: a short autosave interval so crash recovery can be tested (docs/07 T-REC-01).
          autosaveSecondsOverride: Number(process.env['E2E_AUTOSAVE_SECONDS']) || null,
        },
        recovery: new RecoveryStore({ dir: join(app.getPath('userData'), 'recovery'), writeAtomic }),
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
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
