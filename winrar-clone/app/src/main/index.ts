import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRODUCT_NAME } from '@shared/constants';
import { SessionStore } from './archive/sessions';
import { sevenZipPath } from './engine/binary';
import { SevenZipEngine } from './engine/engine';
import { createHandlers } from './ipc/handlers';
import { registerIpc } from './ipc/router';
import { applyNavigationPolicy, applySessionPolicy, makeSenderCheck } from './security/policy';
import { secureWebPreferences } from './security/web-preferences';
import { FileRefRegistry } from './services/file-refs';
import { launchPaths } from './services/launch-args';
import { logger } from './services/logger';

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const isDev = !app.isPackaged && devServerUrl !== undefined;
const rendererFile = join(import.meta.dirname, '../renderer/index.html');

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 420,
    title: PRODUCT_NAME,
    show: false,
    webPreferences: secureWebPreferences(join(import.meta.dirname, '../preload/index.cjs')),
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  if (isDev) void win.loadURL(devServerUrl!);
  else void win.loadFile(rendererFile);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // M3 adds CLI intent forwarding (ADR-0005); for now just focus the existing window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  applyNavigationPolicy(app);

  void app.whenReady().then(() => {
    applySessionPolicy(session.defaultSession, isDev);

    const engine = new SevenZipEngine(
      sevenZipPath({
        isPackaged: app.isPackaged,
        appRoot: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        platform: process.platform,
        arch: process.arch,
      }),
    );

    registerIpc(
      ipcMain,
      createHandlers({
        engine,
        refs: new FileRefRegistry(),
        sessions: new SessionStore(),
        dialog,
        window: () => mainWindow,
        appInfo: {
          productName: PRODUCT_NAME,
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
        },
        launchPaths: launchPaths(process.argv, app.isPackaged),
      }),
      makeSenderCheck(() => (isDev ? devServerUrl! : pathToFileURL(rendererFile).href)),
      (channel, err) => logger.error(`IPC ${channel} failed`, err),
    );

    mainWindow = createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
