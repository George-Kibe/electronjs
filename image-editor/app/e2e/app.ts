import {
  _electron as electron,
  chromium,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

export const appRoot = resolve(import.meta.dirname, '..');
export const target = process.env.E2E_TARGET === 'packaged' ? 'packaged' : 'dev';

function packagedExecutable(): string {
  const dist = join(appRoot, 'dist');
  if (process.platform === 'win32') return join(dist, 'win-unpacked', 'ImageEditor.exe');
  if (process.platform === 'darwin') {
    const dir = readdirSync(dist).find((d) => d.startsWith('mac'));
    if (!dir) throw new Error(`No mac build in ${dist}`);
    return join(dist, dir, 'ImageEditor.app', 'Contents', 'MacOS', 'ImageEditor');
  }
  return join(dist, 'linux-unpacked', 'image-editor');
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => ok(port));
    });
  });
}

function start(files: string[], cdpPort: number): Promise<ElectronApplication> {
  // Our port comes after Playwright's own --remote-debugging-port=0, and Chromium uses the last one.
  const debug = `--remote-debugging-port=${cdpPort}`;
  if (target === 'packaged') {
    const executablePath = packagedExecutable();
    if (!existsSync(executablePath))
      throw new Error(`Packaged app missing: ${executablePath}. Run pnpm pack:dir`);
    return electron.launch({ executablePath, args: [debug, ...files] });
  }
  return electron.launch({ args: [debug, '.', ...files], cwd: appRoot });
}

/**
 * Launches the app and returns a Page for its window.
 *
 * app:// is cross-origin isolated (COOP/COEP), so the window's first navigation swaps renderer processes.
 * When that swap races Playwright's attach to the brand-new window, the Page from `app.firstWindow()`
 * stays on the pre-swap document (url '') and no locator ever resolves, although the app rendered fine
 * (verified from the main process: DOM present, window visible, load complete). This happened in about
 * 1 in 10 packaged launches on Linux/xvfb and most packaged launches on Windows. So we wait until the main
 * process reports the page loaded, then attach a second CDP connection. It sees the post-swap page.
 */
export type Launched = {
  app: ElectronApplication;
  win: Page;
  /** Disconnects the extra CDP client first, so no in-flight call fails while the app exits. */
  close: () => Promise<void>;
};

export async function launch(files: string[] = []): Promise<Launched> {
  const cdpPort = await freePort();
  const app = await start(files, cdpPort);
  // Surface main-process logs (GPU/child-process crashes, codec errors) in the test output.
  app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${d}`));
  app.process().stderr?.on('data', (d: Buffer) => process.stdout.write(`[main:err] ${d}`));

  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) => {
          const wc = BrowserWindow.getAllWindows()[0]?.webContents;
          return wc && !wc.isLoading() ? wc.getURL() : '';
        }),
      { timeout: 30_000 },
    )
    .toMatch(/^(app|https?):/);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const win = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => /^(app|https?):/.test(p.url()));
  if (!win) throw new Error('App window not found over CDP');
  win.on('console', (m) => console.log(`[renderer ${m.type()}] ${m.text()}`));
  win.on('crash', () => console.log('[renderer] CRASHED'));
  const close = async () => {
    win.removeAllListeners();
    await browser.close().catch(() => undefined); // connectOverCDP: disconnects, leaves the app running
    // destroy() skips the unsaved-changes guard (FR-DOC-11), which would otherwise cancel the quit.
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
      .catch(() => undefined);
    await app.close();
  };
  try {
    await win.getByRole('button', { name: /Open/ }).first().waitFor({ timeout: 30_000 });
  } catch (err) {
    await close();
    throw err;
  }
  return { app, win, close };
}

export async function snapshot(win: Page, name: string): Promise<void> {
  await win.screenshot({
    path: join(appRoot, 'test-results', 'screens', `${process.platform}-${target}-${name}.png`),
  });
}

/** RGB of the canvas at a point in page coordinates, read from a real screenshot. */
export async function canvasPixel(win: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await win.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

export async function paintLine(win: Page, from: [number, number], to: [number, number]): Promise<void> {
  await win.mouse.move(...from);
  await win.mouse.down();
  for (let i = 1; i <= 20; i++)
    await win.mouse.move(from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20);
  await win.mouse.up();
}

/** Makes the next native save dialogs return `path` (Playwright cannot drive OS dialogs). */
export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, path);
}
